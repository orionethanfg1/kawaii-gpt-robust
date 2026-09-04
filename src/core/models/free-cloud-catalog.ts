/**
 * Free / low-cost cloud model catalog for setup + internal routing hints.
 * OpenRouter :free slugs rotate — prefer openrouter/free when unsure.
 * Groq: only list models that work on the free tier (avoid 70B "versatile" traps).
 */

export interface CloudModelOption {
  providerId: string
  providerName: string
  baseUrl: string
  modelId: string
  label: string
  free: boolean
  keyUrl: string
  notes: string
}

export const FREE_CLOUD_CATALOG: CloudModelOption[] = [
  {
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'openrouter/free',
    label: 'Router free (recomendado)',
    free: true,
    keyUrl: 'https://openrouter.ai/keys',
    notes: 'Elige solo modelos free disponibles. Evita slugs :free que caducan.'
  },
  {
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'meta-llama/llama-3.2-3b-instruct:free',
    label: 'Llama 3.2 3B (free)',
    free: true,
    keyUrl: 'https://openrouter.ai/keys',
    notes: 'Ligero; suele estar en el tier free'
  },
  {
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'google/gemma-4-26b-a4b-it:free',
    label: 'Gemma 4 26B (free)',
    free: true,
    keyUrl: 'https://openrouter.ai/keys',
    notes: 'Generalista free vía OpenRouter'
  },
  {
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'qwen/qwen3-coder:free',
    label: 'Qwen3 Coder (free)',
    free: true,
    keyUrl: 'https://openrouter.ai/keys',
    notes: 'Útil para código'
  },
  {
    providerId: 'groq',
    providerName: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelId: 'llama-3.1-8b-instant',
    label: 'Llama 3.1 8B Instant (recomendado Groq)',
    free: true,
    keyUrl: 'https://console.groq.com/keys',
    notes: 'Rápido y estable en el plan free de Groq'
  },
  {
    providerId: 'groq',
    providerName: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelId: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B (Groq — a menudo de pago/límite)',
    free: false,
    keyUrl: 'https://console.groq.com/keys',
    notes: 'NO usar en plan free: rate limit o no disponible. Preferir 8B Instant.'
  },
  {
    providerId: 'gemini',
    providerName: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelId: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    free: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    notes: 'Cuota free de Google AI Studio'
  },
  {
    providerId: 'openai',
    providerName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    free: false,
    keyUrl: 'https://platform.openai.com/api-keys',
    notes: 'De pago; key de platform.openai.com'
  }
]

/** Bad / paid / deprecated ids → safe free alternatives */
export const MODEL_FALLBACK_ALIASES: Record<string, string> = {
  // OpenRouter dead free slugs
  'meta-llama/llama-3.3-70b-instruct:free': 'openrouter/free',
  'meta-llama/llama-3.3-70b-instruct': 'openrouter/free',
  'google/gemini-2.0-flash-exp:free': 'openrouter/free',
  'qwen/qwen-2.5-7b-instruct:free': 'qwen/qwen3-coder:free',
  // Groq traps (70B often fails on free)
  'llama-3.3-70b-versatile': 'llama-3.1-8b-instant',
  'llama3-70b-8192': 'llama-3.1-8b-instant',
  'llama-3.1-70b-versatile': 'llama-3.1-8b-instant',
  'mixtral-8x7b-32768': 'llama-3.1-8b-instant'
}

/** Safe default model per provider (free-tier friendly) */
export const SAFE_DEFAULT_MODEL: Record<string, string> = {
  openrouter: 'openrouter/free',
  groq: 'llama-3.1-8b-instant',
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini'
}

export function resolveModelId(modelId: string): string {
  const id = (modelId || '').trim()
  if (!id) return 'openrouter/free'
  return MODEL_FALLBACK_ALIASES[id] ?? id
}

/** Resolve model with provider-aware safe default */
export function resolveModelIdForProvider(providerId: string, modelId: string): string {
  const resolved = resolveModelId(modelId)
  const pid = (providerId || '').toLowerCase()

  // Groq: never send known-heavy models on free path
  if (pid === 'groq') {
    const lower = resolved.toLowerCase()
    if (
      lower.includes('70b') ||
      lower.includes('mixtral') ||
      lower.includes('versatile')
    ) {
      return SAFE_DEFAULT_MODEL.groq
    }
  }

  // OpenRouter: empty or clearly paid-only without :free → router free
  if (pid === 'openrouter') {
    if (!resolved) return SAFE_DEFAULT_MODEL.openrouter
  }

  // If catalog marks this model as not free, swap to safe default when known
  const entry = FREE_CLOUD_CATALOG.find((m) => m.modelId === resolved && m.providerId === pid)
  if (entry && entry.free === false && SAFE_DEFAULT_MODEL[pid]) {
    return SAFE_DEFAULT_MODEL[pid]
  }

  return resolved || SAFE_DEFAULT_MODEL[pid] || resolved
}

export interface ProviderProbeResult {
  providerId: string
  ok: boolean
  latencyMs?: number
  error?: string
  modelsSample?: string[]
}

export function modelsForProvider(providerId: string): CloudModelOption[] {
  return FREE_CLOUD_CATALOG.filter((m) => m.providerId === providerId)
}

export function defaultModelForProvider(providerId: string): string {
  return (
    SAFE_DEFAULT_MODEL[providerId] ||
    FREE_CLOUD_CATALOG.find((m) => m.providerId === providerId && m.free)?.modelId ||
    FREE_CLOUD_CATALOG.find((m) => m.providerId === providerId)?.modelId ||
    ''
  )
}

export async function probeCloudProvider(options: {
  providerId: string
  baseUrl: string
  apiKey: string
  signal?: AbortSignal
}): Promise<ProviderProbeResult> {
  const { providerId, baseUrl, apiKey, signal } = options
  const start = Date.now()
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/models`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json'
      },
      signal
    })
    const latencyMs = Date.now() - start
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        providerId,
        ok: false,
        latencyMs,
        error: text.slice(0, 200) || `HTTP ${res.status}`
      }
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> }
    const modelsSample = (data.data || [])
      .map((m) => m.id)
      .filter((id): id is string => !!id)
      .slice(0, 12)
    return { providerId, ok: true, latencyMs, modelsSample }
  } catch (err) {
    return {
      providerId,
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
