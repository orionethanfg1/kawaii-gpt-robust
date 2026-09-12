/**
 * Harness success / preference memory — what worked so the host can bias plans.
 * Stored in localStorage; lightweight and optional.
 */

export type SuccessEntry = {
  key: string
  count: number
  lastAt: number
  lastNote?: string
}

const STORAGE_KEY = 'kawaii-gpt-harness-success'
const MAX = 30

function load(): SuccessEntry[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const p = JSON.parse(raw) as SuccessEntry[]
    return Array.isArray(p) ? p : []
  } catch {
    return []
  }
}

function save(entries: SuccessEntry[]) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX)))
  } catch {
    /* ignore */
  }
}

export function recordHarnessSuccess(key: string, note?: string): void {
  const k = (key || '').trim().slice(0, 80)
  if (!k) return
  const list = load()
  const i = list.findIndex((e) => e.key === k)
  if (i >= 0) {
    list[i] = {
      ...list[i],
      count: list[i].count + 1,
      lastAt: Date.now(),
      lastNote: note?.slice(0, 160) || list[i].lastNote
    }
  } else {
    list.unshift({ key: k, count: 1, lastAt: Date.now(), lastNote: note?.slice(0, 160) })
  }
  list.sort((a, b) => b.lastAt - a.lastAt)
  save(list)
}

export function recordPreferredLocalModel(modelId: string): void {
  const id = (modelId || '').trim()
  if (!id) return
  recordHarnessSuccess(`localModel:${id}`, 'preferred')
}

export function getPreferredLocalModels(limit = 3): string[] {
  return load()
    .filter((e) => e.key.startsWith('localModel:'))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, limit)
    .map((e) => e.key.replace(/^localModel:/, ''))
}

export function formatSuccessMemoryForPrompt(): string {
  const list = load().slice(0, 8)
  if (!list.length) return ''
  const lines = list.map(
    (e) => `- ${e.key} (×${e.count}${e.lastNote ? `, ${e.lastNote}` : ''})`
  )
  return (
    '[MEMORIA_EXITOS_HARNESS] Preferencias recientes (sesgos suaves, no órdenes):\n' +
    lines.join('\n')
  )
}

export function clearSuccessMemory(): void {
  try {
    localStorage?.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
