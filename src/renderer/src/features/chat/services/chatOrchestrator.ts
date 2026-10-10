import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import {
  OllamaProvider,
  OpenAICompatibleProvider,
  resolveLocalRuntime,
  ChatMessage,
  ChatProvider
} from '@core/providers'
import { OpenAIResponsesProvider, isOfficialOpenAI } from '@core/providers/openai-responses'
import { decideRoute, RoutingContext } from '@core/routing'
import { wantsWebSearch } from '@core/tools/web-search-intent'
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
  buildSelectiveUserMemoryPrompt, buildRelationshipContinuityBlock } from '@core/conversation/user-memory'
import { buildRelationshipStageRules } from '@core/conversation/selective-memory-context'
import { buildMoodPromptBlock } from '@core/conversation/mood-memory'
import {
  parseAgendaIntent,
  upsertAgendaItem,
  learnFromFeedback,
  parseLeadMinutesFromText,
  parseInsistFromText
} from '@core/agenda'
import { HUMAN_PRIORITY } from '@core/product/human-priority'
import { buildAssistantMemoryPrompt } from '@core/conversation/assistant-memory'
import {
  buildPronounSystemHint,
  inferAssistantGender,
  normalizeGenderMark
} from '@core/character/pronouns'
import { shouldRunOnboarding, buildOnboardingSystemPrompt, inferStepFromMemory } from '@core/conversation/memory-onboarding'
import { buildConfidenceSystemPrompt } from '@core/conversation/relationship-confidence'
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

import type { RouteInfo, OrchestratorCallbacks, OrchestratorDeps } from './orchestratorTypes'
export type { RouteInfo, OrchestratorCallbacks, OrchestratorDeps } from './orchestratorTypes'

