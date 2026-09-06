import {
  OllamaProvider,
  OpenAICompatibleProvider,
  resolveLocalRuntime,
  ChatMessage,
  ChatProvider
} from '@core/providers'
import { OpenAIResponsesProvider, isOfficialOpenAI } from '@core/providers/openai-responses'
import { decideRoute, RoutingContext } from '@core/routing'
import { globalCircuitBreaker, withRetry } from '@core/resilience'
import { AppError, classifyProviderError } from '@core/errors'
import { resolveModelIdForProvider } from '@core/models/free-cloud-catalog'
import {
  applyModelMemory,
  recordModelFailure,
  recordModelSuccess,
  suggestSafeModel,
  isModelBlocked,
  isProviderCoolingDown,
  markProviderCooldown
} from '@core/models/model-memory'
import {
  packContext,
  summarizeConversation,
  shouldSummarize,
  planContext,
  budgetForModel,
  aggressiveShrink,
  type ContextBudget,
  type ContextPlan
} from '@core/conversation'
// app agent injected in useChat for freshness
import { buildCharacterSystemPrompt, appearanceReminder, looksLikeAppearanceQuestion, effectiveVisualDescription } from '@core/character/profile'
import {
  buildUserMemoryPrompt
} from '@core/conversation/user-memory'
import {
  orderCloudEndpoints,
  shouldRotateCloud,
  explainCloudQueue,
  type CloudEndpointWithKey
} from '@core/models/cloud-rotation'
import type { Settings } from '@shared/types/settings'
import {
  shouldSkipProvider,
  rankProvidersByLearning
} from '@core/diagnostics/mini-brain'

export interface RouteInfo {
  target: string
  reason: string
  model: string
  failover?: boolean
  contextPacked?: boolean
  summarySource?: 'model' | 'heuristic'
  at: number
}

export interface OrchestratorCallbacks {
  onToken: (token: string) => void
  onRoute?: (info: RouteInfo) => void
  onDone?: (meta: {
    model: string
    provider: string
    latencyMs: number
    route: RouteInfo
  }) => void
  onError?: (error: AppError) => void
  /** Called when a new rolling summary is produced for this conversation */
  onSummary?: (info: {
    summary: string
    coveredCount: number
    source: 'model' | 'heuristic'
  }) => void
  /** High-level phase for live UI */
  onPhase?: (phase: 'preparing' | 'summarizing' | 'generating' | 'failover') => void
}

/** Optional DI for tests / advanced hosts */
export interface OrchestratorDeps {
  local?: ChatProvider | null
  /** Custom cloud queue: provider instance per endpoint */
  cloudProviders?: Array<{ endpoint: CloudEndpointWithKey; provider: ChatProvider }>
  /** Force availability flags (skip network health checks) */
  availability?: { localAvailable: boolean; cloudAvailable: boolean }
}

