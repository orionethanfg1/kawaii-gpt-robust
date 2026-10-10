import { wantsWebSearch } from '../tools/web-search-intent'
import { RouteDecision, RoutingContext, RouteTarget } from './types'
import { profileForPrompt } from '../resources/sampling-profiles'
import { telemetryPreferLocalBias } from '../telemetry/route-telemetry'

const WEB_INTENT_PATTERNS = [
  /\b(busca|buscar|búsqueda|busqueda|googlea|google|internet|en la red|en la web)\b/i,
  /\b(noticias?|hoy|latest|news|current|actualidad|reciente|today|ahora mismo)\b/i,
  /\b(what happened|qué pasó|qué hay de nuevo)\b/i,
  /\b(cómo se (hace|prepara)|como se (hace|prepara)|receta de|tutorial de)\b/i,
  /\b(precio (actual|de)|cotización|weather|clima (hoy|ahora))\b/i
]

const CODING_PATTERNS = [
  /\b(code|código|function|función|class|bug|debug|typescript|javascript|python|sql|api)\b/i,
  /\b(implement|implementa|refactor|escribe (el )?código)\b/i
]

const CREATIVE_PATTERNS = [
  /\b(historia|cuento|poema|poem|story|escribe una|inventa|crea un personaje)\b/i,
  /\b(roleplay|role play|actuá|actúa como)\b/i
]

const SHORT_SUMMARY_PATTERNS = [
  /\b(resume|resumen|summary|tldr|en pocas palabras|brevemente)\b/i
]

const STEP_BY_STEP_PATTERNS = [
  /\b(paso a paso|step by step|explica detalladamente|cómo (se )?hace)\b/i
]

function scoreWebIntent(prompt: string): number {
  if (wantsWebSearch(prompt)) return 0.95
  const p = prompt || ''
  if (WEB_INTENT_PATTERNS.some((re) => re.test(p))) return 0.9
  return 0
}

function isCoding(prompt: string): boolean {
  return CODING_PATTERNS.some((p) => p.test(prompt))
}

function isCreative(prompt: string): boolean {
  return CREATIVE_PATTERNS.some((p) => p.test(prompt))
}

function isShortSummary(prompt: string): boolean {
  return SHORT_SUMMARY_PATTERNS.some((p) => p.test(prompt))
}

function isStepByStep(prompt: string): boolean {
  return STEP_BY_STEP_PATTERNS.some((p) => p.test(prompt))
}

function applyProfile(decision: RouteDecision, prompt: string): RouteDecision {
  const p = profileForPrompt(prompt)
  return {
    ...decision,
    temperature: decision.temperature ?? p.temperature,
    maxTokens: decision.maxTokens ?? p.maxTokensHint,
    topP: decision.topP ?? p.topP,
    topK: decision.topK ?? p.topK,
    preferThinkingOff: decision.preferThinkingOff ?? p.preferThinkingOff
  }
}

/**
 * Deterministic smart router — local-first when online/offline policy allows.
 * Cloud only for web intent, explicit unavailability of local, or extreme length
 * when cloud is available and network is up.
 */
/**
 * B3 Route priority (fixed):
 * 0) Offline → local only, no web
 * 1) Web intent → useWebSearch + local or cloud generation
 * 2) Local available + preferLocal → local
 * 3) Else cloud if available
 */
