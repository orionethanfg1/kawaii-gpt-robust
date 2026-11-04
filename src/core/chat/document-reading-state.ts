/**
 * Progressive document reading state (structure-aware + refine-style rolling summary).
 * Best practices for small local models:
 * - Chapter / section boundaries first (not fixed-size only)
 * - One coherent slice per turn (~14k chars) leaving room for response
 * - Rolling summary of already-read parts (refine pattern) instead of re-injecting the whole book
 * - Explicit "sigue / capítulo N" advance so the model never invents unread content
 */

import { splitIntoChapters, type DocChapter } from './document-chunks'

export type DocReadingState = {
  /** Stable key: conversation + file identity */
  key: string
  convId: string
  fileName: string
  /** Full extracted text kept only in session/store; not re-embedded every turn beyond the slice */
  totalChars: number
  chapterIndex: number
  chapterCount: number
  /** Titles already fully or partially presented to the model */
  readTitles: string[]
  /**
   * How many times each chapter title was presented (awareness of re-reads).
   * Key = title string as stored in readTitles.
   */
  chapterVisitCounts?: Record<string, number>
  /** Compact rolling summary of prior slices (refine / map-reduce reduce side) */
  rollingSummary: string
  /**
   * Absolute char offset into full document text already presented (within long chapters).
   * Prevents re-sending the same start of Capítulo 10 forever.
   */
  streamOffset?: number
  updatedAt: number
  /**
   * Fingerprint of the source file when first extracted (size + mtime).
   * If the user re-attaches a modified document, delta re-ingest can detect it.
   */
  sourceFingerprint?: string
  sourcePath?: string
}

export function makeDocReadingKey(convId: string, fileName: string, totalChars: number): string {
  const name = (fileName || 'documento').toLowerCase().replace(/\s+/g, '_').slice(0, 64)
  return `${convId}::${name}::${totalChars}`
}

/** size:mtimeMs — cheap change detector without hashing whole book */
export function makeSourceFingerprint(size: number, mtimeMs: number): string {
  return `${Math.max(0, Math.floor(size))}:${Math.max(0, Math.floor(mtimeMs))}`
}

/**
 * True if the on-disk file no longer matches the fingerprint stored when we ingested.
 * Call when the user re-attaches or the app notices a new extract path.
 */
export function documentSourceChanged(
  state: DocReadingState | null | undefined,
  size: number,
  mtimeMs: number
): boolean {
  if (!state?.sourceFingerprint) return false
  const next = makeSourceFingerprint(size, mtimeMs)
  return next !== state.sourceFingerprint
}


export function emptyDocReadingState(
  convId: string,
  fileName: string,
  totalChars: number,
  chapterCount: number,
  source?: { fingerprint?: string; path?: string }
): DocReadingState {
  return {
    key: makeDocReadingKey(convId, fileName, totalChars),
    convId,
    fileName,
    totalChars,
    chapterIndex: 0,
    chapterCount: Math.max(1, chapterCount),
    readTitles: [],
    rollingSummary: '',
    streamOffset: 0,
    updatedAt: Date.now(),
    sourceFingerprint: source?.fingerprint,
    sourcePath: source?.path
  }
}

/**
 * MAP step: extract structured facts from a progressive-reading slice (no LLM).
 * Prefer names, dialogue hooks, and concrete clauses over a single truncated sentence.
 */
export function mapSliceToFacts(sliceBody: string, chapterTitles: string[]): string {
  const titleBit = chapterTitles.filter(Boolean).join(' · ').slice(0, 100)
  const cleaned = (sliceBody || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return titleBit ? `• ${titleBit}: (tramo vacío)` : '• (tramo vacío)'

  const facts: string[] = []
  // Quoted dialogue (short)
  const quotes = cleaned.match(/[«"]([^«»"]{12,120})[»"]/g) || []
  for (const q of quotes.slice(0, 2)) {
    facts.push('diálogo: ' + q.replace(/\s+/g, ' ').slice(0, 100))
  }
  // Capitalized multi-word names (ES/EN-ish)
  const names = cleaned.match(
    /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2}\b/g
  ) || []
  const uniqNames = [...new Set(names.map((n) => n.trim()))].filter(
    (n) => n.length > 2 && !/^(El|La|Los|Las|Un|Una|The|A|An|Y|O|De|Del|En|Por|Con|Chapter|Capítulo)$/i.test(n)
  )
  if (uniqNames.length) facts.push('nombres: ' + uniqNames.slice(0, 8).join(', '))

  // First 2 sentence-like clauses
  const sentences = cleaned.split(/(?<=[.!?…])\s+/).filter((s) => s.length > 25)
  for (const s of sentences.slice(0, 2)) {
    facts.push(s.slice(0, 180) + (s.length > 180 ? '…' : ''))
  }
  if (!facts.length) facts.push(cleaned.slice(0, 400) + (cleaned.length > 400 ? '…' : ''))

  const body = facts.map((f) => '  – ' + f).join('\n')
  return (titleBit ? `• ${titleBit}:\n` : '• Tramo:\n') + body
}

/**
 * REDUCE step: merge map lines into a rolling summary with a hard cap (newest kept).
 */
export function reduceRollingSummary(prev: string, mappedLine: string, maxSummaryChars = 2800): string {
  const lines = [...(prev || '').split('\n'), mappedLine]
    .map((l) => l.trim())
    .filter(Boolean)
  // Drop near-duplicate map lines (same first 48 chars)
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const line of lines) {
    const k = line.replace(/\s+/g, ' ').slice(0, 48).toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    deduped.push(line)
  }
  const merged = deduped.join('\n')
  const cap = Math.max(maxSummaryChars, 2800)
  if (merged.length <= cap) return merged
  return merged.slice(merged.length - cap)
}

