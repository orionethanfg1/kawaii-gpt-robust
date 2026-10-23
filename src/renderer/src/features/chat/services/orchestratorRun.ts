/**
 * E-ORCH-2: runOn + local/cloud queue (from chatOrchestrator).
 */
import type { ChatMessage, ChatProvider } from '@core/providers'
import { OpenAICompatibleProvider } from '@core/providers'
import { OpenAIResponsesProvider, isOfficialOpenAI } from '@core/providers/openai-responses'
import { globalCircuitBreaker } from '@core/resilience'
import { AppError, classifyProviderError } from '@core/errors'
import {
  applyModelMemory,
  recordModelFailure,
  recordModelSuccess,
  suggestSafeModel,
  markProviderCooldown,
  isProviderCoolingDown
} from '@core/models/model-memory'
import {
  packContext,
  budgetForModel,
  resolveDynamicLocalBudget,
  progressiveSliceCharsForBudget,
  setLiveDocSliceChars,
  type ContextBudget,
  type ContextPlan
} from '@core/conversation'
import {
  shouldRotateCloud,
  type CloudEndpointWithKey
} from '@core/models/cloud-rotation'
import type { Settings } from '@shared/types/settings'
import type { OrchestratorCallbacks, RouteInfo } from './orchestratorTypes'

export type ChatRunContext = {
  systemMessages: ChatMessage[]
  history: ChatMessage[]
  getUserContent: () => string
  activeSummary: string
  activeSummarySource?: 'model' | 'heuristic'
  contextPlan: ContextPlan
  webSearchAttempted: boolean
  usedWebSearch: boolean
  webHitCount: number
  lastWebResults: { title: string; snippet: string; url?: string }[]
  decision: {
    target: string
    reason: string
    useWebSearch?: boolean
    temperature?: number
    maxTokens?: number
    topP?: number
    topK?: number
    preferThinkingOff?: boolean
  }
  settings: Settings
  callbacks: OrchestratorCallbacks
  signal?: AbortSignal
  local: ChatProvider | null
  localModel: string
  getCloudQueue: () => CloudEndpointWithKey[]
  injectedCloud?: Array<{ endpoint: CloudEndpointWithKey; provider: ChatProvider }>
  slots: Array<{
    id: string
    name?: string
    baseUrl?: string
    model?: string
    enabled?: boolean
    priority?: number
  }>
}

