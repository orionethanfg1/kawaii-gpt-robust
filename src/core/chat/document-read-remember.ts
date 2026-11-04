/**
 * «Leer y recordar» — ingest full document offline (map-reduce), one opinion,
 * later cite from memory; on gap → seek + re-read + enrich memory.
 *
 * Reuses progressiveSlice / mapSliceToFacts / DocReadingState. Does not replace
 * voice progressive mode (continuar lectura); runs alongside via mode flag.
 */

import {
  progressiveSlice,
  splitIntoChapters,
  effectiveProgressiveSliceChars,
  type DocChapter
} from './document-chunks'
import {
  emptyDocReadingState,
  mapSliceToFacts,
  reduceRollingSummary,
  markSliceRead,
  buildRollingReadingBlock,
  isDocReadingComplete,
  type DocReadingState
} from './document-reading-state'

export type DocChapterMemory = {
  index: number
  title: string
  /** Compact facts from mapSliceToFacts */
  facts: string
  /** Short quote anchors */
  anchors: string[]
  visits: number
}

export type DocReadMode = 'progressive' | 'read_and_remember'

/** Extend reading state without breaking existing consumers. */
export type DocReadingStateRemember = DocReadingState & {
  mode?: DocReadMode
  /** True after silent full pass */
  ingestComplete?: boolean
  chapterMemories?: DocChapterMemory[]
}

const DEFAULT_LARGE_DOC_CHARS = 28_000

/** Prefer read_and_remember for large full documents on first pass. */
export function shouldPreferReadAndRemember(opts: {
  totalChars: number
  userMessage?: string
  forceMode?: DocReadMode
  /** Existing state already progressive mid-book */
  existing?: DocReadingStateRemember | null
}): DocReadMode {
  if (opts.forceMode) return opts.forceMode
  const um = (opts.userMessage || '').trim()
  if (/\b(leer\s+y\s+recordar|lee\s+todo|ingesta|solo\s+resume)\b/i.test(um)) {
    return 'read_and_remember'
  }
  if (/\b(continuar\s+lectura|sigue\s+leyendo|capítulo\s+por\s+capítulo)\b/i.test(um)) {
    return 'progressive'
  }
  // Mid progressive session: keep progressive
  if (
    opts.existing &&
    opts.existing.mode !== 'read_and_remember' &&
    (opts.existing.readTitles?.length || 0) > 0 &&
    !opts.existing.ingestComplete
  ) {
    return 'progressive'
  }
  if (opts.existing?.mode === 'read_and_remember' || opts.existing?.ingestComplete) {
    return 'read_and_remember'
  }
  if (opts.totalChars >= DEFAULT_LARGE_DOC_CHARS) return 'read_and_remember'
  return 'progressive'
}

/**
 * Silent offline ingest: walk all chapters with progressive windows, map facts only.
 * No LLM. Safe to run on main/renderer thread for typical book sizes.
 */
export function ingestDocumentOffline(
  fullText: string,
  opts: {
    convId: string
    fileName: string
    prior?: DocReadingStateRemember | null
    maxSliceChars?: number
    maxSummaryChars?: number
  }
): DocReadingStateRemember {
  const full = fullText || ''
  const chapters = splitIntoChapters(full)
  const maxSlice = opts.maxSliceChars ?? effectiveProgressiveSliceChars()
  const maxSum = opts.maxSummaryChars ?? 6_000

  let state: DocReadingStateRemember =
    opts.prior && opts.prior.totalChars === full.length
      ? { ...opts.prior }
      : emptyDocReadingState(opts.convId, opts.fileName, full.length, chapters.length)

  state.mode = 'read_and_remember'
  state.chapterCount = chapters.length
  state.totalChars = full.length
  state.chapterMemories = Array.isArray(state.chapterMemories) ? [...state.chapterMemories] : []

  // If already complete, return as-is
  if (state.ingestComplete && state.chapterMemories.length >= Math.min(chapters.length, 1)) {
    return state
  }

  let idx = 0
  let guard = 0
  const maxGuards = Math.max(chapters.length * 2, 8)

  while (idx < chapters.length && guard < maxGuards) {
    guard++
    const slice = progressiveSlice(full, { chapterIndex: idx, maxChars: maxSlice })
    if (!slice.body || slice.chapterIndex >= chapters.length) break

    const titles =
      slice.titles?.length ? slice.titles : slice.chapterTitle ? [slice.chapterTitle] : []
    const facts = mapSliceToFacts(slice.body, titles)
    const anchors = extractAnchors(slice.body, 3)

    for (let i = slice.chapterIndex; i <= slice.lastChapterIndex; i++) {
      const ch = chapters[i]
      if (!ch) continue
      const existing = state.chapterMemories.find((m) => m.index === i)
      if (existing) {
        existing.visits = (existing.visits || 1) + 1
        if (facts && facts.length > (existing.facts || '').length) existing.facts = facts
        for (const a of anchors) {
          if (!existing.anchors.includes(a)) existing.anchors.push(a)
        }
        existing.anchors = existing.anchors.slice(0, 5)
      } else {
        state.chapterMemories.push({
          index: i,
          title: ch.title || `Tramo ${i + 1}`,
          facts: mapSliceToFacts(ch.text.slice(0, maxSlice), [ch.title]),
          anchors: extractAnchors(ch.text, 2),
          visits: 1
        })
      }
    }

    const nextCursor = Math.min(chapters.length, slice.lastChapterIndex + 1)
    state = markSliceRead(state, {
      chapterIndex: nextCursor,
      lastChapterIndex: slice.lastChapterIndex,
      titles,
      sliceBody: slice.body
    }) as DocReadingStateRemember
    state.mode = 'read_and_remember'
    state.chapterMemories = state.chapterMemories
    state.rollingSummary = reduceRollingSummary(state.rollingSummary, facts, maxSum)

    idx = nextCursor
    if (nextCursor >= chapters.length) break
  }

  state.ingestComplete = state.chapterIndex >= chapters.length
  state.chapterCount = chapters.length
  state.updatedAt = Date.now()
  return state
}

