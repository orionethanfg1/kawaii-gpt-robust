/**
 * Structured log when memory is actually persisted.
 * Used by UI console, optional disk audit, and unit/E2E tests.
 * Never stores full chat transcripts — only field names + short samples.
 */

export type MemoryWriteSide = 'user' | 'assistant' | 'relationship' | 'intimacy' | 'episode'

export type MemoryWriteEntry = {
  id: string
  at: number
  side: MemoryWriteSide
  /** Why this write happened */
  reason: string
  /** Field → count of items written / added */
  fields: Record<string, number>
  /** Short samples (max ~40 chars each) for verification without PII dumps */
  samples?: Record<string, string[]>
  persistOk: boolean
  error?: string
  /** Optional conversation id */
  conversationId?: string
}

const MAX = 80
const ring: MemoryWriteEntry[] = []
const listeners = new Set<(e: MemoryWriteEntry) => void>()

function nextId(): string {
  return `mw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** Truncate samples for safe logs/tests */
export function clipSamples(
  map: Record<string, string[] | undefined>,
  maxPerField = 4,
  maxLen = 48
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [k, arr] of Object.entries(map)) {
    if (!arr?.length) continue
    out[k] = arr
      .filter(Boolean)
      .slice(0, maxPerField)
      .map((s) => String(s).replace(/\s+/g, ' ').trim().slice(0, maxLen))
  }
  return out
}

export function recordMemoryWrite(
  partial: Omit<MemoryWriteEntry, 'id' | 'at'> & { at?: number }
): MemoryWriteEntry {
  const entry: MemoryWriteEntry = {
    id: nextId(),
    at: partial.at || Date.now(),
    side: partial.side,
    reason: partial.reason || 'write',
    fields: { ...(partial.fields || {}) },
    samples: partial.samples ? { ...partial.samples } : undefined,
    persistOk: partial.persistOk !== false,
    error: partial.error,
    conversationId: partial.conversationId
  }
  ring.push(entry)
  while (ring.length > MAX) ring.shift()

  // Console: always visible for developer + test harness scraping
  try {
    const fieldBits = Object.entries(entry.fields)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(' ')
    const sampleBits = entry.samples
      ? Object.entries(entry.samples)
          .map(([k, xs]) => `${k}:[${xs.join(' | ')}]`)
          .join(' ')
      : ''
    const line =
      `[memory-write] ${entry.side} ${entry.persistOk ? 'OK' : 'FAIL'} ` +
      `${entry.reason}` +
      (fieldBits ? ` · ${fieldBits}` : '') +
      (sampleBits ? ` · ${sampleBits}` : '') +
      (entry.error ? ` · err=${entry.error}` : '')
    if (entry.persistOk) console.info(line)
    else console.warn(line)
  } catch {
    /* */
  }

  for (const fn of listeners) {
    try {
      fn(entry)
    } catch {
      /* */
    }
  }

  // Best-effort disk append via main (if preload exposes it)
  try {
    const k = (typeof window !== 'undefined'
      ? (window as unknown as { kawaii?: { memoryWriteLogAppend?: (e: Record<string, unknown>) => Promise<unknown> } }).kawaii
      : undefined)
    if (k?.memoryWriteLogAppend) {
      void k.memoryWriteLogAppend(entry as unknown as Record<string, unknown>)
    }
  } catch {
    /* optional IPC */
  }

  return entry
}

/** Newest-last copy for tests */
export function getMemoryWriteLog(limit = 40): MemoryWriteEntry[] {
  return ring.slice(-Math.max(1, limit))
}

export function clearMemoryWriteLog(): void {
  ring.length = 0
}

export function subscribeMemoryWriteLog(fn: (e: MemoryWriteEntry) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Last successful write for a side (or any if side omitted) */
export function getLastMemoryWrite(side?: MemoryWriteSide): MemoryWriteEntry | null {
  for (let i = ring.length - 1; i >= 0; i--) {
    if (!side || ring[i].side === side) return ring[i]
  }
  return null
}

/** Test helper: did we persist a user like containing needle? */
export function memoryWriteLogHasSample(
  side: MemoryWriteSide,
  field: string,
  needle: string | RegExp
): boolean {
  const re = typeof needle === 'string' ? new RegExp(needle, 'i') : needle
  for (let i = ring.length - 1; i >= 0; i--) {
    const e = ring[i]
    if (e.side !== side || !e.persistOk) continue
    const xs = e.samples?.[field] || []
    if (xs.some((s) => re.test(s))) return true
  }
  return false
}

export function formatMemoryWriteEntry(e: MemoryWriteEntry | null): string {
  if (!e) return 'Sin escrituras de memoria en esta sesión.'
  const when = new Date(e.at).toLocaleTimeString()
  const fields = Object.entries(e.fields)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}:${n}`)
    .join(', ')
  return `${when} · ${e.side} · ${e.persistOk ? 'guardado' : 'fallo'} · ${e.reason}` +
    (fields ? ` · ${fields}` : '')
}
