/**
 * Learns which provider/model pairs fail (esp. non-free) and avoids them.
 * Persisted in localStorage so the app self-corrects across sessions.
 */

import { SAFE_DEFAULT_MODEL, resolveModelIdForProvider } from './free-cloud-catalog'

export type ModelFailureKind = 'not_free' | 'not_found' | 'rate_limit' | 'auth' | 'other'

export interface ModelMemoryEntry {
  providerId: string
  modelId: string
  kind: ModelFailureKind
  count: number
  lastAt: number
  lastMessage?: string
}

const STORAGE_KEY = 'kawaii-model-memory-v1'

function keyOf(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`.toLowerCase()
}

function loadMap(): Record<string, ModelMemoryEntry> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, ModelMemoryEntry>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveMap(map: Record<string, ModelMemoryEntry>): void {
  try {
    if (typeof localStorage === 'undefined') return
    // Cap size
    const entries = Object.entries(map)
    if (entries.length > 80) {
      entries.sort((a, b) => a[1].lastAt - b[1].lastAt)
      const trimmed = Object.fromEntries(entries.slice(-60))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* quota */
  }
}

let cache: Record<string, ModelMemoryEntry> | null = null

function map(): Record<string, ModelMemoryEntry> {
  if (!cache) cache = loadMap()
  return cache
}

export function classifyFailureKind(
  code: string,
  message: string
): ModelFailureKind {
  const lower = (message || '').toLowerCase()
  if (
    code === 'PROVIDER_MODEL_NOT_FOUND' ||
    lower.includes('unavailable for free') ||
    lower.includes('not available on the free') ||
    lower.includes('not free') ||
    lower.includes('requires a paid') ||
    lower.includes('model_not_found')
  ) {
    return lower.includes('free') || lower.includes('paid') ? 'not_free' : 'not_found'
  }
  if (code === 'PROVIDER_RATE_LIMIT' || lower.includes('rate limit')) {
    return 'rate_limit'
  }
  if (code === 'PROVIDER_AUTH' || lower.includes('invalid api key')) {
    return 'auth'
  }
  return 'other'
}

/** Hard avoid: not_free / not_found after 1 failure; rate_limit after 2 */
export function isModelBlocked(providerId: string, modelId: string): boolean {
  const e = map()[keyOf(providerId, modelId)]
  if (!e) return false
  if (e.kind === 'not_free' || e.kind === 'not_found') return e.count >= 1
  if (e.kind === 'rate_limit') return e.count >= 2
  return false
}

export function recordModelFailure(
  providerId: string,
  modelId: string,
  code: string,
  message: string
): ModelMemoryEntry {
  const kind = classifyFailureKind(code, message)
  const k = keyOf(providerId, modelId)
  const prev = map()[k]
  const entry: ModelMemoryEntry = {
    providerId,
    modelId,
    kind,
    count: (prev?.count ?? 0) + 1,
    lastAt: Date.now(),
    lastMessage: (message || '').slice(0, 240)
  }
  cache = { ...map(), [k]: entry }
  saveMap(cache)
  // After repeated model-not-found on same provider, cool the whole provider briefly
  if (kind === 'not_found' && entry.count >= 2) {
    // OpenRouter: never cool the whole provider long — only the model is blocked
    if (providerId.toLowerCase() !== 'openrouter') {
      markProviderCooldown(providerId, 60_000)
    }
  }
  if (kind === 'auth') {
    markProviderCooldown(providerId, 300_000)
  }
  return entry
}

export function recordModelSuccess(providerId: string, modelId: string): void {
  const k = keyOf(providerId, modelId)
  const m = map()
  if (!(k in m)) return
  // Partial forgiveness: drop entry so model can be tried again later
  const next = { ...m }
  delete next[k]
  cache = next
  saveMap(next)
}

export function suggestSafeModel(providerId: string, currentModel: string): string {
  const safe = SAFE_DEFAULT_MODEL[providerId] || resolveModelIdForProvider(providerId, currentModel)
  if (safe !== currentModel && !isModelBlocked(providerId, safe)) return safe
  // fallback chain
  if (providerId === 'openrouter') return 'openrouter/free'
  if (providerId === 'groq') return 'llama-3.1-8b-instant'
  if (providerId === 'gemini') return 'gemini-2.0-flash'
  return resolveModelIdForProvider(providerId, currentModel)
}

/**
 * Rewrite endpoint model if blocked or known-bad; returns possibly updated model id.
 */
export function applyModelMemory(
  providerId: string,
  modelId: string
): { modelId: string; skipped: boolean; reason?: string } {
  const resolved = resolveModelIdForProvider(providerId, modelId)
  if (isModelBlocked(providerId, resolved)) {
    const alt = suggestSafeModel(providerId, resolved)
    return {
      modelId: alt,
      skipped: alt !== resolved,
      reason: `Modelo ${resolved} marcado por fallos previos → ${alt}`
    }
  }
  if (resolved !== modelId) {
    return { modelId: resolved, skipped: true, reason: `Alias de seguridad → ${resolved}` }
  }
  return { modelId: resolved, skipped: false }
}

export function listModelMemory(): ModelMemoryEntry[] {
  return Object.values(map()).sort((a, b) => b.lastAt - a.lastAt)
}

export function clearModelMemory(): void {
  cache = {}
  saveMap({})
}


/** Provider-level cooldown (e.g. rate limit) — skip for a short window */
const PROVIDER_COOLDOWN_KEY = 'kawaii-provider-cooldown-v1'

function loadCooldowns(): Record<string, number> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(PROVIDER_COOLDOWN_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function saveCooldowns(map: Record<string, number>): void {
  try {
    if (typeof localStorage === 'undefined') return
    const now = Date.now()
    const cleaned: Record<string, number> = {}
    for (const [k, until] of Object.entries(map)) {
      if (until > now) cleaned[k] = until
    }
    localStorage.setItem(PROVIDER_COOLDOWN_KEY, JSON.stringify(cleaned))
  } catch {
    /* ignore */
  }
}

/** Mark provider unavailable until `untilMs` */
export function markProviderCooldown(providerId: string, durationMs = 90_000): void {
  const map = loadCooldowns()
  map[providerId.toLowerCase()] = Date.now() + durationMs
  saveCooldowns(map)
}

export function isProviderCoolingDown(providerId: string, now = Date.now()): boolean {
  const map = loadCooldowns()
  const until = map[providerId.toLowerCase()]
  return typeof until === 'number' && until > now
}

export function clearProviderCooldown(providerId?: string): void {
  if (!providerId) {
    saveCooldowns({})
    return
  }
  const map = loadCooldowns()
  delete map[providerId.toLowerCase()]
  saveCooldowns(map)
}
