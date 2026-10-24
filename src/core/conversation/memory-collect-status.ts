/**
 * B4 — Last assistant-memory collect status (UI-facing, no PII dump).
 * Module singleton; panel polls via getLastMemoryCollectStatus().
 */

export type MemoryCollectStatus = {
  at: number
  ok: boolean
  changed: boolean
  reason?: string
  /** Safe counts only */
  extracted?: { likes?: number; dislikes?: number; habits?: number; relational?: number }
  persistOk?: boolean
  error?: string
}

let last: MemoryCollectStatus | null = null
const listeners = new Set<() => void>()

export function reportMemoryCollectStatus(s: MemoryCollectStatus): void {
  last = { ...s, at: s.at || Date.now() }
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

export function getLastMemoryCollectStatus(): MemoryCollectStatus | null {
  return last
}

/** Subscribe for reactive panel updates (returns unsubscribe). */
export function subscribeMemoryCollectStatus(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function formatMemoryCollectStatus(s: MemoryCollectStatus | null): string {
  if (!s) return 'Aún no hay extracción en esta sesión.'
  const when = new Date(s.at).toLocaleTimeString()
  if (s.error) return `${when}: error al guardar (${s.error})`
  if (!s.ok) return `${when}: fallo en la extracción`
  if (s.changed) {
    const parts: string[] = []
    const e = s.extracted || {}
    if (e.likes) parts.push(`${e.likes} gusto(s)`)
    if (e.relational) parts.push(`${e.relational} vínculo`)
    if (e.dislikes) parts.push(`${e.dislikes} dislike(s)`)
    if (e.habits) parts.push(`${e.habits} hábito(s)`)
    const detail = parts.length ? parts.join(', ') : 'cambios'
    const persist =
      s.persistOk === false ? ' · aviso: no se pudo persistir' : ''
    return `${when}: guardado (${detail})${persist}`
  }
  if (s.reason === 'no-signal') return `${when}: sin recuerdo nuevo en esa respuesta`
  if (s.reason === 'duplicate') return `${when}: ya estaba en memoria (sin cambio)`
  return `${when}: sin cambios (${s.reason || 'ok'})`
}