import {
  buildProviders,
  checkAvailability,
  isContextOrLimitError,
  pickSummarizer
} from './orchestratorProviders'
import { applyOrchestratorWebSearch } from './orchestratorWebSearch'
import { createChatRunners } from './orchestratorRun'

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

  const userMemPrompt = buildSelectiveUserMemoryPrompt(settings.userMemory, typeof userContent === "string" ? userContent : "")
  const continuityPrompt = buildRelationshipContinuityBlock(
    settings.userMemory,
    settings.character?.relationshipRole
  )

  const systemMessages: ChatMessage[] = [{ role: 'system', content: characterPrompt }]
  try {
    const pronounHint = buildPronounSystemHint({
      assistantGender: inferAssistantGender({
        explicit: (settings.character as { gender?: string } | undefined)?.gender,
        relationshipRole: settings.character?.relationshipRole,
        name: settings.character?.name,
        personality: settings.character?.personality
      }),
      userGender: normalizeGenderMark(
        (settings as { userGender?: string }).userGender
      ),
      assistantName: settings.character?.name,
      userName: settings.userMemory?.preferredName
    })
    if (pronounHint) {
      systemMessages.push({ role: 'system', content: pronounHint })
    }
  } catch {
    /* pronouns optional */
  }
  if (userMemPrompt) {
    systemMessages.push({ role: 'system', content: userMemPrompt })
  }
  const assistantMemPrompt = buildAssistantMemoryPrompt(settings.assistantMemory, { userText: typeof userContent === "string" ? userContent : "" })
  if (assistantMemPrompt) {
    systemMessages.push({ role: 'system', content: assistantMemPrompt })
  }
  try {
    if (
      shouldRunOnboarding({
        userMemory: settings.userMemory,
        onboarding: (settings as { memoryOnboarding?: { active?: boolean; step?: string; dismissed?: boolean } }).memoryOnboarding,
        memoryGatePending: (settings as { memoryGatePending?: boolean }).memoryGatePending
      })
    ) {
      const step = inferStepFromMemory(settings.userMemory)
      const obStep = ((settings as { memoryOnboarding?: { step?: string } }).memoryOnboarding?.step || step) as import('@core/conversation/memory-onboarding').OnboardingStep
      const onb = buildOnboardingSystemPrompt(obStep === 'done' ? step : obStep)
      if (onb) systemMessages.push({ role: 'system', content: onb })
    }
  } catch {
    /* onboarding optional */
  }
  if (continuityPrompt) {
    systemMessages.push({ role: 'system', content: continuityPrompt })
  }
  try {
    const moodBlock = buildMoodPromptBlock(
      (settings as { userMood?: import('@core/conversation/mood-memory').MoodEntry[] }).userMood,
      (settings as { assistantMood?: import('@core/conversation/mood-memory').MoodEntry[] }).assistantMood,
      { userText: typeof userContent === 'string' ? userContent : '' }
    )
    if (moodBlock) systemMessages.push({ role: 'system', content: moodBlock })
  } catch {
    /* B2b optional */
  }
  // A1+A3 — agenda parse, lead/insist prefs, snooze/cancel learning
  try {
    const ut = typeof userContent === 'string' ? userContent : ''
    const agendaPrefs = (settings as { agendaPrefs?: import('@core/agenda').AgendaPrefs }).agendaPrefs
    const parsed = parseAgendaIntent(ut, { prefs: agendaPrefs })
    const leadTxt = parseLeadMinutesFromText(ut)
    const insistTxt = parseInsistFromText(ut)
    if (leadTxt != null || insistTxt === 'off' || insistTxt === 'gentle' || insistTxt === 'once') {
      let nextPrefs = learnFromFeedback(
        agendaPrefs,
        insistTxt === 'off' ? 'no-insist' : leadTxt != null ? 'set-lead' : 'done',
        leadTxt != null ? { leadMinutes: leadTxt } : undefined
      )
      if (insistTxt) nextPrefs = { ...nextPrefs, insistStyle: insistTxt }
      useSettingsStore.getState().update({ agendaPrefs: nextPrefs } as never)
    }
    if (parsed.ok && (parsed.intent === 'snooze' || parsed.intent === 'cancel')) {
      const prev = ((settings as { agendaItems?: import('@core/agenda').AgendaItem[] }).agendaItems) || []
      const nextPrefs = learnFromFeedback(agendaPrefs, parsed.intent === 'snooze' ? 'snooze' : 'cancel')
      const nextItems = prev.map((it) => {
        if (it.status !== 'pending' && it.status !== 'due' && it.status !== 'snoozed') return it
        if (parsed.intent === 'cancel') {
          return { ...it, status: 'cancelled' as const, updatedAt: Date.now() }
        }
        return {
          ...it,
          status: 'snoozed' as const,
          when: {
            ...it.when,
            kind: 'relative' as const,
            at: Date.now() + 60 * 60_000,
            relativeMs: 60 * 60_000,
            label: 'en una hora (pospuesto)'
          },
          updatedAt: Date.now()
        }
      })
      useSettingsStore.getState().update({ agendaItems: nextItems, agendaPrefs: nextPrefs } as never)
      systemMessages.push({
        role: 'system',
        content: `Agenda: ${parsed.confirmPhrase || 'Hecho.'} No listes IDs técnicos.`
      })
    } else if (parsed.ok && parsed.intent === 'create' && parsed.item && !parsed.needsClarify) {
      const prev = ((settings as { agendaItems?: import('@core/agenda').AgendaItem[] }).agendaItems) || []
      useSettingsStore.getState().update({
        agendaItems: upsertAgendaItem(prev, parsed.item)
      } as never)
      const lead = parsed.item.notify?.leadMinutes
      systemMessages.push({
        role: 'system',
        content:
          `Ya quedó agendado en la app (no digas IDs ni JSON): ${parsed.type === 'talk' ? 'plática' : 'recordatorio'} «${parsed.title}», ${parsed.when?.label || 'a la hora acordada'}. ` +
          (parsed.type === 'reminder' && lead != null && lead > 0
            ? `(aviso ~${lead} min antes). `
            : '') +
          `${HUMAN_PRIORITY.llmGuard} Responde TÚ en personaje, cálido y breve: confirma que se lo recordarás como lo haría una persona cercana. ` +
          `Prohibido: plantillas tipo «Recordatorio: … ¿Lo marcamos listo?», listas de capacidades, tono de sistema o robot. ` +
          (parsed.sensitivity === 'sensitive' ? 'Tema sensible: suavidad, sin presionar. ' : '') +
          `No inventes que el recordatorio ya sonó; solo confirma que quedó pendiente para después.`
      })
    } else if (parsed.ok && parsed.needsClarify && parsed.clarifyQuestion) {
      systemMessages.push({
        role: 'system',
        content: `Agenda: el usuario quiere agendar algo pero falta el tiempo. Pregunta solo: ${parsed.clarifyQuestion}`
      })
    }
  } catch {
    /* A1/A3 optional */
  }
try {
    const stageRules = buildRelationshipStageRules(
      (settings as { relationshipState?: import('@core/conversation/dual-memory').RelationshipState }).relationshipState,
      settings.character?.relationshipRole
    )
    if (stageRules) {
      systemMessages.push({ role: 'system', content: stageRules })
    }
  } catch {
    /* B5 optional */
  }
  try {
    const conf = buildConfidenceSystemPrompt(
      (settings as { relationshipState?: import('@core/conversation/dual-memory').RelationshipState }).relationshipState,
      settings.userMemory
    )
    if (conf) systemMessages.push({ role: 'system', content: conf })
  } catch {
    /* */
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

  const webPack = await applyOrchestratorWebSearch({
    useWebSearch: Boolean(decision.useWebSearch),
    userContent,
    initialUserContent,
    webSearchMaxResults: settings.webSearchMaxResults,
    searxngBaseUrl: (settings as { searxngBaseUrl?: string }).searxngBaseUrl || '',
    systemMessages,
    onPhase: callbacks.onPhase ? (p) => callbacks.onPhase?.(p) : undefined
  })
  let usedWebSearch = webPack.usedWebSearch
  let webHitCount = webPack.webHitCount
  let webSearchAttempted = webPack.webSearchAttempted
  let lastWebResults = webPack.lastWebResults
  userContent = webPack.userContent
  systemMessages.length = 0
  systemMessages.push(...webPack.systemMessages)

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

  const { runOn, tryLocal, tryCloudQueue } = createChatRunners({
    systemMessages,
    history,
    getUserContent: () => userContent,
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
    localModel,
    getCloudQueue: () => cloudQueue,
    injectedCloud,
    slots
  })

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