async function buildProviders(
  settings: Settings,
  apiKey?: string
): Promise<{ local: ChatProvider | null; cloud: ChatProvider | null; localLabel?: string }> {
  // Transparent local runtime: Ollama OR LM Studio / llama.cpp (OpenAI-compatible)
  let local: ChatProvider | null = null
  let localLabel: string | undefined
  try {
    let pref =
      (settings as { localRuntimePreference?: 'auto' | 'ollama' | 'openai-compatible' })
        .localRuntimePreference || 'auto'
    const openAIUrl =
      ((settings as { localOpenAIBaseUrl?: string }).localOpenAIBaseUrl || '').trim() || undefined
    const modelName = (settings.localModel || '').trim()
    // qwen2.5:14b-style ids → Ollama; bare LM Studio ids → openai-compatible
    if (pref === 'auto') {
      if (modelName.includes(':')) pref = 'ollama'
      else if (openAIUrl) pref = 'openai-compatible'
    }
    const resolved = await resolveLocalRuntime({
      preference: pref,
      ollamaBaseUrl: settings.localBaseUrl,
      openAIBaseUrl: openAIUrl
    })
    if (resolved) {
      const chatTimeout = Math.max(120_000, Number(settings.localTimeoutMs) || 180_000)
      if (resolved.kind === 'openai-compatible') {
        local = new OpenAICompatibleProvider({
          id: 'local-openai',
          displayName: resolved.label,
          baseUrl: resolved.baseUrl,
          apiKey: 'not-needed',
          timeoutMs: chatTimeout
        })
        // Prefer LM Studio loaded model if settings.localModel empty or ollama-only name missing
        if (resolved.defaultModel && !(settings.localModel || '').trim()) {
          localLabel = `${resolved.label} (${resolved.kind}) · modelo ${resolved.defaultModel}`
        } else {
          localLabel = `${resolved.label} (${resolved.kind})`
        }
      } else {
        local = new OllamaProvider({
          baseUrl: settings.localBaseUrl,
          timeoutMs: chatTimeout
        })
        localLabel = `${resolved.label} (${resolved.kind})`
      }
      if (
        resolved.kind === 'openai-compatible' &&
        resolved.defaultModel &&
        !(settings.localModel || '').trim()
      ) {
        try {
          localLabel += localLabel.includes('modelo') ? '' : ` · modelo ${resolved.defaultModel}`
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    local = new OllamaProvider({
      baseUrl: settings.localBaseUrl,
      timeoutMs: settings.localTimeoutMs
    })
    localLabel = 'Ollama (fallback)'
  }

  if (!local) {
    local = new OllamaProvider({
      baseUrl: settings.localBaseUrl,
      timeoutMs: settings.localTimeoutMs
    })
  }

  const cloud = settings.cloudBaseUrl
    ? new OpenAICompatibleProvider({
        id: 'cloud',
        displayName: 'Cloud',
        baseUrl: settings.cloudBaseUrl,
        apiKey,
        timeoutMs: settings.cloudTimeoutMs
      })
    : null

  return { local, cloud, localLabel }
}

async function checkAvailability(
  local: ChatProvider | null,
  cloud: ChatProvider | null
): Promise<{ localAvailable: boolean; cloudAvailable: boolean }> {
  const [l, c] = await Promise.all([
    local ? local.healthCheck().then((h) => h.ok).catch(() => false) : Promise.resolve(false),
    cloud && globalCircuitBreaker.canRequest(cloud.id)
      ? cloud.healthCheck().then((h) => h.ok).catch(() => false)
      : Promise.resolve(false)
  ])
  return { localAvailable: l, cloudAvailable: c }
}

function isContextOrLimitError(err: AppError): boolean {
  return (
    err.code === 'CONTEXT_OVERFLOW' ||
    err.code === 'PROVIDER_RATE_LIMIT' ||
    err.code === 'PROVIDER_QUOTA'
  )
}

/** Prefer local for summarization (cheap/private); else cloud. */
function pickSummarizer(
  local: ChatProvider | null,
  cloud: ChatProvider | null,
  localModel: string,
  cloudModel: string,
  localAvailable: boolean,
  cloudAvailable: boolean
): { provider: ChatProvider; model: string } | null {
  if (local && localModel && localAvailable) {
    return { provider: local, model: localModel }
  }
  if (cloud && cloudModel && cloudAvailable) {
    return { provider: cloud, model: cloudModel }
  }
  return null
}

export async function sendChatMessage(options: {
  settings: Settings
  apiKey?: string
  /** Per-provider keys for cloud rotation */
  providerKeys?: Record<string, string>
  userContent: string
  history: ChatMessage[]
  /** Existing rolling summary for this conversation */
  previousSummary?: string
  previousSummarySource?: 'model' | 'heuristic'
  summaryCoveredCount?: number
  signal?: AbortSignal
  callbacks: OrchestratorCallbacks
  deps?: OrchestratorDeps
  /** Live app status + tool protocol for self-configuration agent */
  extraSystem?: string
}): Promise<void> {
  const {
    settings,
    apiKey,
    providerKeys = {},
    userContent: initialUserContent,
    history,
    previousSummary,
    previousSummarySource,
    summaryCoveredCount = 0,
    signal,
    callbacks,
    deps,
    extraSystem
  } = options
  let userContent = initialUserContent
  const start = Date.now()
  const built = await buildProviders(settings, apiKey)
  const local = deps?.local !== undefined ? deps.local : built.local
  const cloud = built.cloud

  // Multi-provider cloud queue (keys from secure store)
  const keys: Record<string, string> = { ...providerKeys }
  if (apiKey && !keys.openrouter) keys.openrouter = apiKey
  if (apiKey && !keys.main) keys.main = apiKey
  // Legacy main key → OpenRouter only (never auto-enable Groq via key shape)
  if (!keys.openrouter && keys.main) keys.openrouter = keys.main
  // Groq key only if user stored gsk_ under groq OR explicitly as groq slot key
  if (!keys.groq && keys.main && /gsk_/i.test(keys.main)) {
    const groqSlot = settings.cloudSlots?.find((s) => s.id === 'groq')
    if (groqSlot?.enabled) keys.groq = keys.main
  }

  // Sync primary settings into slots if slots empty/disabled
  let slots = settings.cloudSlots?.length
    ? [...settings.cloudSlots]
    : []
  if (slots.length === 0 && settings.cloudBaseUrl) {
    slots = [
      {
        id: 'openrouter',
        name: 'Cloud',
        baseUrl: settings.cloudBaseUrl,
        model: resolveModelIdForProvider('openrouter', settings.cloudModel || '') || '',
        enabled: true,
        priority: 0
      }
    ]
  }
  // Ensure primary cloudBaseUrl/model is reflected (safe free model)
  if (settings.cloudBaseUrl && (settings.cloudModel || '').trim()) {
    const primary = slots.find(
      (s) => s.baseUrl.replace(/\/$/, '') === settings.cloudBaseUrl.replace(/\/$/, '')
    )
    if (primary) {
      primary.model =
        resolveModelIdForProvider(primary.id, settings.cloudModel || '') || primary.model
      /* keep primary.enabled as user set */
    }
  }

  // Sanitize persisted models (e.g. Groq 70B on free)
  slots = slots.map((s) => ({
    ...s,
    model: resolveModelIdForProvider(s.id, s.model || '')
  }))

  // Ensure every provider with a stored key is in the queue (not only UI slots)
  const known = [
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
    { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
    { id: 'gemini', name: 'Google AI Studio', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }
  ]
  for (const k of known) {
    const hasKey = (keys[k.id] || '').trim().length >= 8
    if (!hasKey) continue
    const existing = slots.find((s) => s.id === k.id)
    if (!existing) {
      // Auto-add OpenRouter + OpenAI when key is stored (user paid/quality path)
      if (k.id !== 'openrouter' && k.id !== 'openai') continue
      slots.push({
        id: k.id,
        name: k.name,
        baseUrl: k.baseUrl,
        model: resolveModelIdForProvider(k.id, ''),
        enabled: true,
        // OpenAI quality first when present
        priority: k.id === 'openai' ? -2 : 0
      })
    } else {
      // Respect user toggle: never force-enable a disabled provider
      existing.model = resolveModelIdForProvider(k.id, existing.model || '')
      if (k.id === 'openrouter' && existing.enabled) {
        existing.priority = Math.min(existing.priority, 0)
      }
      if (k.id === 'openai' && existing.enabled) {
        existing.priority = Math.min(existing.priority, -2)
        if (!(existing.model || '').trim()) {
          existing.model = resolveModelIdForProvider('openai', 'gpt-4o-mini')
        }
      }
    }
  }
  // Prefer OpenRouter free first when preferFreeTiers
  if (settings.preferFreeTiers !== false) {
    slots = slots
      .map((s) =>
        s.id === 'openrouter'
          ? { ...s, priority: -1, model: resolveModelIdForProvider('openrouter', s.model || 'openrouter/free') }
          : s
      )
      .sort((a, b) => a.priority - b.priority)
  }

  let cloudQueue: CloudEndpointWithKey[] =
    settings.cloudAutoRotate !== false
      ? orderCloudEndpoints(slots, keys, settings.cloudBaseUrl)
      : orderCloudEndpoints(
          slots.filter((s) => {
            const primary =
              s.baseUrl.replace(/\/$/, '') === settings.cloudBaseUrl.replace(/\/$/, '')
            return primary
          }),
          keys,
          settings.cloudBaseUrl
        )

  // Optional DI: replace cloud queue with injected providers
  const injectedCloud = deps?.cloudProviders
  if (injectedCloud && injectedCloud.length > 0) {
    cloudQueue = injectedCloud.map((item) => item.endpoint)
  }

  // A4 hard filter: only slots the user enabled (and that still have keys)
  const enabledIds = new Set(
    slots.filter((s) => s.enabled).map((s) => s.id)
  )
  cloudQueue = cloudQueue.filter((c) => enabledIds.has(c.id))

  // Mini-brain: skip chronic failures, rank by what worked
  const beforeSkip = cloudQueue.length
  cloudQueue = cloudQueue.filter((c) => {
    if (shouldSkipProvider(c.id)) {
      console.debug('[mini-brain] skip provider', c.id)
      return false
    }
    return true
  })
  // If learning emptied the queue, keep OpenRouter (and any non-skipped) for this turn
  if (cloudQueue.length === 0 && beforeSkip > 0) {
    console.debug('[mini-brain] queue empty after skip — restoring providers for this turn')
    cloudQueue = orderCloudEndpoints(slots, keys, settings.cloudBaseUrl).filter((c) =>
      enabledIds.has(c.id)
    )
  }

  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[cloud-queue]', explainCloudQueue(slots, keys), '→', cloudQueue.map((c) => c.id))
  }
  {
    const order = rankProvidersByLearning(cloudQueue.map((c) => c.id))
    const rank = new Map(order.map((id, i) => [id, i]))
    cloudQueue = [...cloudQueue].sort(
      (a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)
    )
  }

  let localAvailable: boolean
  let cloudAvailable: boolean
  if (deps?.availability) {
    localAvailable = deps.availability.localAvailable
    cloudAvailable = deps.availability.cloudAvailable
  } else {
    const health = await checkAvailability(
      local,
      cloudQueue[0]
        ? (isOfficialOpenAI(cloudQueue[0].baseUrl, cloudQueue[0].id)
            ? new OpenAIResponsesProvider({
                id: cloudQueue[0].id,
                displayName: cloudQueue[0].name,
                baseUrl: cloudQueue[0].baseUrl,
                apiKey: cloudQueue[0].apiKey,
                timeoutMs: settings.cloudTimeoutMs
              })
            : new OpenAICompatibleProvider({
                id: cloudQueue[0].id,
                displayName: cloudQueue[0].name,
                baseUrl: cloudQueue[0].baseUrl,
                apiKey: cloudQueue[0].apiKey,
                timeoutMs: settings.cloudTimeoutMs
              }))
        : cloud
    )
    localAvailable = health.localAvailable
    cloudAvailable = health.cloudAvailable || cloudQueue.length > 0
  }

  // Optimistic local: if user configured a local model + runtime, try it even when
  // a quick health probe failed (Ollama waking up, LM Studio JIT load, etc.)
  const localModelConfigured = Boolean((settings.localModel || '').trim() && local)
  if (
    !localAvailable &&
    localModelConfigured &&
    settings.providerMode !== 'cloud'
  ) {
    localAvailable = true
  }


  const routingCtx: RoutingContext = {
    prompt: userContent,
    promptLength: userContent.length,
    hasAttachments: false,
    localAvailable,
    cloudAvailable,
    webSearchEnabled: settings.webSearchEnabled,
    longPromptThreshold: settings.longPromptThreshold,
    localMaxTokens: settings.localMaxTokens,
    cloudMaxTokens: settings.cloudMaxTokens
  }

  let decision =
    settings.providerMode === 'local'
      ? {
          target: 'local' as const,
          reason: 'Modo forzado: solo local',
          useWebSearch: false,
          temperature: settings.temperature,
          maxTokens: settings.localMaxTokens,
          confidence: 1
        }
      : settings.providerMode === 'cloud'
        ? {
            target: 'cloud' as const,
            reason: 'Modo forzado: solo cloud',
            useWebSearch: false,
            temperature: settings.temperature,
            maxTokens: settings.cloudMaxTokens,
            confidence: 1
          }
        : decideRoute(routingCtx)

  // If Ollama is down, never waste a turn on local (unless mode is forced local)
  if (
    decision.target === 'local' &&
    !localAvailable &&
    settings.providerMode !== 'local' &&
    cloudQueue.length > 0
  ) {
    decision = {
      ...decision,
      target: 'cloud',
      reason: 'Ollama no disponible — usando cloud',
      confidence: 0.9
    }
  }

  const characterPrompt = buildCharacterSystemPrompt(
    {
      name: settings.character?.name || 'Kawaii',
      tagline: settings.character?.tagline || '',
      personality: settings.character?.personality || '',
      style: settings.character?.style || '',
      visualEmoji: settings.character?.visualEmoji || '🌸',
      visualImageUrl: settings.character?.visualImageUrl,
      visualDescription: settings.character?.visualDescription,
      visualFromAvatar: settings.character?.visualFromAvatar,
      relationshipRole: settings.character?.relationshipRole,
      relationshipReaction: settings.character?.relationshipReaction,
      relationshipHistory: settings.character?.relationshipHistory,
      traits: Array.isArray(settings.character?.traits) ? settings.character.traits : []
    },
    settings.systemPrompt
  )

  const userMemPrompt = buildUserMemoryPrompt(settings.userMemory)

  const systemMessages: ChatMessage[] = [{ role: 'system', content: characterPrompt }]
  if (userMemPrompt) {
    systemMessages.push({ role: 'system', content: userMemPrompt })
  }
  if (extraSystem && extraSystem.trim()) {
    systemMessages.push({ role: 'system', content: extraSystem.trim() })
  }

  // Local models often ignore long system prose — reinforce appearance facts on demand
  try {
    const charForLook = {
      name: settings.character?.name || 'Kawaii',
      tagline: settings.character?.tagline || '',
      personality: settings.character?.personality || '',
      style: settings.character?.style || '',
      visualEmoji: settings.character?.visualEmoji || '🌸',
      visualImageUrl: settings.character?.visualImageUrl,
      visualDescription: settings.character?.visualDescription,
      visualFromAvatar: settings.character?.visualFromAvatar,
      relationshipRole: settings.character?.relationshipRole,
      traits: Array.isArray(settings.character?.traits) ? settings.character.traits : []
    }
    if (looksLikeAppearanceQuestion(userContent)) {
      const tip = appearanceReminder(charForLook)
      if (tip) systemMessages.push({ role: 'system', content: tip })
      const facts = effectiveVisualDescription(charForLook)
      if (facts) {
        // Local models (Qwen etc.) often ignore system — put facts in the user turn
        userContent =
          `[Ficha física de ${charForLook.name} — USA SOLO ESTO al describirte]\n` +
          facts +
          `\n\nPregunta del usuario: ${userContent}`
      }
    }
  } catch {
    /* ignore */
  }

  if (decision.useWebSearch && typeof window !== 'undefined' && window.kawaii) {
    try {
      const results = await window.kawaii.webSearch(
        userContent,
        settings.webSearchMaxResults
      )
      if (results.length > 0) {
        const block = results
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}\n${r.snippet}${r.url ? `\nURL: ${r.url}` : ''}`
          )
          .join('\n\n')
        systemMessages.push({
          role: 'system',
          content: `Contexto web reciente (úsalo solo si es relevante):\n\n${block}`
        })
      }
    } catch {
      // best-effort
    }
  }

  const localModel = settings.localModel
  const cloudModel = resolveModelIdForProvider(
    slots[0]?.id || 'openrouter',
    settings.cloudModel || ''
  )

  // ── Model-backed rolling summary ──────────────────────────────────────────
  let activeSummary = previousSummary?.trim() || ''
  let activeSummarySource: 'model' | 'heuristic' | undefined = activeSummary
    ? previousSummarySource ?? 'heuristic'
    : undefined
  const kindHint: 'local' | 'cloud' =
    decision.target === 'local' ? 'local' : 'cloud'
  const modelHint =
    kindHint === 'local'
      ? localModel || 'local'
      : cloudModel || resolveModelIdForProvider('openrouter', settings.cloudModel || '')

  let contextPlan: ContextPlan = planContext({
    systemMessages,
    history,
    userContent,
    modelId: modelHint,
    kind: kindHint,
    providerId: kindHint === 'local' ? 'local' : slots[0]?.id || 'openrouter'
  })

  const budgetHint = contextPlan.budget

  const olderCount = Math.max(0, history.length - budgetHint.keepRecentMessages)
  // Local models: never spend a full LLM turn on summary (slow + steals context).
  // Use rolling heuristic/pack only. Cloud keeps model summary when the window is tight.
  const localHistoryChars = history.reduce((total, message) => total + message.content.length, 0)
  const localVeryLongHistory =
    (decision.target === 'local' || settings.providerMode === 'local') &&
    (olderCount > 24 || localHistoryChars > 1_800)
  const needsFreshSummary =
    !contextPlan.isTight &&
    !localVeryLongHistory &&
    (contextPlan.forceSummary ||
      shouldSummarize(history.length, budgetHint.keepRecentMessages, 10)) &&
    olderCount > summaryCoveredCount &&
    olderCount >= 8

  if (needsFreshSummary) {
    const older = history.slice(0, history.length - budgetHint.keepRecentMessages)
    const summarizer = pickSummarizer(
      local,
      cloud,
      localModel,
      cloudModel,
      localAvailable,
      cloudAvailable
    )
    if (summarizer) {
      try {
        callbacks.onPhase?.('summarizing')
        const preferFast = summarizer.provider.id === 'ollama' || summarizer.provider.id === 'local'
        const result = await summarizeConversation({
          provider: summarizer.provider,
          model: summarizer.model,
          older,
          previousSummary: activeSummary || undefined,
          signal,
          maxSummaryChars: preferFast ? 800 : 1200,
          preferFast,
          timeoutMs: preferFast ? 20_000 : 40_000
        })
        if (result.summary) {
          activeSummary = result.summary
          activeSummarySource = result.source
          callbacks.onSummary?.({
            summary: result.summary,
            coveredCount: history.length - budgetHint.keepRecentMessages,
            source: result.source
          })
        }
      } catch {
        // keep previous / let packContext use heuristic
      }
    }
  }


  // A1: tight context → prefer long-window models and providers
  if (contextPlan.isTight && cloudQueue.length > 0) {
    const wideMap: Record<string, string> = {
      openrouter: 'openrouter/free',
      gemini: 'gemini-2.0-flash',
      groq: 'llama-3.1-8b-instant',
      openai: 'gpt-5.6-luna'
    }
    cloudQueue = cloudQueue.map((ep) => {
      const preferred = wideMap[ep.id]
      if (preferred && preferred !== ep.model) return { ...ep, model: preferred }
      return ep
    })
    cloudQueue = [...cloudQueue].sort((a, b) => {
      const score = (id: string) =>
        id === 'gemini' ? 0 : id === 'openrouter' ? 1 : id === 'groq' ? 3 : 2
      return score(a.id) - score(b.id)
    })
  }

    const runOn = async (
    provider: ChatProvider,
    model: string,
    targetLabel: string,
    reason: string,
    temperature: number,
    maxTokens: number,
    budget: ContextBudget,
    failover = false
  ) => {
    if (!globalCircuitBreaker.canRequest(provider.id)) {
      throw new AppError({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Circuito abierto para ${provider.displayName}`,
        provider: provider.id,
        retryable: true
      })
    }

    let currentBudget = budget
    let lastErr: AppError | null = null

    for (let attempt = 0; attempt < 3; attempt++) {
      const packed = packContext(
        systemMessages,
        history,
        { role: 'user', content: userContent },
        currentBudget,
        activeSummary || undefined
      )

      const routeInfo: RouteInfo = {
        target: targetLabel,
        reason:
          attempt > 0
            ? `${reason} · reintento con contexto reducido (${attempt + 1}/3)`
            : contextPlan.isTight
              ? `${reason} · contexto reducido para dejar margen de respuesta`
            : activeSummary
              ? `${reason} · contexto con resumen ${activeSummarySource ?? 'previo'}`
              : reason,
        model,
        failover,
        contextPacked: packed.truncated || packed.summaryInjected,
        summarySource: packed.summaryInjected
          ? activeSummarySource ?? 'heuristic'
          : undefined,
        at: Date.now()
      }
      callbacks.onRoute?.(routeInfo)

      try {
        const request = {
          model,
          messages: packed.messages,
          temperature,
          maxTokens,
          stream: settings.streaming,
          signal
        }

        if (settings.streaming) {
          await provider.chatStream(request, (chunk) => {
            if (chunk.content) callbacks.onToken(chunk.content)
          })
        } else {
          const result = await provider.chat(request)
          if (result.content) callbacks.onToken(result.content)
        }

        globalCircuitBreaker.recordSuccess(provider.id)
        callbacks.onDone?.({
          model,
          provider: provider.id,
          latencyMs: Date.now() - start,
          route: routeInfo
        })
        return
      } catch (err) {
        const appErr =
          err instanceof AppError ? err : classifyProviderError(String(err), provider.id)
        lastErr = appErr

        if (appErr.code === 'CONTEXT_OVERFLOW' && attempt < 2) {
          callbacks.onRoute?.({
            ...routeInfo,
            reason: `${routeInfo.reason} · reintento con contexto reducido (${attempt + 2}/3)`,
            contextPacked: true,
            at: Date.now()
          })
          currentBudget = aggressiveShrink(currentBudget, attempt + 1)
          // Also drop maxTokens a bit to leave room
          maxTokens = Math.max(256, Math.floor(maxTokens * 0.7))
          continue
        }
        if (appErr.code === 'STREAM_ABORTED') throw appErr
        throw appErr
      }
    }

    throw (
      lastErr ??
      new AppError({
        code: 'UNKNOWN',
        message: 'Falló tras reintentos de contexto',
        provider: provider.id
      })
    )
  }

  const tryLocal = (reason: string, failover = false) => {
    let modelId = (localModel || '').trim()
    if (!local) {
      throw new AppError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Runtime local no disponible (Ollama/LM Studio)',
        retryable: true
      })
    }
    if (!modelId) {
      throw new AppError({
        code: 'PROVIDER_MODEL_NOT_FOUND',
        message:
          'No hay modelo local seleccionado. En Ajustes → Modelo local elige uno de Ollama o LM Studio (cargado en el servidor).',
        retryable: false
      })
    }
    const localBudget = budgetForModel(modelId, 'local')
    const reasonWithCtx =
      contextPlan.isTight || contextPlan.forceSummary
        ? `${reason} · ${contextPlan.note}`
        : reason
    return runOn(
      local,
      modelId,
      'local',
      reasonWithCtx,
      decision.temperature ?? settings.temperature,
      Math.min(decision.maxTokens ?? settings.localMaxTokens, 2048),
      localBudget,
      failover
    )
  }

  const injectedById = new Map(
    (injectedCloud ?? []).map((item) => [item.endpoint.id, item.provider] as const)
  )

  const makeCloudProvider = (endpoint: CloudEndpointWithKey) => {
    if (isOfficialOpenAI(endpoint.baseUrl, endpoint.id)) {
      return new OpenAIResponsesProvider({
        id: endpoint.id,
        displayName: endpoint.name,
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        timeoutMs: settings.cloudTimeoutMs
      })
    }
    return new OpenAICompatibleProvider({
      id: endpoint.id,
      displayName: endpoint.name,
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      timeoutMs: settings.cloudTimeoutMs
    })
  }

  const tryCloudEndpoint = (
    endpoint: CloudEndpointWithKey,
    reason: string,
    failover = false
  ) => {
    const provider = injectedById.get(endpoint.id) ?? makeCloudProvider(endpoint)
    const cloudBudget = budgetForModel(endpoint.model, 'cloud')
    const reasonWithCtx =
      contextPlan.isTight || contextPlan.forceSummary
        ? `${reason} · ${endpoint.name} · ${contextPlan.note}`
        : `${reason} · ${endpoint.name}`
    return runOn(
      provider,
      endpoint.model,
      decision.target === 'web-augmented-cloud' ? 'web-cloud' : 'cloud',
      reasonWithCtx,
      decision.temperature ?? settings.temperature,
      decision.maxTokens ?? settings.cloudMaxTokens,
      cloudBudget,
      failover
    )
  }

  /** Walk cloud providers; always rotate on rate limit / not-found / auth. */
  const tryCloudQueue = async (reason: string, failover = false) => {
    if (cloudQueue.length === 0) {
      throw new AppError({
        code: 'PROVIDER_UNAVAILABLE',
        message:
          'Ningún proveedor cloud activo con API key. En Ajustes marca «Activo» en OpenRouter/Groq/Gemini y guarda la key.',
        retryable: false
      })
    }

    let lastErr: AppError | null = null
    const tried: string[] = []

    for (let i = 0; i < cloudQueue.length; i++) {
      const base = cloudQueue[i]
      if (isProviderCoolingDown(base.id)) {
        tried.push(`${base.id}:cooldown`)
        continue
      }
      if (!globalCircuitBreaker.canRequest(base.id)) {
        tried.push(`${base.id}:circuit-open`)
        continue
      }

      const mem = applyModelMemory(base.id, base.model)
      const endpoint = { ...base, model: mem.modelId }

      const attemptEndpoint = async (
        ep: typeof endpoint,
        label: string,
        isFailover: boolean
      ) => {
        await tryCloudEndpoint(ep, label, isFailover)
        recordModelSuccess(ep.id, ep.model)
        globalCircuitBreaker.recordSuccess(ep.id)
      }

      try {
        const label =
          i === 0 && !failover && !mem.skipped
            ? reason
            : `Rotación → ${endpoint.name} / ${endpoint.model}${lastErr ? ` (${lastErr.code})` : mem.skipped ? ' (auto-ajuste)' : ''}`
        await attemptEndpoint(endpoint, label, failover || i > 0 || mem.skipped)
        return
      } catch (err) {
        const appErr = AppError.fromUnknown(err)
        lastErr = appErr
        tried.push(`${endpoint.id}/${endpoint.model}:${appErr.code}`)
        recordModelFailure(endpoint.id, endpoint.model, appErr.code, appErr.message)
        if (
          appErr.code === 'PROVIDER_RATE_LIMIT' ||
          appErr.code === 'PROVIDER_QUOTA'
        ) {
          markProviderCooldown(endpoint.id, 90_000)
        } else if (appErr.code === 'PROVIDER_MODEL_NOT_FOUND') {
          markProviderCooldown(endpoint.id, 60_000)
        } else if (appErr.code === 'PROVIDER_AUTH') {
          // Bad key: skip this provider for a while, try the next enabled one
          markProviderCooldown(endpoint.id, 300_000)
        } else if (shouldRotateCloud(appErr.code)) {
          globalCircuitBreaker.recordFailure(endpoint.id, appErr.message)
        } else {
          globalCircuitBreaker.recordFailure(endpoint.id, appErr.message)
        }

        // One recovery with different safe model on same provider
        const safe = suggestSafeModel(endpoint.id, endpoint.model)
        const canRecoverModel =
          safe !== endpoint.model &&
          !isModelBlocked(endpoint.id, safe) &&
          (appErr.code === 'PROVIDER_MODEL_NOT_FOUND' ||
            /unavailable for free|model_not_found|does not exist/i.test(appErr.message))

        if (canRecoverModel) {
          try {
            await attemptEndpoint(
              { ...endpoint, model: safe },
              `Auto-corrección → ${endpoint.name} / ${safe}`,
              true
            )
            return
          } catch (err2) {
            lastErr = AppError.fromUnknown(err2)
            tried.push(`${endpoint.id}/${safe}:${lastErr.code}`)
            recordModelFailure(endpoint.id, safe, lastErr.code, lastErr.message)
            globalCircuitBreaker.recordFailure(endpoint.id, lastErr.message)
          }
        }

        // Always continue to next provider (do not stick on rate limit)
        continue
      }
    }

    // Last resort: OpenRouter free — ignore cooldown/skip so chat does not die
    const orKey = (keys.openrouter || keys.main || '').trim()
    if (orKey.length >= 8) {
      try {
        const { clearProviderCooldown } = await import('@core/models/model-memory')
        clearProviderCooldown('openrouter')
        globalCircuitBreaker.reset?.('openrouter')
      } catch {
        try {
          const { clearProviderCooldown } = await import('@core/models/model-memory')
          clearProviderCooldown('openrouter')
        } catch {
          /* ignore */
        }
      }
      const orSlot =
        cloudQueue.find((c) => c.id === 'openrouter') ||
        slots.find((s) => s.id === 'openrouter') ||
        {
          id: 'openrouter',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'openrouter/free',
          enabled: true,
          priority: 0
        }
      try {
        const ep = {
          ...orSlot,
          id: 'openrouter',
          baseUrl: orSlot.baseUrl || 'https://openrouter.ai/api/v1',
          model: 'openrouter/free',
          apiKey: orKey
        }
        await tryCloudEndpoint(ep, 'Último recurso → OpenRouter / openrouter/free', true)
        recordModelSuccess('openrouter', 'openrouter/free')
        globalCircuitBreaker.recordSuccess('openrouter')
        return
      } catch (err) {
        const appErr = AppError.fromUnknown(err)
        lastErr = appErr
        tried.push(`openrouter/openrouter/free:${appErr.code}`)
        recordModelFailure('openrouter', 'openrouter/free', appErr.code, appErr.message)
      }
    }

    const summary = tried.length ? ` Intentos: ${tried.join(' → ')}` : ''
    const hint =
      tried.some((t) => /NETWORK|TIMEOUT|timeout/i.test(t))
        ? ' Tip: revisa Internet/VPN; si hay descargas grandes, espera o pausa.'
        : tried.some((t) => /RATE_LIMIT|rate_limit|cooldown/i.test(t))
          ? ' Tip: espera 1–2 min o usa OpenRouter free.'
          : tried.some((t) => /AUTH|auth/i.test(t))
            ? ' Tip: revisa API keys en Ajustes → Cloud.'
            : tried.some((t) => /MODEL_NOT_FOUND/i.test(t))
              ? ' Tip: cambia el modelo a openrouter/free o llama-3.1-8b-instant.'
              : ' Tip: Activo + key en OpenRouter; Ollama solo si el modelo ya está instalado.'
    const enabledList = slots.filter((s) => s.enabled).map((s) => s.id).join(', ') || 'ninguno'
    const primaryCode =
      lastErr?.code === 'NETWORK_ERROR' || lastErr?.code === 'PROVIDER_TIMEOUT'
        ? lastErr.code
        : lastErr?.code ?? 'PROVIDER_UNAVAILABLE'
    throw new AppError({
      code: primaryCode,
      message: `Cloud no disponible (activos: ${enabledList}). ${lastErr?.message ?? ''}${summary}.${hint}`,
      provider: lastErr?.provider,
      retryable: true
    })
  }

  try {
    if (decision.target === 'local') {
      try {
        await withRetry(() => tryLocal(decision.reason), {
          maxAttempts: 2,
          signal,
          shouldRetry: (err) =>
            err instanceof AppError &&
            err.retryable &&
            !isContextOrLimitError(err as AppError)
        })
        return
      } catch (err) {
        const appErr = AppError.fromUnknown(err)
        // Forced local mode: never silent OpenRouter
        if (settings.providerMode === 'local') {
          throw new AppError({
            code: appErr.code,
            message:
              `Modelo local falló (${appErr.code}): ${appErr.message}. ` +
              `Revisa Ollama/LM Studio (servidor activo + modelo cargado: ${settings.localModel || 'sin modelo'}). ` +
              (appErr.code === 'PROVIDER_TIMEOUT'
                ? 'El modelo puede estar cargando (LM Studio JIT); espera e inténtalo de nuevo.'
                : ''),
            provider: appErr.provider || local?.id,
            retryable: true
          })
        }
        // Timeout / unavailable local → prefer clear error over fake RATE_LIMIT cloud spam
        if (
          cloudQueue.length > 0 &&
          appErr.code !== 'PROVIDER_TIMEOUT' &&
          appErr.code !== 'STREAM_ABORTED'
        ) {
          globalCircuitBreaker.recordFailure(local?.id ?? 'ollama', appErr.message)
          await tryCloudQueue(
            `Failover tras fallo local [${appErr.code}] ${appErr.message.slice(0, 80)} · modelo=${settings.localModel || '?'}`,
            true
          )
          return
        }
        if (appErr.code === 'PROVIDER_TIMEOUT' && cloudQueue.length > 0) {
          // One soft cloud fallback only after local timeout, with explicit reason
          globalCircuitBreaker.recordFailure(local?.id ?? 'local-openai', appErr.message)
          await tryCloudQueue(
            `Local timeout (${settings.localModel || 'modelo'}) — cloud temporal`,
            true
          )
          return
        }
        throw appErr
      }
    }

    if (cloudQueue.length > 0) {
      try {
        await tryCloudQueue(decision.reason, false)
        return
      } catch (err) {
        const appErr = AppError.fromUnknown(err)
        if (
          local &&
          localModel &&
          (isContextOrLimitError(appErr) ||
            appErr.code === 'PROVIDER_RATE_LIMIT' ||
            appErr.code === 'PROVIDER_QUOTA' ||
            appErr.code === 'PROVIDER_UNAVAILABLE' ||
            appErr.code === 'NETWORK_ERROR' ||
            appErr.code === 'PROVIDER_TIMEOUT')
        ) {
          await tryLocal(`Failover automático → local (${appErr.code})`, true)
          return
        }
        throw appErr
      }
    }

    if (local && localModel) {
      await tryLocal('Último recurso: local', true)
      return
    }

    throw new AppError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'No hay proveedores disponibles. Configura Ollama o un proveedor cloud en Ajustes.',
      retryable: false
    })
  } catch (err) {
    const appErr = AppError.fromUnknown(err)
    if (appErr.provider) {
      globalCircuitBreaker.recordFailure(appErr.provider, appErr.message)
    }
    callbacks.onError?.(appErr)
    throw appErr
  }
}
