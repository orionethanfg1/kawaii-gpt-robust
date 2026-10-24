/**
 * Dynamic context budget from the *loaded* model (LMS / Ollama),
 * not only from model-id heuristics.
 *
 * Checkpoint of progressive document reading is independent and untouched:
 * chapterIndex / rollingSummary stay in documentReadingStore.
 */

export type ContextBudget = {
  maxMessages: number
  maxChars: number
  keepRecentMessages: number
  maxTokensHint?: number
  maxSystemChars?: number
}

/** Local copy of heuristic to avoid circular import with conversation/index */
function budgetForModel(model: string, kind: 'local' | 'cloud' = 'local'): ContextBudget {
  const m = (model || '').toLowerCase()
  if (kind === 'local') {
    if (/70b|32b|27b|26b|24b|20b|a4b|gemma-4|gemma4/.test(m)) {
      return {
        maxMessages: 40,
        maxChars: 56_000,
        keepRecentMessages: 14,
        maxTokensHint: 6144,
        maxSystemChars: 32_000
      }
    }
    if (/14b|12b|13b|15b/.test(m)) {
      return { maxMessages: 28, maxChars: 14_000, keepRecentMessages: 10, maxSystemChars: 4_500 }
    }
    if (/7b|8b|9b|3b|1\.|moondream|phi/.test(m)) {
      return {
        maxMessages: 18,
        maxChars: 9_000,
        keepRecentMessages: 7,
        maxTokensHint: 1536,
        maxSystemChars: 3_200
      }
    }
    return {
      maxMessages: 24,
      maxChars: 12_000,
      keepRecentMessages: 10,
      maxTokensHint: 2048,
      maxSystemChars: 4_000
    }
  }
  return {
    maxMessages: 40,
    maxChars: 20_000,
    keepRecentMessages: 12,
    maxTokensHint: 4096,
    maxSystemChars: 6_000
  }
}

export type ModelContextInfo = {
  modelId: string
  /** Tokens reported by runtime (max or loaded) */
  contextTokens: number
  source: 'lmstudio' | 'ollama' | 'heuristic' | 'cache'
  loaded?: boolean
}

