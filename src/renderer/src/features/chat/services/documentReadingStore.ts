/**
 * Session + localStorage cache of progressive reading state per conversation.
 * Full document text is recovered from message attachments when possible;
 * here we only persist chapter pointer + rolling summary (small).
 */
import {
  isDocReadingPending,
  isDocReadingComplete,
  type DocReadingState
} from '@core/chat/document-reading-state'
import type { DocEntityIndex } from '@core/chat/document-entity-index'

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

function notifyDocReadingChanged(convId?: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('kawaii:doc-reading-changed', { detail: { convId: convId || null } })
      )
    }
  } catch {
    /* */
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
  let convId: string | undefined
  for (const s of states) {
    if (!s?.key) continue
    all[s.key] = s
    convId = s.convId || convId
  }
  saveAll(all)
  notifyDocReadingChanged(convId)
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
  if (changed) {
    saveAll(all)
    notifyDocReadingChanged(convId)
  }
}

/** Drop finished progressive readings so «Continuar lectura» does not stick open. */
export function pruneCompletedDocReadings(convId?: string): number {
  const all = loadAll()
  let n = 0
  for (const k of Object.keys(all)) {
    const s = all[k]
    if (!s) continue
    if (convId && s.convId !== convId) continue
    if (!isDocReadingPending(s)) {
      delete all[k]
      n++
    }
  }
  if (n) {
    saveAll(all)
    notifyDocReadingChanged(convId)
  }
  return n
}

export function removeDocReadingKey(key: string): void {
  if (!key) return
  const all = loadAll()
  if (all[key]) {
    delete all[key]
    saveAll(all)
  }
}



/** Hide «Continuar lectura» without losing progress (pure chat turns). */
export function suspendDocReadingUi(convId: string): void {
  if (!convId) return
  const all = loadAll()
  let changed = false
  for (const k of Object.keys(all)) {
    const s = all[k]
    if (!s || s.convId !== convId) continue
    if (s.uiSuspended) continue
    all[k] = { ...s, uiSuspended: true, updatedAt: Date.now() }
    changed = true
  }
  if (changed) {
    saveAll(all)
    notifyDocReadingChanged(convId)
  }
}

/** Resume UI after explicit read intent / APP continue / new attach. */
export function resumeDocReadingUi(convId: string): void {
  if (!convId) return
  const all = loadAll()
  let changed = false
  for (const k of Object.keys(all)) {
    const s = all[k]
    if (!s || s.convId !== convId) continue
    if (!s.uiSuspended && s.lastDocTurnAt) continue
    all[k] = {
      ...s,
      uiSuspended: false,
      lastDocTurnAt: Date.now(),
      updatedAt: Date.now()
    }
    changed = true
  }
  if (changed) {
    saveAll(all)
    notifyDocReadingChanged(convId)
  }
}

/** True if any non-suspended progressive reading is still open. */
export function hasActiveDocReadingUi(convId: string): boolean {
  const states = getDocReadingStatesForConv(convId)
  return states.some((s) => {
    if (s.uiSuspended) return false
    return !isDocReadingComplete(s)
  })
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


type DocAutoGlobal = {
  __kawaiiDocAuto?: unknown
  __kawaiiDocAutoGen?: number
  __kawaiiDocAutoTimer?: ReturnType<typeof setTimeout>
}

/** Cancel pending auto-doc-continue (pure chat / write-continue). */
export function cancelPendingDocAutoContinue(_reason?: string): void {
  const g = globalThis as unknown as DocAutoGlobal
  g.__kawaiiDocAutoGen = (g.__kawaiiDocAutoGen || 0) + 1
  if (g.__kawaiiDocAutoTimer != null) {
    try {
      clearTimeout(g.__kawaiiDocAutoTimer)
    } catch {
      /* */
    }
    g.__kawaiiDocAutoTimer = undefined
  }
  g.__kawaiiDocAuto = undefined
}

/** Schedule auto-doc-continue; cancelled by cancelPendingDocAutoContinue. */
export function scheduleDocAutoContinue(fn: () => void, delayMs: number): void {
  const g = globalThis as unknown as DocAutoGlobal
  const gen = g.__kawaiiDocAutoGen || 0
  if (g.__kawaiiDocAutoTimer != null) {
    try {
      clearTimeout(g.__kawaiiDocAutoTimer)
    } catch {
      /* */
    }
  }
  g.__kawaiiDocAutoTimer = setTimeout(() => {
    if ((g.__kawaiiDocAutoGen || 0) !== gen) return
    g.__kawaiiDocAutoTimer = undefined
    try {
      fn()
    } catch {
      /* */
    }
  }, delayMs)
}


/** D3 — Visible roster summary (read-only view model). */
export type DocEntityRosterSummary = {
  key: string
  convId: string
  fileName: string
  characterNames: string[]
  placeNames: string[]
  characterCount: number
  updatedAt: number
  readingComplete: boolean
}

export function listDocEntityRosters(): DocEntityRosterSummary[] {
  const all = loadAll()
  const out: DocEntityRosterSummary[] = []
  for (const s of Object.values(all)) {
    if (!s?.key) continue
    const idx = s.entityIndex
    const chars = idx?.characters || []
    if (!chars.length && !(idx?.places?.length)) continue
    out.push({
      key: s.key,
      convId: s.convId || '',
      fileName: s.fileName || 'documento',
      characterNames: chars.slice(0, 24).map((c) => c.name).filter(Boolean),
      placeNames: (idx?.places || []).slice(0, 12).map((p) => p.name).filter(Boolean),
      characterCount: chars.length,
      updatedAt: idx?.updatedAt || s.updatedAt || 0,
      readingComplete: isDocReadingComplete(s)
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Clear only the entity roster for a reading key; keeps chapter progress. */
export function clearDocEntityIndex(key: string): boolean {
  if (!key) return false
  const all = loadAll()
  const cur = all[key]
  if (!cur) return false
  all[key] = {
    ...cur,
    entityIndex: { characters: [], places: [], updatedAt: Date.now() },
    updatedAt: Date.now()
  }
  saveAll(all)
  notifyDocReadingChanged(cur.convId)
  return true
}

/**
 * Snapshot payload for M0 export (audit). Does not include full book text.
 */
export function exportDocEntityIndexesForSnapshot(): Record<string, unknown> {
  const all = loadAll()
  const entries: Record<string, unknown> = {}
  for (const [key, s] of Object.entries(all)) {
    if (!s?.entityIndex) continue
    const idx = s.entityIndex as DocEntityIndex
    if (!(idx.characters?.length || idx.places?.length)) continue
    entries[key] = {
      convId: s.convId,
      fileName: s.fileName,
      updatedAt: idx.updatedAt || s.updatedAt,
      characters: (idx.characters || []).map((c) => ({
        name: c.name,
        mentions: c.mentions,
        chapterHints: (c.chapterHints || []).slice(-4)
      })),
      places: (idx.places || []).map((p) => ({ name: p.name, mentions: p.mentions }))
    }
  }
  return {
    status: Object.keys(entries).length ? 'loaded' : 'empty',
    count: Object.keys(entries).length,
    entries
  }
}

