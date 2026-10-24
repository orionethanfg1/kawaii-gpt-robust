/**
 * Session + localStorage cache of progressive reading state per conversation.
 * Full document text is recovered from message attachments when possible;
 * here we only persist chapter pointer + rolling summary (small).
 */
import { isDocReadingPending, type DocReadingState } from '@core/chat/document-reading-state'

const LS_KEY = 'kawaii.docReading.v1'
const MAX_ENTRIES = 40

type StoreShape = Record<string, DocReadingState>

function loadAll(): StoreShape {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as StoreShape
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveAll(map: StoreShape): void {
  try {
    const keys = Object.keys(map)
    if (keys.length > MAX_ENTRIES) {
      const sorted = keys
        .map((k) => ({ k, t: map[k]?.updatedAt || 0 }))
        .sort((a, b) => b.t - a.t)
        .slice(0, MAX_ENTRIES)
      const next: StoreShape = {}
      for (const { k } of sorted) next[k] = map[k]
      localStorage.setItem(LS_KEY, JSON.stringify(next))
      return
    }
    localStorage.setItem(LS_KEY, JSON.stringify(map))
  } catch {
    /* quota */
  }
}

export function getDocReadingStatesForConv(convId: string): DocReadingState[] {
  const all = loadAll()
  return Object.values(all).filter((s) => s && s.convId === convId)
}

export function upsertDocReadingStates(states: DocReadingState[]): void {
  if (!states?.length) return
  const all = loadAll()
  for (const s of states) {
    if (!s?.key) continue
    all[s.key] = s
  }
  saveAll(all)
}

export function clearDocReadingForConv(convId: string): void {
  const all = loadAll()
  let changed = false
  for (const k of Object.keys(all)) {
    if (all[k]?.convId === convId) {
      delete all[k]
      changed = true
    }
  }
  if (changed) saveAll(all)
}

export type PendingDocReading = {
  key: string
  convId: string
  fileName: string
  mode: string
  chapterIndex: number
  chapterCount: number
  updatedAt: number
  label: string
}

/** All incomplete readings (any conversation). Survives restarts via localStorage. */
export function listPendingDocReadings(): PendingDocReading[] {
  const all = loadAll()
  const out: PendingDocReading[] = []
  for (const s of Object.values(all)) {
    if (!s || !isDocReadingPending(s)) continue
    const rem = s as DocReadingState & { mode?: string; ingestComplete?: boolean }
    const mode = rem.mode === 'read_and_remember' ? 'read_and_remember' : 'progressive'
    const label =
      mode === 'read_and_remember'
        ? `«${s.fileName || 'documento'}» · ingesta a medias (${s.chapterIndex}/${s.chapterCount})`
        : `«${s.fileName || 'documento'}» · lectura ${s.chapterIndex}/${s.chapterCount}`
    out.push({
      key: s.key,
      convId: s.convId,
      fileName: s.fileName || 'documento',
      mode,
      chapterIndex: s.chapterIndex || 0,
      chapterCount: s.chapterCount || 0,
      updatedAt: s.updatedAt || 0,
      label
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Human summary for boot / autodiagn / pre-update. */
export function summarizePendingDocReadings(max = 5): string {
  const list = listPendingDocReadings()
  if (!list.length) return ''
  const head = list.slice(0, max).map((x) => x.label).join(' · ')
  const more = list.length > max ? ` (+${list.length - max})` : ''
  return `${list.length} lectura(s) pendiente(s): ${head}${more}`
}