type CacheEntry = { info: ModelContextInfo; at: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 45_000

/** ~chars per token for mixed ES/EN prose (conservative) */
const CHARS_PER_TOKEN = 3.2
/** Leave room for the assistant reply + tools */
const REPLY_MARGIN = 0.22
/** Hard floors / ceilings so tiny or huge ctx don't break UI */
const MIN_CTX_TOKENS = 4_096
const MAX_CTX_TOKENS = 128_000

function cacheKey(baseUrl: string, modelId: string) {
  return `${baseUrl.replace(/\/+$/, '')}::${modelId}`
}

function clampTokens(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.max(MIN_CTX_TOKENS, Math.min(MAX_CTX_TOKENS, Math.floor(n)))
}

/**
 * Convert runtime context window (tokens) → ContextBudget in characters.
 */
export function budgetFromContextTokens(
  contextTokens: number,
  opts?: { modelId?: string; kind?: 'local' | 'cloud' }
): ContextBudget {
  const tok = clampTokens(contextTokens)
  const usable = Math.floor(tok * (1 - REPLY_MARGIN))
  const maxChars = Math.max(8_000, Math.floor(usable * CHARS_PER_TOKEN))
  // System can hold progressive doc slices; leave ~55% of input budget for system+docs
  const maxSystemChars = Math.max(4_000, Math.floor(maxChars * 0.55))
  const keepRecent = tok >= 32_000 ? 16 : tok >= 16_000 ? 12 : tok >= 8_000 ? 10 : 8
  const maxMessages = tok >= 32_000 ? 48 : tok >= 16_000 ? 36 : 28
  const maxTokensHint = Math.min(8192, Math.max(1024, Math.floor(tok * REPLY_MARGIN * 0.85)))

  // Merge with heuristic floors so small models never go below known-safe values
  const heuristic = budgetForModel(opts?.modelId || '', opts?.kind || 'local')
  return {
    maxMessages: Math.max(heuristic.maxMessages || 24, maxMessages),
    maxChars: Math.max(heuristic.maxChars || 12_000, maxChars),
    keepRecentMessages: Math.max(heuristic.keepRecentMessages || 8, keepRecent),
    maxTokensHint: Math.max(heuristic.maxTokensHint || 2048, maxTokensHint),
    maxSystemChars: Math.max(heuristic.maxSystemChars || 4_000, maxSystemChars)
  }
}

/**
 * Suggested progressive document slice size (chars) for this budget.
 * Checkpoint still advances by chapterIndex; only the window grows.
 */
export function progressiveSliceCharsForBudget(budget: ContextBudget): number {
  const sys = budget.maxSystemChars || 12_000
  // Leave room for persona + rolling summary + instructions inside system
  const slice = Math.floor(sys * 0.72)
  return Math.max(12_000, Math.min(72_000, slice))
}

function pickContextFromLmRow(m: Record<string, unknown>): number {
  const candidates = [
    m.loaded_context_length,
    m.max_context_length,
    m.context_length,
    m.contextLength,
    m.n_ctx,
    (m as { max_context?: number }).max_context
  ]
  for (const c of candidates) {
    const n = Number(c)
    if (Number.isFinite(n) && n >= 512) return n
  }
  return 0
}

/**
 * Probe LM Studio / Ollama for the model's context window.
 * Prefer *loaded* context when the model is in VRAM.
 */
export async function fetchModelContextInfo(opts: {
  baseUrl: string
  modelId: string
  kind?: 'openai-compatible' | 'ollama' | string
}): Promise<ModelContextInfo | null> {
  const modelId = String(opts.modelId || '').trim()
  const baseRaw = String(opts.baseUrl || '').replace(/\/+$/, '')
  if (!modelId || !baseRaw) return null

  const key = cacheKey(baseRaw, modelId)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.info, source: 'cache' }
  }

  try {
    const { localHttp } = await import('../providers/local-http')
    const root = baseRaw.replace(/\/v1$/i, '')
    const baseV1 = baseRaw.endsWith('/v1') ? baseRaw : `${root}/v1`
    const idLower = modelId.toLowerCase()

    // LM Studio v0 (richest metadata)
    for (const url of [`${root}/api/v0/models`, `${root}/api/v1/models`, `${baseV1}/models`]) {
      try {
        const res = await localHttp(url, {
          timeoutMs: 3_500,
          headers: { Authorization: 'Bearer lm-studio' }
        })
        if (!res.ok) continue
        const json = (await res.json()) as {
          data?: Array<Record<string, unknown>>
          models?: Array<Record<string, unknown>>
        }
        const rows = [...(json.data || []), ...(json.models || [])]
        let best: { tok: number; loaded: boolean } | null = null
        for (const row of rows) {
          const id = String(row.id || row.key || row.name || '')
          if (!id) continue
          const idL = id.toLowerCase()
          if (idL !== idLower && !idL.includes(idLower) && !idLower.includes(idL)) continue
          const tok = pickContextFromLmRow(row)
          if (tok <= 0) continue
          const state = String(row.state || '').toLowerCase()
          const loaded = state === 'loaded' || Number(row.loaded_context_length) > 0
          if (!best || (loaded && !best.loaded) || tok > best.tok) {
            best = { tok, loaded }
          }
        }
        if (best && best.tok > 0) {
          const info: ModelContextInfo = {
            modelId,
            contextTokens: clampTokens(best.tok),
            source: 'lmstudio',
            loaded: best.loaded
          }
          cache.set(key, { info, at: Date.now() })
          return info
        }
      } catch {
        /* try next url */
      }
    }

    // Ollama: /api/show
    try {
      const res = await localHttp(`${root}/api/show`, {
        method: 'POST',
        timeoutMs: 4_000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId })
      })
      if (res.ok) {
        const json = (await res.json()) as {
          model_info?: Record<string, unknown>
          details?: Record<string, unknown>
          parameters?: string
        }
        const infoMap = { ...(json.model_info || {}), ...(json.details || {}) }
        let tok = 0
        for (const [k, v] of Object.entries(infoMap)) {
          if (/context|ctx|num_ctx/i.test(k)) {
            const n = Number(v)
            if (n >= 512) {
              tok = n
              break
            }
          }
        }
        if (!tok && typeof json.parameters === 'string') {
          const m = json.parameters.match(/num_ctx\s+(\d+)/i)
          if (m) tok = Number(m[1])
        }
        if (tok > 0) {
          const info: ModelContextInfo = {
            modelId,
            contextTokens: clampTokens(tok),
            source: 'ollama'
          }
          cache.set(key, { info, at: Date.now() })
          return info
        }
      }
    } catch {
      /* */
    }
  } catch {
    /* */
  }
  return null
}

/**
 * Resolve budget: live context from runtime when possible, else heuristic by model id.
 */
export async function resolveDynamicLocalBudget(
  modelId: string,
  opts?: { baseUrl?: string; kind?: 'local' | 'cloud' }
): Promise<{ budget: ContextBudget; info: ModelContextInfo }> {
  const mid = String(modelId || '')
  const baseUrl = opts?.baseUrl || ''
  let info: ModelContextInfo | null = null
  if (baseUrl) {
    info = await fetchModelContextInfo({
      baseUrl,
      modelId: mid,
      kind: 'openai-compatible'
    })
  }
  if (info && info.contextTokens >= MIN_CTX_TOKENS) {
    return {
      budget: budgetFromContextTokens(info.contextTokens, { modelId: mid, kind: opts?.kind || 'local' }),
      info
    }
  }
  const heuristic = budgetForModel(mid, opts?.kind || 'local')
  return {
    budget: heuristic,
    info: {
      modelId: mid,
      contextTokens: Math.floor((heuristic.maxChars || 16_000) / CHARS_PER_TOKEN / (1 - REPLY_MARGIN)),
      source: 'heuristic'
    }
  }
}

/** Soft module-level hint for document slice size (set each turn). */
let liveDocSliceChars = 24_000
export function setLiveDocSliceChars(n: number): void {
  if (Number.isFinite(n) && n >= 4_000) {
    liveDocSliceChars = Math.min(48_000, Math.floor(n))
  }
}
export function getLiveDocSliceChars(): number {
  return liveDocSliceChars
}
