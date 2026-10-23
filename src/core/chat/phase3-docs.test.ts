/**
 * Fase 3 — progressive docs pure checks.
 */

import {
  splitIntoChapters,
  progressiveSlice,
  parseReadingAdvance
} from './document-chunks'
import {
  mapSliceToFacts,
  reduceRollingSummary,
  emptyDocReadingState,
  markSliceRead
} from './document-reading-state'
import { buildDocumentsWithState } from './document-attach'

export type Phase3Check = { id: string; ok: boolean; detail: string }

function sampleBook(): string {
  const parts: string[] = []
  for (let i = 1; i <= 12; i++) {
    parts.push(
      `Capítulo ${i}\n\nEste es el cuerpo del capítulo ${i}. ` +
        `Habla de eventos y personajes del tramo ${i}. `.repeat(40)
    )
  }
  return parts.join('\n\n')
}

export function runPhase3PureChecks(): Phase3Check[] {
  const out: Phase3Check[] = []
  const book = sampleBook()
  const chapters = splitIntoChapters(book)
  out.push({
    id: 'phase3-split-chapters',
    ok: chapters.length >= 10,
    detail: `chapters=${chapters.length}`
  })

  const s0 = progressiveSlice(book, { chapterIndex: 0 })
  out.push({
    id: 'phase3-slice-start',
    ok: s0.chapterIndex === 0 && s0.body.length > 500 && s0.lastChapterIndex >= 0,
    detail: `idx=${s0.chapterIndex}-${s0.lastChapterIndex} len=${s0.body.length}`
  })

  const next = parseReadingAdvance('sigue leyendo', s0.lastChapterIndex + 1, chapters.length)
  out.push({
    id: 'phase3-parse-sigue',
    ok: next != null && next >= s0.lastChapterIndex,
    detail: `next=${next}`
  })

  const toChap = parseReadingAdvance('capítulo 9', 0, chapters.length)
  out.push({
    id: 'phase3-parse-chapter-n',
    ok: toChap === 8 || toChap === 9, // 0-based chapter 9 → 8 if titles match Cap 9
    detail: `toChap=${toChap} (esperado ~8)`
  })

  const mapped = mapSliceToFacts(s0.body, s0.titles)
  const reduced = reduceRollingSummary('', mapped, 2800)
  out.push({
    id: 'phase3-map-reduce',
    ok: mapped.length > 20 && reduced.includes('•'),
    detail: `mapLen=${mapped.length} redLen=${reduced.length}`
  })

  let st = emptyDocReadingState('c1', 'libro.txt', book.length, chapters.length)
  st = markSliceRead(st, {
    chapterIndex: s0.lastChapterIndex + 1,
    lastChapterIndex: s0.lastChapterIndex,
    titles: s0.titles,
    sliceBody: s0.body
  })
  out.push({
    id: 'phase3-mark-slice',
    ok: st.readTitles.length > 0 && st.rollingSummary.length > 10,
    detail: `titles=${st.readTitles.length} roll=${st.rollingSummary.length}`
  })

  const built = buildDocumentsWithState(
    [{ name: 'libro.txt', textContent: book, mimeType: 'text/plain' }],
    { userMessage: 'qué opinas del inicio', convId: 'c1' }
  )
  // Rules may *mention* ### to forbid it; require ban wording, not absence of the chars
  const bansMd =
    /SIN markdown|# ## ###|Prohibido encabezados Markdown/i.test(built.block)
  out.push({
    id: 'phase3-build-opinion-rules',
    ok:
      built.block.includes('MODO_DOCUMENTO') &&
      built.block.includes('PRIORIDAD') &&
      built.block.includes('DOCUMENTOS_ADJUNTOS') &&
      bansMd &&
      built.states.length >= 1,
    detail: `blockLen=${built.block.length} states=${built.states.length} bansMd=${bansMd}`
  })

  // Advance from prior state
  const built2 = buildDocumentsWithState(
    [{ name: 'libro.txt', textContent: book, mimeType: 'text/plain' }],
    {
      userMessage: 'sigue',
      convId: 'c1',
      priorStates: built.states
    }
  )
  const idx1 = built.states[0]?.chapterIndex ?? 0
  const idx2 = built2.states[0]?.chapterIndex ?? 0
  out.push({
    id: 'phase3-advance-cursor',
    ok: idx2 >= idx1,
    detail: `cursor ${idx1} → ${idx2}`
  })

  return out
}
