/**
 * "Mini IA" ligera: no es una red neuronal.
 * Acumula patrones de error de la app y propone / aplica remedios conocidos.
 * El aprendizaje es pasivo (cada fallo cuenta); no requiere entrenamiento manual.
 */

import {
  recordModelFailure,
  suggestSafeModel,
  isModelBlocked,
  applyModelMemory,
  markProviderCooldown
} from '@core/models/model-memory'
import { SAFE_DEFAULT_MODEL } from '@core/models/free-cloud-catalog'

export type RemedyId =
  | 'switch_safe_model'
  | 'skip_provider'
  | 'check_api_key'
  | 'prefer_local'
  | 'prefer_cloud'
  | 'reduce_context'
  | 'retry_later'
  | 'open_settings'
  | 'none'

export interface LearnedPattern {
  /** Stable key e.g. PROVIDER_MODEL_NOT_FOUND::groq */
  key: string
  code: string
  provider?: string
  count: number
  lastAt: number
  lastMessage?: string
  /** Best remedy observed / mapped */
  remedy: RemedyId
  /** Times this remedy was applied and chat continued */
  remedySuccesses: number
}

export interface RemedySuggestion {
  remedy: RemedyId
  title: string
  detail: string
  /** If true, orchestrator/UI may apply without asking */
  autoApplicable: boolean
  /** Optional model override for switch_safe_model */
  safeModel?: string
  providerId?: string
}

const STORAGE_KEY = 'kawaii-mini-brain-v1'

function load(): Record<string, LearnedPattern> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, LearnedPattern>
  } catch {
    return {}
  }
}

