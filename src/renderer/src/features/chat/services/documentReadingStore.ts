/**
 * Session + localStorage cache of progressive reading state per conversation.
 * Full document text is recovered from message attachments when possible;
 * here we only persist chapter pointer + rolling summary (small).
 */
import type { DocReadingState } from '@core/chat/document-reading-state'

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
