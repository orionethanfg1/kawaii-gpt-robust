/**
 * Live discovery of OpenRouter free models.
 * Best practice: never hardcode only :free slugs — they rotate.
 * Prefer openrouter/free router when available.
 */

export interface DiscoveredFreeModel {
  id: string
  name: string
  contextLength?: number
  description?: string
}

export interface DiscoverFreeResult {
  ok: boolean
  models: DiscoveredFreeModel[]
  error?: string
  /** Recommended default */
  recommendedId: string
}

const FALLBACK: DiscoveredFreeModel[] = [
  { id: 'openrouter/free', name: 'Free Models Router (recomendado)' },
  { id: 'meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B Instruct (free)' },
  { id: 'google/gemma-4-26b-a4b-it:free', name: 'Gemma 4 26B (free)' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'Nemotron 3 Nano (free)' },
  { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder (free)' }
]

function isZeroPrice(v: unknown): boolean {
  if (v == null) return false
  const s = String(v).trim()
  return s === '0' || s === '0.0' || s === '0.00'
}

/** Fetch free models from OpenRouter (key optional for public list on some deployments). */
export async function discoverOpenRouterFreeModels(options: {
  apiKey?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<DiscoverFreeResult> {
  const timeoutMs = options.timeoutMs ?? 12_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort)

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'HTTP-Referer': 'https://kawaii-gpt-robust.local',
      'X-Title': 'KawaiiGPT Robust'
    }
    if (options.apiKey?.trim()) {
      headers.Authorization = `Bearer ${options.apiKey.trim()}`
    }

    const res = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers,
      signal: controller.signal
    })

    if (!res.ok) {
      return {
        ok: false,
        models: FALLBACK,
        recommendedId: 'openrouter/free',
        error: `OpenRouter HTTP ${res.status} — usando lista de respaldo`
      }
    }

    const data = (await res.json()) as {
      data?: Array<{
        id?: string
        name?: string
        description?: string
        context_length?: number
        pricing?: { prompt?: string; completion?: string }
      }>
    }

    const free: DiscoveredFreeModel[] = []
    for (const m of data.data ?? []) {
      if (!m.id) continue
      const id = m.id
      const pricing = m.pricing
      const zero =
        pricing &&
        isZeroPrice(pricing.prompt) &&
        isZeroPrice(pricing.completion)
      const suffixFree = id.endsWith(':free') || id === 'openrouter/free'
      if (!zero && !suffixFree) continue
      free.push({
        id,
        name: m.name || id,
        contextLength: m.context_length,
        description: m.description
      })
    }

    // Ensure router is first if present or always inject
    const hasRouter = free.some((m) => m.id === 'openrouter/free')
    if (!hasRouter) {
      free.unshift({
        id: 'openrouter/free',
        name: 'Free Models Router (recomendado)'
      })
    } else {
      free.sort((a, b) => {
        if (a.id === 'openrouter/free') return -1
        if (b.id === 'openrouter/free') return 1
        return a.id.localeCompare(b.id)
      })
    }

    if (free.length === 0) {
      return {
        ok: false,
        models: FALLBACK,
        recommendedId: 'openrouter/free',
        error: 'No se listaron free; usando respaldo'
      }
    }

    return {
      ok: true,
      models: free.slice(0, 40),
      recommendedId: 'openrouter/free'
    }
  } catch (err) {
    return {
      ok: false,
      models: FALLBACK,
      recommendedId: 'openrouter/free',
      error: err instanceof Error ? err.message : String(err)
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