function save(map: Record<string, LearnedPattern>): void {
  try {
    if (typeof localStorage === 'undefined') return
    const entries = Object.entries(map)
    if (entries.length > 100) {
      entries.sort((a, b) => a[1].lastAt - b[1].lastAt)
      map = Object.fromEntries(entries.slice(-80))
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

let cache: Record<string, LearnedPattern> | null = null

function patterns(): Record<string, LearnedPattern> {
  if (!cache) cache = load()
  return cache
}

function patternKey(code: string, provider?: string): string {
  return `${code}::${(provider || 'any').toLowerCase()}`
}

function mapRemedy(code: string, message: string, provider?: string): RemedyId {
  const lower = (message || '').toLowerCase()
  if (
    code === 'PROVIDER_MODEL_NOT_FOUND' ||
    lower.includes('unavailable for free') ||
    lower.includes('not free')
  ) {
    return 'switch_safe_model'
  }
  if (code === 'PROVIDER_AUTH' || lower.includes('invalid api key')) {
    return 'check_api_key'
  }
  if (code === 'PROVIDER_RATE_LIMIT' || code === 'PROVIDER_QUOTA') {
    // Short cooldown via model-memory; don't permanently skip free routers
    return 'retry_later'
  }
  if (code === 'CONTEXT_OVERFLOW') return 'reduce_context'
  if (code === 'PROVIDER_UNAVAILABLE' || code === 'NETWORK_ERROR') {
    if (provider === 'local' || lower.includes('ollama')) return 'prefer_cloud'
    if (code === 'NETWORK_ERROR') return 'retry_later'
    // Prefer rotating model, not blacklisting the whole provider
    return provider === 'groq' ? 'switch_safe_model' : 'retry_later'
  }
  if (code === 'PROVIDER_TIMEOUT') return 'retry_later'
  return 'none'
}

function describe(remedy: RemedyId, provider?: string, safeModel?: string): RemedySuggestion {
  const pid = provider || ''
  switch (remedy) {
    case 'switch_safe_model':
      return {
        remedy,
        title: 'Cambiar a modelo free seguro',
        detail: safeModel
          ? `Usar ${safeModel} en lugar del modelo que falló.`
          : 'Usar el modelo free recomendado para este proveedor.',
        autoApplicable: true,
        safeModel,
        providerId: pid || undefined
      }
    case 'skip_provider':
      return {
        remedy,
        title: 'Probar otro proveedor',
        detail: 'Este proveedor está limitado o saturado; se rota automáticamente.',
        autoApplicable: true,
        providerId: pid || undefined
      }
    case 'check_api_key':
      return {
        remedy,
        title: 'Revisar API key',
        detail: 'La key parece inválida. Abre Ajustes y pega la key correcta del proveedor.',
        autoApplicable: false,
        providerId: pid || undefined
      }
    case 'prefer_local':
      return {
        remedy,
        title: 'Preferir Ollama local',
        detail: 'Cloud no respondió; si hay modelo local, se prioriza.',
        autoApplicable: true
      }
    case 'prefer_cloud':
      return {
        remedy,
        title: 'Preferir cloud',
        detail: 'Ollama no está disponible; se usa cloud si hay key.',
        autoApplicable: true
      }
    case 'reduce_context':
      return {
        remedy,
        title: 'Reducir contexto',
        detail: 'El historial era demasiado largo; se resume o recorta solo.',
        autoApplicable: true
      }
    case 'retry_later':
      return {
        remedy,
        title: 'Reintentar en un momento',
        detail: 'Límite temporal o timeout; espera ~1 min o cambia de proveedor.',
        autoApplicable: false
      }
    case 'open_settings':
      return {
        remedy,
        title: 'Abrir Ajustes',
        detail: 'Hace falta una configuración manual (key, URL, modelo).',
        autoApplicable: false
      }
    default:
      return {
        remedy: 'none',
        title: 'Sin remedio automático',
        detail: 'Se registró el error para detectar el patrón más adelante.',
        autoApplicable: false
      }
  }
}

/** Record an app error; updates frequencies and returns suggestion. */
export function learnFromError(input: {
  code: string
  message: string
  provider?: string
  model?: string
}): RemedySuggestion {
  const { code, message, provider, model } = input
  const key = patternKey(code, provider)
  const remedy = mapRemedy(code, message, provider)
  const prev = patterns()[key]
  const entry: LearnedPattern = {
    key,
    code,
    provider,
    count: (prev?.count ?? 0) + 1,
    lastAt: Date.now(),
    lastMessage: (message || '').slice(0, 240),
    remedy,
    remedySuccesses: prev?.remedySuccesses ?? 0
  }
  cache = { ...patterns(), [key]: entry }
  save(cache)

  // Also feed model-memory when model-related
  if (provider && model) {
    recordModelFailure(provider, model, code, message)
  }

  const safe =
    provider && (remedy === 'switch_safe_model' || remedy === 'skip_provider')
      ? suggestSafeModel(provider, model || '')
      : provider
        ? SAFE_DEFAULT_MODEL[provider]
        : undefined

  return describe(remedy, provider, safe)
}

export function markRemedyWorked(code: string, provider?: string): void {
  const key = patternKey(code, provider)
  const prev = patterns()[key]
  if (!prev) return
  cache = {
    ...patterns(),
    [key]: { ...prev, remedySuccesses: prev.remedySuccesses + 1, lastAt: Date.now() }
  }
  save(cache)
}

export function getTopPatterns(limit = 8): LearnedPattern[] {
  return Object.values(patterns())
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, limit)
}

export function suggestForCurrentState(input: {
  code?: string
  message?: string
  provider?: string
  model?: string
}): RemedySuggestion | null {
  if (input.code) {
    return learnFromError({
      code: input.code,
      message: input.message || '',
      provider: input.provider,
      model: input.model
    })
  }
  // Proactive: if model blocked, suggest switch
  if (input.provider && input.model && isModelBlocked(input.provider, input.model)) {
    const safe = suggestSafeModel(input.provider, input.model)
    return describe('switch_safe_model', input.provider, safe)
  }
  return null
}

/** Snapshot for UI / recovery banner */
export function brainSummary(): {
  patternCount: number
  top: Array<{ key: string; count: number; remedy: RemedyId }>
} {
  const top = getTopPatterns(5).map((p) => ({
    key: p.key,
    count: p.count,
    remedy: p.remedy
  }))
  return { patternCount: Object.keys(patterns()).length, top }
}

export function clearMiniBrain(): void {
  cache = {}
  save({})
}

// re-export apply for orchestrator convenience
export { applyModelMemory, suggestSafeModel }

/** Provider should be skipped this session based on learned failures */
export function shouldSkipProvider(providerId: string, now = Date.now()): boolean {
  const pid = (providerId || '').toLowerCase()
  if (!pid) return false
  // OpenRouter is the free fallback — never fully blacklist it from the queue
  if (pid === 'openrouter') return false

  const all = Object.values(patterns())
  for (const p of all) {
    if ((p.provider || '').toLowerCase() !== pid) continue
    // Auth: skip 20 min
    if (p.remedy === 'check_api_key' && p.count >= 2 && now - p.lastAt < 20 * 60_000) {
      return true
    }
    // Explicit skip: only after repeated failures, shorter window
    if (p.remedy === 'skip_provider' && p.count >= 3 && now - p.lastAt < 5 * 60_000) {
      return true
    }
    // Unavailable / not found: need more failures; 5 min only (not 15)
    if (
      (p.code === 'PROVIDER_UNAVAILABLE' || p.code === 'PROVIDER_MODEL_NOT_FOUND') &&
      p.count >= 4 &&
      now - p.lastAt < 5 * 60_000
    ) {
      return true
    }
  }
  return false
}

/** Sort provider ids: successes first, chronic failures last */
export function rankProvidersByLearning(providerIds: string[]): string[] {
  const scores = new Map<string, number>()
  for (const id of providerIds) {
    scores.set(id, 0)
  }
  for (const p of Object.values(patterns())) {
    const id = (p.provider || '').toLowerCase()
    if (!id || !scores.has(id)) continue
    let delta = 0
    if (p.remedySuccesses > 0) delta += p.remedySuccesses * 5
    if (p.remedy === 'skip_provider' || p.remedy === 'check_api_key') delta -= p.count * 10
    if (p.code === 'PROVIDER_UNAVAILABLE' || p.code === 'PROVIDER_MODEL_NOT_FOUND') {
      delta -= p.count * 4
    }
    if (p.remedy === 'switch_safe_model' && p.remedySuccesses > 0) delta += 3
    scores.set(id, (scores.get(id) || 0) + delta)
  }
  // OpenRouter slight prior for free reliability when tied
  if (scores.has('openrouter')) {
    scores.set('openrouter', (scores.get('openrouter') || 0) + 1)
  }
  return [...providerIds].sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0))
}

/** Soft one-line tip for UI (not a scary banner) */
export function softTipFromLearning(): string | null {
  const top = getTopPatterns(1)[0]
  if (!top || top.count < 2) return null
  if (top.remedy === 'check_api_key') {
    return `Aprendizaje: revisa la API key de ${top.provider || 'cloud'} en Ajustes.`
  }
  if (top.remedy === 'skip_provider' || top.code === 'PROVIDER_UNAVAILABLE') {
    return `Aprendizaje: se evita ${top.provider || 'un proveedor'} un rato por fallos recientes.`
  }
  if (top.remedy === 'prefer_local') {
    return 'Aprendizaje: se prioriza Ollama cuando cloud falla.'
  }
  return null
}