/** True if assistant text ends mid-phrase (common when max_tokens hits). */
function looksLikeAbruptCutoff(text: string): boolean {
  const t = String(text || '').trim()
  if (t.length < 40) return false
  // Ends with incomplete Spanish article/possessive mid-clause ("soy toda tu")
  if (/\b(tu|su|mi|la|el|los|las|un|una|de|del|al|con|por|para|que|y|o|e)\s*$/i.test(t)) {
    return true
  }
  if (/[,:;—–\-]\s*$/.test(t)) return true
  // Open dialogue / stage direction without close
  const stars = (t.match(/\*/g) || []).length
  if (stars % 2 === 1) return true
  // Spanish ¿… without closing ?
  if (/¿[^?]*$/.test(t) && !/\?\s*$/.test(t)) return true
  // Opens « or " without close in the tail
  if ((t.match(/«/g) || []).length > (t.match(/»/g) || []).length) return true
  // Long body, last 120 chars have no sentence terminator → very likely truncated
  if (t.length > 180 && !/[.!?…»")\]]\s*$/.test(t)) {
    const tail = t.slice(-120)
    if (!/[.!?…]/.test(tail)) return true
  }
  if (!/[.!?…»")\]]\s*$/.test(t) && /\s\w{1,3}$/i.test(t) && t.length > 200) return true
  // Ends mid-word-ish long Spanish adjective/noun without punct
  if (t.length > 120 && /[a-záéíóúñ]{5,}$/i.test(t) && !/[.!?…»")\]]\s*$/.test(t)) {
    return true
  }
  return false
}

export function createChatRunners(ctx: ChatRunContext) {
  const {
    systemMessages,
    history,
    activeSummary,
    activeSummarySource,
    contextPlan,
    webSearchAttempted,
    usedWebSearch,
    webHitCount,
    lastWebResults,
    decision,
    settings,
    callbacks,
    signal,
    local,
    localModel
  } = ctx

  let userContent = ctx.getUserContent()
  const cloudQueue = () => ctx.getCloudQueue()
  const injectedCloud = ctx.injectedCloud
  const slots = ctx.slots

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
  const runStartedAt = Date.now()
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
    console.warn('[kawaii-memory] runOn-attempt', {
      provider: provider.id,
      model,
      attempt: attempt + 1,
      stream: settings.streaming
    })

    // Hoisted so catch can finalize partial replies (timeout mid-stream)
    let deliveredChars = 0
    let fullAssistantText = ''
    let fullThinkingText = ''
    let streamFinishReason: string | null = null

    try {
      const request = {
        model,
        messages: packed.messages,
        temperature,
        maxTokens,
        topP: sampling?.topP,
        topK: sampling?.topK,
        // Reasoning ON by default; only off if decision asks
        preferThinkingOff:
          sampling?.preferThinkingOff === true ||
          /\[APP\].*lectura|\[LECTURA|documento adjunto/i.test(
            String((packed?.messages || []).map((m: { content?: string }) => m.content || '').join(' ')).slice(-2000)
          ),
        stream: settings.streaming,
        signal
      }
      if (settings.streaming) {
        await provider.chatStream(request, (chunk) => {
          if (chunk.finishReason) streamFinishReason = chunk.finishReason
          if (chunk.thinking) {
            fullThinkingText += chunk.thinking
            callbacks.onThinking?.(chunk.thinking)
          }
          if (chunk.content) {
            deliveredChars += chunk.content.length
            // Accumulate raw deltas for memory collector (UI may collapse mid-stream)
            fullAssistantText += chunk.content
            callbacks.onToken(chunk.content)
          }
        })
      } else {
        const result = await provider.chat(request)
        if (result.finishReason) streamFinishReason = result.finishReason
        if (result.thinking) {
          fullThinkingText = result.thinking
          callbacks.onThinking?.(result.thinking)
        }
        if (result.content) {
          deliveredChars += result.content.length
          fullAssistantText = result.content
          callbacks.onToken(result.content)
        }
      }

      // If only reasoning arrived: keep CoT in thinking; promote only if strip leaves a real reply
      if (deliveredChars === 0 && fullThinkingText.trim().length > 20) {
        try {
          const { stripThinkingLeak, looksLikeStructuredReasoningDump } = await import(
            '@core/chat/strip-thinking'
          )
          const raw = fullThinkingText.trim()
          if (!looksLikeStructuredReasoningDump(raw)) {
            const cleaned = stripThinkingLeak(raw).trim()
            if (cleaned.length > 30 && !looksLikeStructuredReasoningDump(cleaned)) {
              fullAssistantText = cleaned
              deliveredChars = cleaned.length
              callbacks.onToken(cleaned)
            }
          }
          // Always surface full reasoning on the thinking channel for the collapsible panel
          callbacks.onThinking?.(raw)
        } catch {
          /* keep empty — better than dumping CoT into the bubble */
        }
      }
      // Local empty success is a failure (UI would show blank + sticky error later)
      if (deliveredChars === 0) {
        throw new AppError({
          code: 'PROVIDER_UNAVAILABLE',
          message:
            provider.id === 'local-openai' || provider.id === 'ollama'
              ? 'El modelo local no devolvió texto visible (solo razonamiento vacío o stream sin content). Espera a que LMS termine, revisa el modelo cargado y reenvía.'
              : 'El proveedor no devolvió texto en la respuesta.',
          provider: provider.id,
          retryable: true
        })
      }

      globalCircuitBreaker.recordSuccess(provider.id)
      const latencyMs = Date.now() - runStartedAt
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
      // B0: memory collect at orchestrator success (does not rely only on UI onDone)
      try {
        console.warn('[kawaii-memory] orchestrator-success', {
          provider: provider.id,
          model,
          chars: fullAssistantText.length
        })
        if (fullAssistantText.length > 12) {
          const { runAssistantMemoryCollector } = await import(
            './assistantMemoryCollector'
          )
          const memResult = runAssistantMemoryCollector(fullAssistantText)
          console.warn('[kawaii-memory] orchestrator-collect', {
            changed: memResult?.changed,
            reason: memResult?.reason,
            likes: memResult?.memory?.likes?.length || 0
          })
        }
      } catch (memErr) {
        console.warn('[kawaii-memory] orchestrator-collect failed', memErr)
      }
      try {
        try {
          const { stripLeakedVisualDescription } = await import('@core/character/profile')
          fullAssistantText = stripLeakedVisualDescription(
            fullAssistantText,
            settings.character as never
          )
        } catch {
          /* */
        }
        callbacks.onDone?.({
          model,
          provider: provider.id,
          latencyMs,
          route: routeInfo,
          content: fullAssistantText,
          thinking: fullThinkingText || undefined,
          finishReason: streamFinishReason,
          limited:
            streamFinishReason === 'length' ||
            streamFinishReason === 'max_tokens' ||
            (typeof streamFinishReason === 'string' &&
              /length|max_token/i.test(streamFinishReason)) ||
            looksLikeAbruptCutoff(fullAssistantText)
        })
      } catch (doneErr) {
        // UI side-effects must not turn a successful generation into a provider error
        console.warn('[orchestrator] onDone side-effect failed', doneErr)
      }
      return
    } catch (err) {
      const appErr =
        err instanceof AppError ? err : classifyProviderError(String(err), provider.id)
      lastErr = appErr

      // Partial reply delivered via onToken then stream failed (timeout/abort/etc.)
      // Still finalize memory + UI onDone so B0 and user see a completed turn.
      if (fullAssistantText.trim().length > 24 && appErr.code !== 'STREAM_ABORTED') {
        try {
          console.warn('[kawaii-memory] partial-success', {
            provider: provider.id,
            model,
            chars: fullAssistantText.length,
            err: appErr.code
          })
          const { runAssistantMemoryCollector } = await import('./assistantMemoryCollector')
          const memResult = runAssistantMemoryCollector(fullAssistantText)
          console.warn('[kawaii-memory] partial-collect', {
            changed: memResult?.changed,
            reason: memResult?.reason
          })
          callbacks.onDone?.({
            model,
            provider: provider.id,
            latencyMs: Date.now() - runStartedAt,
            route: {
              ...routeInfo,
              reason: (routeInfo.reason || '') + ` · respuesta parcial (${appErr.code})`
            },
            content: fullAssistantText,
            finishReason: streamFinishReason || appErr.code,
            limited: true
          })
          // Accept partial as success for this attempt (do not wipe the bubble)
          globalCircuitBreaker.recordSuccess(provider.id)
          return
        } catch (partialErr) {
          console.warn('[kawaii-memory] partial-success failed', partialErr)
        }
      }

      if (appErr.code === 'CONTEXT_OVERFLOW' && attempt < 2) {
        callbacks.onRoute?.({
          ...routeInfo,
          reason: `${routeInfo.reason} · reintento con contexto reducido (${attempt + 2}/3)`,
          contextPacked: true,
          at: Date.now()
        })
        currentBudget = aggressiveShrink(currentBudget, attempt + 1)
        // Also drop maxTokens a bit to leave room
        maxTokens = Math.max(1024, Math.floor(maxTokens * 0.9))
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
          latencyMs: Date.now() - runStartedAt,
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

const tryLocal = async (reason: string, failover = false) => {
  let modelId = (localModel || '').trim()
  try {
    if (local && !globalCircuitBreaker.canRequest(local.id)) {
      globalCircuitBreaker.recordSuccess(local.id)
    }
  } catch {
    /* ignore */
  }
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
  const localTarget =
    decision.useWebSearch || decision.target === 'web-augmented-local'
      ? 'web-local'
      : 'local'
  const maxTok = (() => {
    const wanted = Math.max(2048, Number(decision.maxTokens ?? settings.localMaxTokens) || 3072)
    const uc = typeof userContent === 'string' ? userContent.trim() : ''
    const reason = String(decision.reason || '')
    const docMode =
      /documento|adjunto|lectura|MODO_DOCUMENTO/i.test(reason) ||
      /\b(opini[oó]n|reseña|qu[eé] (piensas|pensaste)|lo que (has )?le[ií]do|cap[ií]tulo|manuscrito)\b/i.test(
        uc
      ) ||
      /contin[uú]a (escribiendo|desde|la respuesta)/i.test(uc)
    // Local chat / RP: never starve max tokens on short user lines (e.g. "Niamh…").
    // Old caps 384/768 cut Gemma 26B mid-sentence on intimate scenes.
    const ceiling = docMode ? 4096 : 4096
    let base = Math.min(Math.max(wanted, docMode ? 3200 : 1536), ceiling)
    // Soft floor only — short prompts still get room for long assistant prose
    if (!docMode && uc.length > 0 && uc.length <= 24) return Math.max(base, 1536)
    if (!docMode && uc.length > 0 && uc.length <= 80) return Math.max(base, 2048)
    return base
  })()
  const opts = {
    topP: decision.topP,
    topK: decision.topK,
    preferThinkingOff: decision.preferThinkingOff === true
  }
  const attempt = async (mid: string, why: string, isFo: boolean) => {
    let localBudget = budgetForModel(mid, 'local')
    let ctxNote = ''
    try {
      // OpenAICompatibleProvider keeps baseUrl on the instance (runtime)
      const anyProv = local as unknown as { baseUrl?: string }
      let baseUrl = String(anyProv?.baseUrl || '').trim()
      if (!baseUrl) {
        try {
          const { discoverLmStudioServer } = await import('@core/providers/lmstudio-ports')
          const probe = await discoverLmStudioServer({ timeoutMs: 1_500 })
          if (probe.ok && probe.baseUrl) baseUrl = probe.baseUrl
        } catch {
          baseUrl = 'http://127.0.0.1:1234'
        }
      }
      const dyn = await resolveDynamicLocalBudget(mid, {
        baseUrl,
        kind: 'local'
      })
      localBudget = dyn.budget
      setLiveDocSliceChars(progressiveSliceCharsForBudget(dyn.budget))
      if (dyn.info.source !== 'heuristic') {
        ctxNote = ` · ctx ${Math.round(dyn.info.contextTokens / 1024)}k tok (${dyn.info.source}${dyn.info.loaded ? ', loaded' : ''})`
      }
    } catch {
      /* heuristic budget */
    }
    const reasonWithCtx =
      contextPlan.isTight || contextPlan.forceSummary
        ? `${why} · ${contextPlan.note}${ctxNote}`
        : `${why}${ctxNote}`
    return runOn(
      local!,
      mid,
      localTarget,
      reasonWithCtx,
      decision.temperature ?? settings.temperature,
      maxTok,
      localBudget,
      isFo,
      opts
    )
  }
  try {
    await attempt(modelId, reason, failover)
    return
  } catch (firstErr) {
    const appErr = AppError.fromUnknown(firstErr)
    // Only rotate local models on empty / unavailable / timeout — not on user cancel
    const rotate =
      appErr.retryable !== false &&
      /PROVIDER_UNAVAILABLE|PROVIDER_TIMEOUT|empty|no devolvió|no respondió|timed?\s*out/i.test(
        `${appErr.code} ${appErr.message}`
      )
    if (!rotate) throw firstErr

    // Alternate among *enabled* catalog models only (respect disabledLocalModels)
    try {
      const { isLocalModelDisabled } = await import('@core/models/disabled-local-models')
      const disabled =
        (settings as { disabledLocalModels?: string[] }).disabledLocalModels || []
      const pinned = Boolean(
        (settings as { localModelPinned?: boolean }).localModelPinned
      )
      if (pinned) throw firstErr

      let candidates: string[] = []
      try {
        if (typeof (local as { listModels?: () => Promise<Array<{ id: string }>> }).listModels === 'function') {
          const listed = await (
            local as { listModels: () => Promise<Array<{ id: string }>> }
          ).listModels()
          candidates = (listed || []).map((m) => m.id).filter(Boolean)
        }
      } catch {
        /* optional */
      }
      if (!candidates.length) {
        const raw = (settings as { localModelCatalogIds?: string[] }).localModelCatalogIds
        if (Array.isArray(raw)) candidates = raw
      }
      const alts = candidates
        .filter((id) => id && id !== modelId && !isLocalModelDisabled(id, disabled))
        .filter((id) => !/embed|vision|llava|moondream|whisper/i.test(id))
        .slice(0, 3)
      let last = firstErr
      for (const alt of alts) {
        try {
          await attempt(alt, `Failover local → ${alt} (${appErr.code})`, true)
          return
        } catch (e2) {
          last = e2
        }
      }
      throw last
    } catch (e) {
      if (e === firstErr) throw firstErr
      throw e
    }
  }
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
  if (cloudQueue().length === 0) {
    throw new AppError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Ningún proveedor cloud activo con API key. En Ajustes marca «Activo» en OpenRouter/Groq/Gemini y guarda la key.',
      retryable: false
    })
  }

  let lastErr: AppError | null = null
  const tried: string[] = []

  for (let i = 0; i < cloudQueue().length; i++) {
    const base = cloudQueue()[i]
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
      cloudQueue().find((c) => c.id === 'openrouter') ||
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


  return { runOn, tryLocal, tryCloudQueue, tryCloudEndpoint }
}
