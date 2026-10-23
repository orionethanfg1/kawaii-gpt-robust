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
  updatedAt: number
}

export function makeDocReadingKey(convId: string, fileName: string, totalChars: number): string {
  const name = (fileName || 'documento').toLowerCase().replace(/\s+/g, '_').slice(0, 64)
  return `${convId}::${name}::${totalChars}`
}

export function emptyDocReadingState(
  convId: string,
  fileName: string,
  totalChars: number,
  chapterCount: number
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
    updatedAt: Date.now()
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
  const merged = [prev.trim(), mappedLine.trim()].filter(Boolean).join('\n')
  const cap = Math.max(maxSummaryChars, 2800)
  if (merged.length <= cap) return merged
  return merged.slice(merged.length - cap)
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
  }
): DocReadingState {
  const titles = [...state.readTitles]
  const visits: Record<string, number> = { ...(state.chapterVisitCounts || {}) }
  for (const title of opts.titles) {
    if (!title) continue
    if (!titles.includes(title)) titles.push(title)
    visits[title] = (visits[title] || 0) + 1
  }
  return {
    ...state,
    chapterIndex: opts.chapterIndex,
    readTitles: titles.slice(-40),
    chapterVisitCounts: visits,
    rollingSummary: appendRollingFromSlice(state.rollingSummary, opts.titles, opts.sliceBody),
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
  // chapterIndex is the *next* index to present; complete when past the last chapter
  if (!state.readTitles?.length && !state.rollingSummary?.trim()) return false
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
  return `${done}/${count}${re}`
}

/**
 * Compact essentials for transparent memory (facts the companion should keep).
 */
export function essentialsFromDocState(state: DocReadingState, maxChars = 900): string {
  const bits: string[] = []
  bits.push(`DOC_READ «${state.fileName || 'documento'}» progreso ${docReadingProgressLabel(state)}`)
  if (state.readTitles?.length) {
    bits.push('Tramos: ' + state.readTitles.slice(-10).join(' · '))
  }
  const sum = (state.rollingSummary || '').replace(/\s+/g, ' ').trim()
  if (sum) bits.push('Esencial: ' + sum.slice(0, maxChars))
  return bits.join(' | ').slice(0, maxChars + 120)
}
