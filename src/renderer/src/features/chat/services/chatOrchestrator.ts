import {
  OllamaProvider,
  OpenAICompatibleProvider,
  resolveLocalRuntime,
  ChatMessage,
  ChatProvider
} from '@core/providers'
import { OpenAIResponsesProvider, isOfficialOpenAI } from '@core/providers/openai-responses'
import { decideRoute, RoutingContext } from '@core/routing'
import { wantsWebSearch, focusSearchQuery } from '@core/tools/web-search-intent'
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
import { buildCharacterSystemPrompt, appearanceReminder, looksLikeAppearanceQuestion, looksLikeAvatarGalleryQuestion, effectiveVisualDescription } from '@core/character/profile'
import { formatCapabilitiesForPrompt } from '@core/capabilities'
import {
  buildUserMemoryPrompt, buildRelationshipContinuityBlock } from '@core/conversation/user-memory'
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
  useWebSearch?: boolean
  webHitCount?: number
  webSources?: { title: string; snippet: string; url?: string }[]
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
  onPhase?: (phase: 'preparing' | 'searching' | 'summarizing' | 'generating' | 'failover') => void
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
): Promise<{
  local: ChatProvider | null
  cloud: ChatProvider | null
  localLabel?: string
  localDefaultModel?: string
}> {
  // LocalInferenceBackend: Ollama and/or LM Studio via one interface
  let local: ChatProvider | null = null
  let localLabel: string | undefined
  let localDefaultModel: string | undefined
  try {
    const pref =
      (settings as { localRuntimePreference?: 'auto' | 'ollama' | 'openai-compatible' })
        .localRuntimePreference || 'auto'
    let openAIUrl =
      ((settings as { localOpenAIBaseUrl?: string }).localOpenAIBaseUrl || '').trim() || undefined
    // Guard: never use Ollama port as LM Studio base
    if (openAIUrl && /:11434\b/.test(openAIUrl)) {
      openAIUrl = undefined
      try {
        const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
        useSettingsStore.getState().update({ localOpenAIBaseUrl: '' })
      } catch {
        /* */
      }
    }
    const modelName = (settings.localModel || '').trim()
    const modelPinned = Boolean(
      (settings as { localModelPinned?: boolean }).localModelPinned
    )
    const { createLocalBackend } = await import('@core/providers/local-backend')
    let created: Awaited<ReturnType<typeof createLocalBackend>> | null = null
    created = await createLocalBackend({
      preference: pref,
      ollamaBaseUrl: settings.localBaseUrl,
      openAIBaseUrl: openAIUrl,
      preferredModel: modelName,
      preferredPinned: modelPinned
    })
    const backend = created?.backend ?? null
    const status = created?.status ?? null
    const resolved = created?.resolved ?? null
    if (backend && status?.healthy) {
      local = backend.asChatProvider()
      localDefaultModel =
        created?.resolvedModelId || status.defaultModel || resolved?.defaultModel
      // Catalog id wins over stale settings (qwen3.5:9b → real LM Studio / Ollama id)
      const mid = created?.resolvedModelId || localDefaultModel || modelName
      localLabel = mid ? `${backend.label} · ${mid}` : backend.label
      if (created?.placementNote) {
        localLabel += ' · auto-match'
      }
      if (status.alsoAvailable?.length === 2) {
        localLabel += ' · ambos runtimes OK'
      }
      if (backend.kind === 'openai-compatible' && backend.baseUrl && !openAIUrl) {
        try {
          const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
          useSettingsStore.getState().update({
            localOpenAIBaseUrl: backend.baseUrl,
            localRuntimePreference: 'auto'
          })
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    local = null
    localLabel = undefined
    localDefaultModel = undefined
  }

  // No silent Ollama-only fallback: null → cloud or clear error

  const cloud = settings.cloudBaseUrl
    ? new OpenAICompatibleProvider({
        id: 'cloud',
        displayName: 'Cloud',
        baseUrl: settings.cloudBaseUrl,
        apiKey,
        timeoutMs: settings.cloudTimeoutMs
      })
    : null

  return { local, cloud, localLabel, localDefaultModel }
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
  // Local is usable if runtime exists; smart pick supplies model id (settings = failover only)
  const localModelConfigured = Boolean(local)
  if (
    !localAvailable &&
    localModelConfigured &&
    settings.providerMode !== 'cloud'
  ) {
    localAvailable = true
  }


  // Offline / network policy for smart hybrid routing
  let networkOnline = true
  try {
    const { isOnlineSync, probeNetwork } = await import('@core/resources')
    networkOnline = isOnlineSync()
    if (networkOnline) {
      // refresh cache opportunistically (non-blocking semantics — probe is sync-fast with navigator)
      void probeNetwork()
    }
  } catch {
    networkOnline = true
  }

  const routingCtx: RoutingContext = {
    prompt: userContent,
    promptLength: userContent.length,
    hasAttachments: false,
    localAvailable,
    cloudAvailable: cloudAvailable && networkOnline,
    webSearchEnabled: settings.webSearchEnabled,
    longPromptThreshold: settings.longPromptThreshold,
    localMaxTokens: settings.localMaxTokens,
    cloudMaxTokens: settings.cloudMaxTokens,
    networkOnline,
    preferLocal: true
  }

  let decision =
    settings.providerMode === 'local'
      ? {
          target: 'local' as const,
          reason: 'Modo forzado: solo local',
          useWebSearch: false,
          temperature: settings.temperature,
          maxTokens: settings.localMaxTokens,
          confidence: 1,
          preferThinkingOff: true
        }
      : settings.providerMode === 'cloud'
        ? networkOnline
          ? {
              target: 'cloud' as const,
              reason: 'Modo forzado: solo cloud',
              useWebSearch: false,
              temperature: settings.temperature,
              maxTokens: settings.cloudMaxTokens,
              confidence: 1
            }
          : {
              target: 'local' as const,
              reason: 'Modo cloud pedido pero sin red — degradación a local',
              useWebSearch: false,
              temperature: settings.temperature,
              maxTokens: settings.localMaxTokens,
              confidence: 0.7,
              preferThinkingOff: true
            }
        : decideRoute(routingCtx)

  // A1/B3: explicit web ask → tool always on (even providerMode local)
  if (wantsWebSearch(userContent)) {
    decision = {
      ...decision,
      useWebSearch: true,
      reason: ((decision.reason || '') + ' · búsqueda web pedida').trim(),
      target: localAvailable
        ? 'web-augmented-local'
        : networkOnline
          ? 'web-augmented-cloud'
          : 'web-augmented-local'
    }
  }

  // If local health failed but user has a local model configured, still TRY local first
  // (health checks are flaky; cloud was broken by localFetch proxy for remote URLs).
  if (
    decision.target === 'local' &&
    !localAvailable &&
    settings.providerMode !== 'local' &&
    cloudQueue.length > 0 &&
    networkOnline
  ) {
    const hasLocalModel = Boolean((settings.localModel || '').trim())
    if (hasLocalModel && local) {
      decision = {
        ...decision,
        target: 'local',
        reason: 'Local configurado — intentando Ollama/LM Studio aunque health falló',
        confidence: 0.75
      }
    } else {
      decision = {
        ...decision,
        target: 'cloud',
        reason: 'Runtime local no disponible — usando cloud',
        confidence: 0.9
      }
    }
  }

  // Product policy: casual chat stays local when runtime exists (ignore telemetry-lean-cloud)
  if (
    decision.target !== 'local' &&
    localAvailable &&
    local &&
    settings.providerMode !== 'cloud' &&
    !decision.useWebSearch
  ) {
    decision = {
      ...decision,
      target: 'local',
      reason: (decision.reason || '') + ' · forzado local-first',
      confidence: Math.max(decision.confidence || 0.5, 0.85),
      preferThinkingOff: true
    }
  }

  // Offline + no local → clear reason (caller still attempts local last)
  if (!networkOnline && decision.target !== 'local' && decision.target !== 'web-augmented-local') {
    decision = {
      ...decision,
      target: 'local',
      reason: 'Sin red — solo local',
      // keep useWebSearch if user asked; fetch will fail soft
      confidence: 0.95
    }
  }


  // B3: re-assert after local-first so useWebSearch never drops
  if (wantsWebSearch(userContent)) {
    decision = {
      ...decision,
      useWebSearch: true,
      target:
        decision.target === 'web-augmented-cloud'
          ? 'web-augmented-cloud'
          : 'web-augmented-local',
      reason: ((decision.reason || '') +
        (decision.reason?.includes('búsqueda web') ? '' : ' · búsqueda web')).trim()
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
  const continuityPrompt = buildRelationshipContinuityBlock(
    settings.userMemory,
    settings.character?.relationshipRole
  )

  const systemMessages: ChatMessage[] = [{ role: 'system', content: characterPrompt }]
  if (userMemPrompt) {
    systemMessages.push({ role: 'system', content: userMemPrompt })
  }
  if (continuityPrompt) {
    systemMessages.push({ role: 'system', content: continuityPrompt })
  }
  if (extraSystem && extraSystem.trim()) {
    systemMessages.push({ role: 'system', content: extraSystem.trim() })
  }
  // Live awareness from capability registry (registerCapability for new layers)
  try {
    const now = new Date()
    const timeLine =
      `Hora local del usuario (aprox.): ${now.toLocaleString()}. ` +
      `Sé consciente del tiempo real: si el usuario tarda mucho en responder, retoma el hilo con naturalidad.`
    const caps = formatCapabilitiesForPrompt({
      imageGenEnabled: settings.imageGenEnabled,
      imageProviderMode: settings.imageProviderMode,
      musicGenEnabled: settings.musicGenEnabled === true,
      videoGenEnabled: settings.videoGenEnabled === true,
      voiceTtsEnabled: (settings as { voiceTtsEnabled?: boolean }).voiceTtsEnabled !== false,
      gamesEnabled: true,
      visionEnabled: true
    })
    systemMessages.push({
      role: 'system',
      content:
        `[EMOJI] Si el usuario usa emojis, interpreta su tono emocional (risa, cariño, tristeza, enfado, etc.) y responde acorde a tu personalidad; no los ignores.\n` +
        caps +
        `\nMÚSICA: distingue (1) letras/ayuda en TEXTO vs (2) GENERAR AUDIO solo si piden pista/audio. ` +
        `Si preguntan «¿puedes…?», resume las capas marcadas SÍ con honestidad. ` +
        `${timeLine}`
    })
  } catch {
    /* ignore */
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
      visualGallery: Array.isArray(settings.character?.visualGallery) ? settings.character.visualGallery : [],
      relationshipRole: settings.character?.relationshipRole,
      traits: Array.isArray(settings.character?.traits) ? settings.character.traits : []
    }
    const galleryCount = (charForLook.visualGallery || []).filter((g: { dataUrl?: string }) => g.dataUrl).length
    if (looksLikeAvatarGalleryQuestion(userContent) || looksLikeAppearanceQuestion(userContent)) {
      if (galleryCount > 0 || charForLook.visualImageUrl) {
        systemMessages.push({
          role: 'system',
          content:
            `[Avatar y galería] Eres ${charForLook.name}. ` +
            (charForLook.visualImageUrl ? 'Tienes avatar principal configurado. ' : '') +
            (galleryCount > 0
              ? `Hay ${galleryCount} foto(s) extra en tu galería de Ajustes: SON TUYAS (referencias de escenas/ropa). Reconócelas; no digas que no las has visto. `
              : '') +
            `Describe tu aspecto solo con la ficha canónica. Si piden verlas, indica Ajustes → Personalidad → galería, o ofrece generar una nueva coherente.`
        })
      }
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

  let usedWebSearch = false
  let webHitCount = 0
  let webSearchAttempted = false
  let lastWebResults: { title: string; snippet: string; url?: string }[] = []
  // A1: mark attempted whenever decision says so (even if IPC missing → pie shows web:0)
  if (decision.useWebSearch) {
    webSearchAttempted = true
    try {
      onPhase?.('searching')
      // Search the ORIGINAL user text, not appearance/system wrappers
      const rawQ = (initialUserContent || userContent || '').trim()
      const topic = focusSearchQuery(
        rawQ
          .replace(/\b(busca|buscar|búsqueda|busqueda)\s+(en\s+)?(la\s+)?(web|internet|google)\b/gi, ' ')
          .replace(/\b(por favor|please)\b/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
      const searchQuery = topic || focusSearchQuery(rawQ) || rawQ
      let results: { title: string; snippet: string; url?: string }[] = []
      if (typeof window !== 'undefined' && window.kawaii?.webSearch) {
        const webOpts = {
          searxngBaseUrl: (settings as { searxngBaseUrl?: string }).searxngBaseUrl || ''
        }
        results = await window.kawaii.webSearch(
          searchQuery,
          settings.webSearchMaxResults,
          webOpts
        )
        if (!results.length && searchQuery !== rawQ) {
          results = await window.kawaii.webSearch(
            rawQ.slice(0, 240),
            settings.webSearchMaxResults,
            webOpts
          )
        }
        // P0.3: keyword-only retry once more if still empty
        if (!results.length) {
          const kw = searchQuery
            .split(/\s+/)
            .filter((w) => w.length > 3)
            .slice(0, 6)
            .join(' ')
          if (kw && kw !== searchQuery) {
            results = await window.kawaii.webSearch(
              kw,
              settings.webSearchMaxResults,
              webOpts
            )
          }
        }
      }
      if (results.length > 0) {
        usedWebSearch = true
        webHitCount = results.length
        lastWebResults = results
        const block = results
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}\n${r.snippet}${r.url ? `\nURL: ${r.url}` : ''}`
          )
          .join('\n\n')
        systemMessages.push({
          role: 'system',
          content:
            `[BÚSQUEDA WEB REALIZADA — ${webHitCount} resultado(s)]\n` +
            `Usa estos datos. NO digas que no puedes navegar: la app ya buscó.\n\n` +
            block
        })
        // Local models (Qwen) often ignore system — put results on the user turn
        userContent =
          `[RESULTADOS DE BÚSQUEDA WEB — la app YA buscó; tienes acceso vía la app. Prohibido decir que no puedes navegar o buscar en internet.]\n` +
          block +
          `\n\n---\nPregunta del usuario: ` +
          userContent
      }
    } catch {
      // best-effort
    }
    if (decision.useWebSearch && !usedWebSearch) {
      const miss =
        '[Búsqueda web: 0 hits. La app SÍ busca en internet; solo no hubo resultados. PROHIBIDO decir que no puedes navegar.]'
      systemMessages.push({
        role: 'system',
        content:
          miss +
          ' Sé honesta; ofrece tips generales con cautela; no inventes URLs. ' +
          'NO digas que nunca puedes buscar: el sistema sí busca, solo falló este intento.'
      })
      userContent =
        miss +
        '\nNo inventes fuentes. Puedes dar consejos generales si aplica.\n\n' +
        'Pregunta del usuario: ' +
        userContent
    }
  }

  // Prefer catalog-resolved default over settings tag that may not exist on the runtime
  const localModel =
    ((built as { localDefaultModel?: string }).localDefaultModel || '').trim() ||
    (settings.localModel || '').trim() ||
    ''
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
    decision.target === 'local' || decision.target === 'web-augmented-local' ? 'local' : 'cloud'
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
    (decision.target === 'local' || decision.target === 'web-augmented-local' || settings.providerMode === 'local') &&
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
    failover = false,
    sampling?: { topP?: number; topK?: number; preferThinkingOff?: boolean }
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
        useWebSearch: webSearchAttempted || decision.useWebSearch || usedWebSearch,
        webHitCount:
          webSearchAttempted || decision.useWebSearch ? webHitCount : undefined,

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
      if (webSearchAttempted || decision.useWebSearch) {
        routeInfo.reason =
          (routeInfo.reason || '') +
          (usedWebSearch
            ? ` · web ${webHitCount} hits`
            : ' · web 0 hits')
        routeInfo.useWebSearch = true // intent: search was requested/attempted
        routeInfo.webHitCount = webHitCount
        routeInfo.webSources = lastWebResults.slice(0, 5)
      }
      callbacks.onRoute?.(routeInfo)

      try {
        const request = {
          model,
          messages: packed.messages,
          temperature,
          maxTokens,
          topP: sampling?.topP,
          topK: sampling?.topK,
          preferThinkingOff: sampling?.preferThinkingOff,
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
        const latencyMs = Date.now() - start
        try {
          const { recordRouteOutcome } = await import('@core/telemetry/route-telemetry')
          const { classifyChatTask } = await import('@core/routing/task-route')
          const task = classifyChatTask(
            typeof userContent === 'string' ? userContent : ''
          )
          recordRouteOutcome({
            task,
            target: routeInfo.target,
            model,
            latencyMs,
            ok: true,
            runtime:
              provider.id === 'ollama'
                ? 'ollama'
                : provider.id === 'local-openai'
                  ? 'openai-compatible'
                  : 'cloud'
          })
        } catch {
          /* telemetry optional */
        }
        // Remember last effective local model in settings (smart pick wins; user can override later)
        try {
          if (
            (provider.id === 'ollama' || provider.id === 'local-openai') &&
            model &&
            String(model).trim()
          ) {
            const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
            const st = useSettingsStore.getState().settings
            const pinned = Boolean((st as { localModelPinned?: boolean }).localModelPinned)
            const cur = (st.localModel || '').trim()
            const next = String(model).trim()
            if (pinned) {
              // Keep user pin; only sync if empty
              if (!cur) {
                useSettingsStore.getState().update({ localModel: next })
              }
            } else if (cur !== next) {
              // Auto mode: remember last effective model without pinning
              useSettingsStore.getState().update({
                localModel: next,
                localModelPinned: false,
                localRuntimePreference: 'auto' as const
              })
            }
          }
        } catch {
          /* settings optional */
        }
        callbacks.onDone?.({
          model,
          provider: provider.id,
          latencyMs,
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
        try {
          const { recordRouteOutcome } = await import('@core/telemetry/route-telemetry')
          const { classifyChatTask } = await import('@core/routing/task-route')
          recordRouteOutcome({
            task: classifyChatTask(typeof userContent === 'string' ? userContent : ''),
            target: routeInfo.target,
            model,
            latencyMs: Date.now() - start,
            ok: false,
            runtime:
              provider.id === 'ollama'
                ? 'ollama'
                : provider.id === 'local-openai'
                  ? 'openai-compatible'
                  : 'cloud',
            errorClass: appErr.code || 'error'
          })
        } catch {
          /* optional */
        }
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
    const localTarget =
      decision.useWebSearch || decision.target === 'web-augmented-local'
        ? 'web-local'
        : 'local'
    return runOn(
      local,
      modelId,
      localTarget,
      reasonWithCtx,
      decision.temperature ?? settings.temperature,
      Math.min(decision.maxTokens ?? settings.localMaxTokens, 2048),
      localBudget,
      failover,
      {
        topP: decision.topP,
        topK: decision.topK,
        preferThinkingOff: decision.preferThinkingOff
      }
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
      decision.target === 'web-augmented-local'
        ? 'web-local'
        : decision.target === 'web-augmented-cloud'
          ? 'web-cloud'
          : 'cloud',
      reasonWithCtx,
      decision.temperature ?? settings.temperature,
      decision.maxTokens ?? settings.cloudMaxTokens,
      cloudBudget,
      failover,
      {
        topP: decision.topP,
        topK: decision.topK,
        preferThinkingOff: decision.preferThinkingOff
      }
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
      message: (() => {
        try {
          const mode = (typeof localStorage !== 'undefined' && localStorage.getItem('kawaii-settings')) || ''
          /* soft: if user was offline or local-first, don't dump localhost proxy noise */
        } catch { /* */ }
        const localHint =
          /Solo se permiten URLs localhost/i.test(String(lastErr?.message || '')) ||
          /localhost/i.test(String(lastErr?.message || ''))
            ? ' La app intentó cloud pero el proxy solo permite localhost — usa Ollama/LM Studio en local (Ajustes → proveedor local) o configura API keys de cloud.'
            : ''
        // Keep technical detail short; character layer can soften in UI
        if (/Solo se permiten URLs localhost/i.test(String(lastErr?.message || ''))) {
          return (
            'No pude usar los proveedores de internet desde aquí. ' +
            'Voy a priorizar tu modelo local (Ollama / LM Studio). ' +
            'Si sigue fallando: Ajustes → proveedor local y comprueba que el servidor está en marcha.'
          )
        }
        return (
          'No pude completar la respuesta con los proveedores en la nube. ' +
          (local && (settings.localModel || '').trim()
            ? 'Prueba de nuevo: debería usarse tu modelo local. '
            : 'Configura Ollama/LM Studio o una API key de cloud en Ajustes. ') +
          `(detalle: ${String(lastErr?.code || '')})`
        )
      })(),
      provider: lastErr?.provider,
      retryable: true
    })
  }

  try {
    if (decision.target === 'local' || decision.target === 'web-augmented-local') {
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
        // Local-first: only escalate to cloud on hard "local is dead" cases when online.
        // Do NOT failover on generic UNAVAILABLE after a single try — retry local once more.
        const hardLocalDead =
          appErr.code === 'NETWORK_ERROR' ||
          (appErr.code === 'PROVIDER_UNAVAILABLE' &&
            /econnrefused|connect|not running|offline|fetch failed/i.test(appErr.message))
        const allowCloud =
          cloudQueue.length > 0 &&
          networkOnline &&
          appErr.code !== 'STREAM_ABORTED' &&
          settings.providerMode !== 'local'

        if (allowCloud && hardLocalDead) {
          globalCircuitBreaker.recordFailure(local?.id ?? 'ollama', appErr.message)
          await tryCloudQueue(
            `Local caído (${appErr.code}) — cloud de respaldo`,
            true
          )
          return
        }
        // Timeout: one more local attempt is handled by withRetry; only then soft cloud
        if (allowCloud && appErr.code === 'PROVIDER_TIMEOUT') {
          globalCircuitBreaker.recordFailure(local?.id ?? 'local-openai', appErr.message)
          await tryCloudQueue(
            `Local timeout (${settings.localModel || 'modelo'}) — cloud temporal`,
            true
          )
          return
        }
        // Model missing / generic fail: surface local error, do not burn cloud keys
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