export function decideRoute(ctx: RoutingContext): RouteDecision {
  const webScore = scoreWebIntent(ctx.prompt)
  const online = ctx.networkOnline !== false
  let preferLocal = ctx.preferLocal !== false

  // Soft bias from on-device telemetry (never overrides offline / web intent)
  let telemetryTag: string | undefined
  try {
    const tb = telemetryPreferLocalBias()
    // Telemetry may TAG lean-cloud but must NOT flip preferLocal off for normal chat.
    // Local-first product: cloud is fallback on hard local failure, not telemetry bias.
    if (tb <= -0.35 && preferLocal && ctx.cloudAvailable && online) {
      telemetryTag = `telemetry-lean-cloud(${tb.toFixed(2)})`
    } else if (tb >= 0.35) {
      preferLocal = true
      telemetryTag = `telemetry-lean-local(${tb.toFixed(2)})`
    } else if (Math.abs(tb) > 0.05) {
      telemetryTag = `telemetry(${tb.toFixed(2)})`
    }
  } catch {
    /* optional */
  }

  // 0) Offline → never cloud
  if (!online) {
    return applyProfile(
      {
        target: 'local',
        reason: 'Sin red — solo local',
        useWebSearch: false,
        temperature: isCoding(ctx.prompt) ? 0.2 : isCreative(ctx.prompt) ? 0.9 : 0.7,
        maxTokens: ctx.localMaxTokens,
        confidence: 0.95,
        tags: ['offline', 'local-only', ...(telemetryTag ? [telemetryTag] : [])]
      },
      ctx.prompt
    )
  }

  // 1) Web-intent → always enable search when online (results injected before LLM).
  // Prefer local model after search when available (hybrid like Open WebUI); else cloud.
  if (webScore >= 0.7 && ctx.webSearchEnabled && online) {
    const useLocal = Boolean(ctx.localAvailable && preferLocal)
    return applyProfile(
      {
        target: useLocal ? 'web-augmented-local' : 'web-augmented-cloud',
        reason: useLocal
          ? 'Búsqueda web + respuesta local'
          : 'Búsqueda web + respuesta cloud',
        useWebSearch: true,
        temperature: 0.5,
        maxTokens: useLocal ? ctx.localMaxTokens : ctx.cloudMaxTokens,
        confidence: webScore,
        tags: ['web', useLocal ? 'local' : 'cloud', ...(telemetryTag ? [telemetryTag] : [])]
      },
      ctx.prompt
    )
  }

  // 2) Local preferred for normal + long prompts (local-first product policy)
  if (ctx.localAvailable && preferLocal) {
    let temperature = 0.7
    let maxTokens = ctx.localMaxTokens

    if (isCoding(ctx.prompt)) temperature = 0.2
    else if (isCreative(ctx.prompt)) temperature = 0.9

    if (isShortSummary(ctx.prompt)) maxTokens = Math.min(maxTokens, 512)
    else if (isStepByStep(ctx.prompt)) maxTokens = Math.max(maxTokens, 1024)

    // Extreme length: allow cloud only if clearly huge and cloud up
    const extreme = ctx.promptLength > Math.max(ctx.longPromptThreshold * 2, 6000)
    if (extreme && ctx.cloudAvailable && !preferLocal) {
      return applyProfile(
        {
          target: 'cloud',
          reason: `Prompt extremo (${ctx.promptLength}) y sin preferencia local estricta`,
          useWebSearch: false,
          temperature: isCoding(ctx.prompt) ? 0.2 : 0.6,
          maxTokens: ctx.cloudMaxTokens,
          confidence: 0.7,
          tags: ['long', 'cloud']
        },
        ctx.prompt
      )
    }

    return applyProfile(
      {
        target: 'local',
        reason: preferLocal
          ? 'Preferencia local (smart / offline-capable)'
          : 'Local disponible',
        useWebSearch: false,
        temperature,
        maxTokens,
        confidence: 0.88,
        tags: ['local-first', ...(telemetryTag ? [telemetryTag] : [])]
      },
      ctx.prompt
    )
  }

  // 3) Local available but preferLocal false (user or telemetry lean-cloud)
  if (ctx.localAvailable && !preferLocal && ctx.cloudAvailable && online) {
    const leanCloud =
      Boolean(telemetryTag?.includes('lean-cloud')) ||
      ctx.promptLength > ctx.longPromptThreshold ||
      isCoding(ctx.prompt) ||
      isStepByStep(ctx.prompt)
    if (leanCloud) {
      return applyProfile(
        {
          target: 'cloud',
          reason: telemetryTag?.includes('lean-cloud')
            ? 'Telemetría: local lento/inestable en esta máquina — cloud'
            : 'Preferencia no-local + prompt exigente — cloud',
          useWebSearch: false,
          temperature: isCoding(ctx.prompt) ? 0.2 : 0.6,
          maxTokens: ctx.cloudMaxTokens,
          confidence: 0.72,
          tags: ['cloud', 'telemetry-aware', ...(telemetryTag ? [telemetryTag] : [])]
        },
        ctx.prompt
      )
    }
  }

  if (ctx.localAvailable) {
    return applyProfile(
      {
        target: 'local',
        reason: 'Local disponible',
        useWebSearch: false,
        temperature: isCoding(ctx.prompt) ? 0.2 : 0.7,
        maxTokens: ctx.localMaxTokens,
        confidence: 0.8,
        tags: ['local', ...(telemetryTag ? [telemetryTag] : [])]
      },
      ctx.prompt
    )
  }

  // 4) Cloud fallback
  if (ctx.cloudAvailable && online) {
    return applyProfile(
      {
        target: 'cloud',
        reason: 'Local no disponible — cloud',
        useWebSearch: false,
        temperature: 0.6,
        maxTokens: ctx.cloudMaxTokens,
        confidence: 0.65,
        tags: ['cloud-fallback', ...(telemetryTag ? [telemetryTag] : [])]
      },
      ctx.prompt
    )
  }

  // 5) Last resort local
  return applyProfile(
    {
      target: 'local',
      reason: 'Sin proveedores reportados; intento local',
      useWebSearch: false,
      temperature: 0.7,
      maxTokens: ctx.localMaxTokens,
      confidence: 0.2,
      tags: ['last-resort']
    },
    ctx.prompt
  )
}

export function routeTargetToProviderKind(target: RouteTarget): 'local' | 'cloud' {
  return target === 'local' ? 'local' : 'cloud'
}