/** Hint for system prompts: formal MAP→REDUCE contract (no invent unread chapters). */
export function buildMapReduceReadingHint(state: DocReadingState | null | undefined): string {
  if (!state) return ''
  const done = state.chapterIndex >= state.chapterCount
  return (
    '[MAP-REDUCE LECTURA] ' +
    (done
      ? 'Ingesta completa: usa solo el resumen y títulos ya leídos; no inventes capítulos.'
      : `MAP por tramo ya aplicado · REDUCE en resumen rodante · cursor ${state.chapterIndex + 1}/${state.chapterCount}. ` +
        'Opina sobre lo leído; si el usuario pide un capítulo no cubierto, pide releer ese tramo.')
  )
}

/**
 * Append a mapped fact-block about a finished slice into the rolling summary.
 * Heuristic map-reduce (no extra LLM call) — structured facts for later opinions.
 */
export function appendRollingFromSlice(
  prev: string,
  chapterTitles: string[],
  sliceBody: string,
  maxSummaryChars = 2800
): string {
  const mapped = mapSliceToFacts(sliceBody, chapterTitles)
  return reduceRollingSummary(prev, mapped, maxSummaryChars)
}

export function markSliceRead(
  state: DocReadingState,
  opts: {
    chapterIndex: number
    lastChapterIndex: number
    titles: string[]
    sliceBody: string
    streamOffset?: number
  }
): DocReadingState {
  const titles = [...state.readTitles]
  const visits: Record<string, number> = { ...(state.chapterVisitCounts || {}) }
  for (const title of opts.titles) {
    if (!title) continue
    if (!titles.includes(title)) titles.push(title)
    visits[title] = (visits[title] || 0) + 1
  }
  const nextOff =
    opts.streamOffset != null && Number.isFinite(opts.streamOffset)
      ? Math.max(0, Math.floor(opts.streamOffset))
      : state.streamOffset
  return {
    ...state,
    chapterIndex: opts.chapterIndex,
    readTitles: titles.slice(-40),
    chapterVisitCounts: visits,
    rollingSummary: appendRollingFromSlice(state.rollingSummary, opts.titles, opts.sliceBody),
    streamOffset: nextOff,
    updatedAt: Date.now()
  }
}

/** Build system block for prior reading (refine context). */
export function buildRollingReadingBlock(state: DocReadingState | null | undefined): string {
  if (!state) return ''
  const parts: string[] = []
  parts.push(
    '[PROGRESO_LECTURA] Archivo: ' +
      (state.fileName || 'documento') +
      ' · capítulo/tramo actual índice ' +
      (state.chapterIndex + 1) +
      ' de ' +
      state.chapterCount +
      '.'
  )
  parts.push(buildMapReduceReadingHint(state))
  if (state.readTitles.length) {
    const visits = state.chapterVisitCounts || {}
    const labeled = state.readTitles.slice(-10).map((title) => {
      const n = visits[title] || 1
      return n > 1 ? `${title} (×${n})` : title
    })
    parts.push('Ya revisaste (títulos; ×N = veces presentado): ' + labeled.join(' · ') + '.')
  }
  if (state.chapterIndex >= state.chapterCount) {
    parts.push(
      'Estado: LECTURA COMPLETA del archivo en la app. No inventes capítulos posteriores; ' +
        'si el usuario pide un capítulo concreto, relee ese tramo o habla desde el resumen.'
    )
  }
  if (state.rollingSummary.trim()) {
    parts.push(
      'Resumen compacto de tramos anteriores (no inventes más allá de esto ni del extracto nuevo):\n' +
        state.rollingSummary.trim()
    )
  }
  parts.push(
    'Si el usuario dice «sigue», «continúa» o «capítulo N», avanza solo al tramo pedido. ' +
      'Si pide opinión/reseña de lo leído: apoya en este resumen + el extracto nuevo; sé específica (personajes, giros, tono), no genérica. ' +
      'No digas que leíste el libro entero si aún hay tramos pendientes.'
  )
  return parts.join('\n')
}