function extractAnchors(body: string, max = 3): string[] {
  const cleaned = (body || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return []
  const quotes = cleaned.match(/[«"]([^«»"]{16,140})[»"]/g) || []
  const out: string[] = []
  for (const q of quotes) {
    const s = q.replace(/\s+/g, ' ').trim().slice(0, 120)
    if (s.length > 15) out.push(s)
    if (out.length >= max) return out
  }
  const sentences = cleaned.split(/(?<=[.!?…])\s+/).filter((s) => s.length > 40)
  for (const s of sentences.slice(0, max - out.length)) {
    out.push(s.slice(0, 120) + (s.length > 120 ? '…' : ''))
  }
  return out.slice(0, max)
}

/** Build memory index block for system prompt (no full book dump). */
export function buildDocumentMemoryIndexBlock(state: DocReadingStateRemember): string {
  const mems = state.chapterMemories || []
  const lines: string[] = []
  lines.push(
    `[DOC_MEMORIA] «${state.fileName || 'documento'}» · modo leer-y-recordar · ` +
      (state.ingestComplete ? 'ingesta completa' : `progreso ${state.chapterIndex}/${state.chapterCount}`)
  )
  if (state.rollingSummary?.trim()) {
    lines.push('[RESUMEN_ROLLING]')
    lines.push(state.rollingSummary.trim().slice(0, 5000))
  }
  if (mems.length) {
    lines.push('[INDICE_TRAMOS] (usa estos recuerdos; no inventes capítulos fuera de la lista)')
    for (const m of mems.slice(0, 40)) {
      const a = (m.anchors || []).slice(0, 2).join(' | ')
      lines.push(
        `· #${m.index + 1} ${m.title}` +
          (m.visits > 1 ? ` (releído×${m.visits})` : '') +
          (a ? `\n  anclas: ${a}` : '') +
          (m.facts ? `\n  ${m.facts.slice(0, 400)}` : '')
      )
    }
  }
  return lines.join('\n')
}

/**
 * System block after offline ingest: single global opinion, no «sigue» chain.
 */
export function buildReadAndRememberOpinionBlock(opts: {
  state: DocReadingStateRemember
  fileName?: string
}): string {
  const name = opts.fileName || opts.state.fileName || 'documento'
  const index = buildDocumentMemoryIndexBlock(opts.state)
  const rules =
    '[MODO_LEER_Y_RECORDAR] Ya se indexó el documento en memoria (mapa de tramos + resumen). ' +
    'Da UNA respuesta en personaje sobre el conjunto:\n' +
    '- Qué es el texto, tono general e impresión personal.\n' +
    '- 3–6 detalles concretos de tramos del índice (sin inventar capítulos no listados).\n' +
    '- Qué te enganchó o no; una pregunta suave si cabe.\n' +
    '- NO digas «continúa la lectura» ni pidas «sigue» para avanzar tramos: la ingesta ya ocurrió.\n' +
    '- Si el usuario más tarde pregunta por un pasaje concreto, la app puede re-leer ese tramo.\n' +
    '- Prohibido markdown de títulos (# ##); párrafos naturales.\n' +
    `- Archivo: «${name}».`

  return rules + '\n\n' + index
}

/** Detect user wants a specific passage not necessarily in the last prompt. */
export function detectDocSeekIntent(userText: string): {
  seek: boolean
  chapterNum?: number
  query?: string
} {
  const t = (userText || '').trim()
  if (!t) return { seek: false }
  const cap = t.match(/\b(?:capítulo|capitulo|chapter|parte|sección|seccion)\s+(\d+)\b/i)
  if (cap) {
    return { seek: true, chapterNum: parseInt(cap[1], 10), query: t.slice(0, 200) }
  }
  if (
    /\b(qu[eé]\s+(pasaba|dec[ií]a|sucedi[oó]|ocurri[oó])|c[oó]mo\s+(era|terminaba|empezaba)|recuerdas?\s+(el|la|cuando|ese|esa)|en\s+el\s+libro|del\s+documento|esa\s+escena|aquel\s+pasaje)\b/i.test(
      t
    )
  ) {
    return { seek: true, query: t.slice(0, 240) }
  }
  if (/\b(c[ií]tame|cita\s+textual|l[eé]eme\s+(el|la|ese)|relee|re-?lee)\b/i.test(t)) {
    return { seek: true, query: t.slice(0, 240) }
  }
  return { seek: false }
}

export type DocSeekResult = {
  found: boolean
  chapterIndex: number
  title: string
  body: string
  /** Updated state with this chapter enriched */
  state: DocReadingStateRemember
  reason: string
}

/**
 * Re-read a specific chapter or keyword region; enrich memory.
 * Prefer exact chapter number; else score chapters by query tokens.
 */
export function seekAndRereadPassage(opts: {
  fullText: string
  state: DocReadingStateRemember
  chapterNum?: number
  query?: string
  maxChars?: number
}): DocSeekResult {
  const full = opts.fullText || ''
  const chapters = splitIntoChapters(full)
  const maxChars = opts.maxChars ?? Math.min(effectiveProgressiveSliceChars(), 24_000)
  let state: DocReadingStateRemember = {
    ...opts.state,
    chapterMemories: [...(opts.state.chapterMemories || [])],
    mode: 'read_and_remember'
  }

  let idx = -1
  let reason = 'none'

  if (opts.chapterNum != null && opts.chapterNum >= 1 && opts.chapterNum <= chapters.length) {
    idx = opts.chapterNum - 1
    reason = 'chapter_num'
  } else if ((opts.query || '').trim()) {
    const q = (opts.query || '').toLowerCase()
    const tokens = q
      .split(/[^\p{L}\p{N}]+/u)
      .map((x) => x.trim())
      .filter((x) => x.length > 3)
      .slice(0, 12)
    let best = -1
    let bestScore = 0
    for (let i = 0; i < chapters.length; i++) {
      const blob = (chapters[i].title + '\n' + chapters[i].text).toLowerCase()
      let score = 0
      for (const tok of tokens) {
        if (blob.includes(tok)) score += 1 + (chapters[i].title.toLowerCase().includes(tok) ? 2 : 0)
      }
      // Prefer chapters not yet in memory when scores tie
      const known = state.chapterMemories?.some((m) => m.index === i)
      if (!known) score += 0.25
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    if (best >= 0 && bestScore >= 1) {
      idx = best
      reason = 'query_score'
    }
  }

  if (idx < 0 || !chapters[idx]) {
    return {
      found: false,
      chapterIndex: -1,
      title: '',
      body: '',
      state,
      reason: 'not_found'
    }
  }

  const ch = chapters[idx]
  const body = (ch.text || '').slice(0, maxChars)
  const facts = mapSliceToFacts(body, [ch.title])
  const anchors = extractAnchors(body, 3)
  const existing = state.chapterMemories!.find((m) => m.index === idx)
  if (existing) {
    existing.visits = (existing.visits || 1) + 1
    existing.facts = facts
    for (const a of anchors) {
      if (!existing.anchors.includes(a)) existing.anchors.push(a)
    }
    existing.anchors = existing.anchors.slice(0, 5)
  } else {
    state.chapterMemories!.push({
      index: idx,
      title: ch.title,
      facts,
      anchors,
      visits: 1
    })
  }
  state.rollingSummary = reduceRollingSummary(state.rollingSummary, facts, 6_000)
  state.updatedAt = Date.now()

  return {
    found: true,
    chapterIndex: idx,
    title: ch.title,
    body,
    state,
    reason
  }
}

/** System block when a seek hit is injected. */
export function buildDocSeekInjectBlock(opts: {
  fileName: string
  title: string
  chapterIndex: number
  body: string
  state: DocReadingStateRemember
}): string {
  return (
    `[DOC_RELECTURA] El usuario preguntó por un pasaje concreto. ` +
    `Se re-leyó del archivo «${opts.fileName}» el tramo #${opts.chapterIndex + 1} «${opts.title}». ` +
    `Responde con base en este extracto + memoria; cita o parafrasea con honestidad. ` +
    `Este tramo queda añadido/actualizado en memoria.\n\n` +
    buildDocumentMemoryIndexBlock(opts.state) +
    `\n\n[EXTRACTO_RELEIDO]\n${opts.body.slice(0, 28_000)}\n`
  )
}

export function chapterMemoriesToEssentials(state: DocReadingStateRemember, maxChars = 1200): string {
  const bits = [
    `DOC_REMEMBER «${state.fileName}»`,
    state.ingestComplete ? 'ingesta:ok' : `cursor:${state.chapterIndex}/${state.chapterCount}`
  ]
  const mems = state.chapterMemories || []
  if (mems.length) {
    bits.push(
      'tramos: ' +
        mems
          .slice(0, 15)
          .map((m) => `#${m.index + 1} ${m.title}`)
          .join(' · ')
    )
  }
  if (state.rollingSummary) bits.push(state.rollingSummary.replace(/\s+/g, ' ').slice(0, maxChars))
  return bits.join(' | ').slice(0, maxChars + 80)
}

// Re-export helpers used by tests / attach
export { isDocReadingComplete, buildRollingReadingBlock }
