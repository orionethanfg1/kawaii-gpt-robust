/**
 * Discover free-tier models on OpenRouter for the setup wizard.
 */

export type OpenRouterFreeModel = {
  id: string
  name: string
  free: boolean
  contextLength?: number
}

export type DiscoverOpenRouterResult = {
  ok: boolean
  models: OpenRouterFreeModel[]
  recommendedId: string
  error?: string
}

const FALLBACK_FREE: OpenRouterFreeModel[] = [
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B (free)',
    free: true
  },
  {
    id: 'google/gemma-2-9b-it:free',
    name: 'Gemma 2 9B (free)',
    free: true
  },
  {
    id: 'mistralai/mistral-7b-instruct:free',
    name: 'Mistral 7B (free)',
    free: true
  },
  {
    id: 'openrouter/free',
    name: 'OpenRouter free router',
    free: true
  }
]

function isFreeModel(m: {
  id?: string
  pricing?: { prompt?: string | number; completion?: string | number }
  name?: string
}): boolean {
  const id = String(m.id || '')
  if (/:free$/i.test(id) || /\/free$/i.test(id)) return true
  const p = m.pricing?.prompt
  const c = m.pricing?.completion
  const zp = p === 0 || p === '0' || p === '0.0'
  const zc = c === 0 || c === '0' || c === '0.0'
  return zp && zc
}

/** Preferred free chat models when available on the live list. */
const PREFERRED = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.1-70b-instruct:free',
  'google/gemma-2-9b-it:free',
  'mistralai/mistral-7b-instruct:free',
  'openrouter/free'
]

export async function discoverOpenRouterFreeModels(opts?: {
  apiKey?: string
  timeoutMs?: number
}): Promise<DiscoverOpenRouterResult> {
  const timeoutMs = opts?.timeoutMs ?? 12_000
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (opts?.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) {
      return {
        ok: false,
        models: FALLBACK_FREE,
        recommendedId: FALLBACK_FREE[0].id,
        error: `OpenRouter HTTP ${res.status}`
      }
    }
    const json = (await res.json()) as {
      data?: Array<{
        id?: string
        name?: string
        context_length?: number
        pricing?: { prompt?: string | number; completion?: string | number }
      }>
    }
    const free = (json.data || [])
      .filter((m) => isFreeModel(m))
      .map((m) => ({
        id: String(m.id || ''),
        name: String(m.name || m.id || ''),
        free: true,
        contextLength: m.context_length
      }))
      .filter((m) => m.id)

    const models = free.length ? free.slice(0, 80) : FALLBACK_FREE
    let recommendedId = models[0]?.id || FALLBACK_FREE[0].id
    for (const pref of PREFERRED) {
      if (models.some((m) => m.id === pref)) {
        recommendedId = pref
        break
      }
    }
    return { ok: true, models, recommendedId }
  } catch (e) {
    return {
      ok: false,
      models: FALLBACK_FREE,
      recommendedId: FALLBACK_FREE[0].id,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/** Broad list (free + paid); used by optional tooling. */
export async function discoverOpenRouterModels(opts?: {
  apiKey?: string
}): Promise<Array<{ id: string; name?: string }>> {
  const r = await discoverOpenRouterFreeModels(opts)
  return r.models.map((m) => ({ id: m.id, name: m.name }))
}
