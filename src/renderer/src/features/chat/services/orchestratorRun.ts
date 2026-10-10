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
    let streamFinishReason: string | null = null

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
          if (chunk.finishReason) streamFinishReason = chunk.finishReason
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
        if (result.content) {
          deliveredChars += result.content.length
          fullAssistantText = result.content
          callbacks.onToken(result.content)
        }
      }

      // Local empty success is a failure (UI would show blank + sticky error later)
      if (deliveredChars === 0) {
        throw new AppError({
          code: 'PROVIDER_UNAVAILABLE',
          message:
            provider.id === 'local-openai' || provider.id === 'ollama'
              ? 'El modelo local no devolvió texto. Carga el modelo, espera a que termine de cargar y reenvía.'
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
        callbacks.onDone?.({
          model,
          provider: provider.id,
          latencyMs,
          route: routeInfo,
          content: fullAssistantText,
          finishReason: streamFinishReason,
          limited:
            streamFinishReason === 'length' ||
            streamFinishReason === 'max_tokens' ||
            (typeof streamFinishReason === 'string' &&
              /length|max_token/i.test(streamFinishReason))
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

const tryLocal = (reason: string, failover = false) => {
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
    (() => {
      const base = Math.min(
        Number(decision.maxTokens ?? settings.localMaxTokens) || 2048,
        2048
      )
      const uc = typeof userContent === 'string' ? userContent.trim() : ''
      if (uc.length > 0 && uc.length <= 24) return Math.min(base, 384)
      if (uc.length > 0 && uc.length <= 80) return Math.min(base, 768)
      return base
    })(),
    localBudget,
    failover,
    {
      topP: decision.topP,
      topK: decision.topK,
      // Local: default thinking off so Qwen3/LM return visible content
      preferThinkingOff: decision.preferThinkingOff !== false
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