export function chaptersForText(full: string): DocChapter[] {
  return splitIntoChapters(full || '')
}

/** Prefer newest attachment text; used when user says «sigue» without re-uploading. */
export function findLatestDocText(
  messages: Array<{ attachments?: Array<{ name?: string; textContent?: string; mimeType?: string }> | null }> | undefined
): { name: string; text: string } | null {
  if (!messages?.length) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const atts = messages[i].attachments
    if (!atts?.length) continue
    for (let j = atts.length - 1; j >= 0; j--) {
      const a = atts[j]
      const t = (a.textContent || '').trim()
      if (t.length > 40) {
        return { name: a.name || 'documento', text: a.textContent || t }
      }
    }
  }
  return null
}


/** True when cursor is past or at last chapter and at least one slice was read. */
export function isDocReadingComplete(state: DocReadingState | null | undefined): boolean {
  if (!state) return false
  const count = Math.max(1, state.chapterCount || 1)
  const off = Number(state.streamOffset || 0)
  const total = Number(state.totalChars || 0)
  if (total > 2000 && off > 0 && off < total * 0.98) return false
  if (!state.readTitles?.length && !state.rollingSummary?.trim() && off <= 0) return false
  if (total > 0 && off >= total) return true
  return state.chapterIndex >= count
}

/** Human progress label e.g. "3/12". */
export function docReadingProgressLabel(state: DocReadingState): string {
  const count = Math.max(1, state.chapterCount || 1)
  const done = Math.min(count, Math.max(0, state.chapterIndex))
  const re =
    state.chapterVisitCounts &&
    Object.values(state.chapterVisitCounts).some((n) => n > 1)
      ? ' · relecturas'
      : ''
  const total = Number(state.totalChars || 0)
  const off = Number(state.streamOffset || 0)
  const pct =
    total > 2000 && off > 0
      ? ` · ${Math.min(100, Math.round((off / total) * 100))}%`
      : ''
  return `${done}/${count}${pct}${re}`
}

/**
 * Compact essentials for transparent memory (facts the companion should keep).
 */
export function essentialsFromDocState(state: DocReadingState, maxChars = 900): string {
  const bits: string[] = []
  const rem = state as DocReadingState & {
    mode?: string
    ingestComplete?: boolean
    chapterMemories?: Array<{ title?: string; index?: number }>
  }
  if (rem.mode === 'read_and_remember' || rem.ingestComplete) {
    bits.push(
      `DOC_REMEMBER «${state.fileName || 'documento'}»` +
        (rem.ingestComplete ? ' ingesta:ok' : ` ${docReadingProgressLabel(state)}`)
    )
    const titles = (rem.chapterMemories || [])
      .slice(0, 12)
      .map((m) => m.title || `#${(m.index ?? 0) + 1}`)
    if (titles.length) bits.push('Índice: ' + titles.join(' · '))
  } else {
    bits.push(`DOC_READ «${state.fileName || 'documento'}» progreso ${docReadingProgressLabel(state)}`)
    if (state.readTitles?.length) {
      bits.push('Tramos: ' + state.readTitles.slice(-10).join(' · '))
    }
  }
  const sum = (state.rollingSummary || '').replace(/\s+/g, ' ').trim()
  if (sum) bits.push('Esencial: ' + sum.slice(0, maxChars))
  return bits.join(' | ').slice(0, maxChars + 120)
}

/** True if progressive mid-book or offline ingest not finished. Safe for boot/pre-update checks. */
export function isDocReadingPending(state: DocReadingState | null | undefined): boolean {
  if (!state || !state.chapterCount) return false
  const rem = state as DocReadingState & {
    mode?: string
    ingestComplete?: boolean
  }
  if (rem.mode === 'read_and_remember') {
    return !rem.ingestComplete
  }
  const off = Number(state.streamOffset || 0)
  if (state.totalChars > 2000 && off > 0 && off < state.totalChars * 0.98) {
    return true
  }
  return (
    state.chapterIndex < state.chapterCount &&
    (state.totalChars > 800 || state.chapterCount > 1)
  )
}
