import { RouteDecision, RoutingContext, RouteTarget } from './types'

const WEB_INTENT_PATTERNS = [
  /\b(busca|buscar|noticias?|hoy|latest|news|current|actualidad|reciente|today|ahora)\b/i,
  /\b(what happened|qué pasó|qué hay de nuevo)\b/i
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
  return WEB_INTENT_PATTERNS.some((p) => p.test(prompt)) ? 0.9 : 0
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

/**
 * Deterministic, explainable smart router.
 * Prefers local for short / private-friendly prompts,
 * cloud for long / web / heavy prompts.
 */
export function decideRoute(ctx: RoutingContext): RouteDecision {
  const webScore = scoreWebIntent(ctx.prompt)
  const isLong = ctx.promptLength > ctx.longPromptThreshold

  // 1. Web-intent → cloud + web context when possible
  if (webScore >= 0.7 && ctx.webSearchEnabled && ctx.cloudAvailable) {
    return {
      target: 'web-augmented-cloud',
      reason: 'Prompt appears to need fresh/web information',
      useWebSearch: true,
      temperature: 0.5,
      maxTokens: ctx.cloudMaxTokens,
      confidence: webScore
    }
  }

  // 2. Long prompt → prefer cloud if available
  if (isLong && ctx.cloudAvailable) {
    return {
      target: 'cloud',
      reason: `Prompt length (${ctx.promptLength}) exceeds local threshold (${ctx.longPromptThreshold})`,
      useWebSearch: false,
      temperature: isCoding(ctx.prompt) ? 0.2 : isCreative(ctx.prompt) ? 0.85 : 0.6,
      maxTokens: ctx.cloudMaxTokens,
      confidence: 0.8
    }
  }

  // 3. Local preferred when available and prompt is manageable
  if (ctx.localAvailable) {
    let temperature = 0.7
    let maxTokens = ctx.localMaxTokens

    if (isCoding(ctx.prompt)) {
      temperature = 0.2
    } else if (isCreative(ctx.prompt)) {
      temperature = 0.9
    }

    if (isShortSummary(ctx.prompt)) {
      maxTokens = Math.min(maxTokens, 512)
    } else if (isStepByStep(ctx.prompt)) {
      maxTokens = Math.max(maxTokens, 1024)
    }

    return {
      target: 'local',
      reason: 'Short/local-friendly prompt; local provider available',
      useWebSearch: false,
      temperature,
      maxTokens,
      confidence: 0.75
    }
  }

  // 4. Fallback to cloud
  if (ctx.cloudAvailable) {
    return {
      target: 'cloud',
      reason: 'Local unavailable; falling back to cloud',
      useWebSearch: false,
      temperature: 0.6,
      maxTokens: ctx.cloudMaxTokens,
      confidence: 0.6
    }
  }

  // 5. Nothing available
  return {
    target: 'local',
    reason: 'No providers reported available; attempting local as last resort',
    useWebSearch: false,
    temperature: 0.7,
    maxTokens: ctx.localMaxTokens,
    confidence: 0.2
  }
}

export function routeTargetToProviderKind(target: RouteTarget): 'local' | 'cloud' {
  return target === 'local' ? 'local' : 'cloud'
}
