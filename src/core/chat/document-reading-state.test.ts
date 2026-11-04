import { describe, it, expect } from 'vitest'
import {
  appendRollingFromSlice,
  emptyDocReadingState,
  markSliceRead,
  buildRollingReadingBlock,
  findLatestDocText,
  makeDocReadingKey
} from './document-reading-state'
import { progressiveSlice, parseReadingAdvance, splitIntoChapters } from './document-chunks'
import { buildDocumentsWithState } from './document-attach'

describe('document-reading-state', () => {
  it('builds stable keys and empty state', () => {
    const k = makeDocReadingKey('c1', 'Libro.pdf', 9000)
    expect(k).toContain('c1')
    expect(k).toContain('libro.pdf')
    const s = emptyDocReadingState('c1', 'Libro.pdf', 9000, 5)
    expect(s.chapterIndex).toBe(0)
    expect(s.chapterCount).toBe(5)
  })

  it('append rolling keeps newest under cap', () => {
    let r = ''
    for (let i = 0; i < 20; i++) {
      r = appendRollingFromSlice(r, ['Cap ' + i], 'Texto del capitulo ' + i + '. '.repeat(30), 400)
    }
    expect(r.length).toBeLessThanOrEqual(400)
    expect(r).toMatch(/Cap/)
  })

  it('markSliceRead accumulates titles', () => {
    const s0 = emptyDocReadingState('c', 'a.txt', 100, 3)
    const s1 = markSliceRead(s0, {
      chapterIndex: 1,
      lastChapterIndex: 0,
      titles: ['Capítulo 1'],
      sliceBody: 'hola mundo del bosque'
    })
    expect(s1.readTitles).toContain('Capítulo 1')
    expect(s1.rollingSummary).toMatch(/bosque|Capítulo/)
    expect(buildRollingReadingBlock(s1)).toMatch(/PROGRESO_LECTURA/)
  })

  it('findLatestDocText walks messages backwards', () => {
    const found = findLatestDocText([
      { attachments: [{ name: 'old.txt', textContent: 'aaa' }] },
      { attachments: [] },
      { attachments: [{ name: 'book.docx', textContent: 'contenido largo del libro de prueba xx' }] }
    ])
    expect(found?.name).toBe('book.docx')
    expect(found?.text).toMatch(/contenido/)
  })
})

describe('progressive + state wiring', () => {
  const book =
    'Prólogo intro\n' +
    'Capítulo 1 El río\n' +
    'agua '.repeat(80) +
    '\nCapítulo 2 El bosque\n' +
    'árbol '.repeat(80) +
    '\nCapítulo 3 El banquete\n' +
    'mesa '.repeat(80)

  it('split and slice expose lastChapterIndex', () => {
    const ch = splitIntoChapters(book)
    expect(ch.length).toBeGreaterThanOrEqual(3)
    const s = progressiveSlice(book, { chapterIndex: 0, maxChars: 200 })
    expect(s.body.length).toBeGreaterThan(0)
    expect(s.lastChapterIndex).toBeGreaterThanOrEqual(s.chapterIndex)
  })

  it('sigue advances cursor across turns', () => {
    const r1 = buildDocumentsWithState(
      [{ id: '1', name: 'libro.txt', mimeType: 'text/plain', textContent: book }],
      { convId: 'convA', userMessage: 'dame tu opinión del libro' }
    )
    expect(r1.block).toMatch(/MODO_DOCUMENTO/)
    expect(r1.states[0].chapterIndex).toBeGreaterThanOrEqual(0)
    const mid = r1.states[0].chapterIndex

    const r2 = buildDocumentsWithState(
      [{ id: '1', name: 'libro.txt', mimeType: 'text/plain', textContent: book }],
      {
        convId: 'convA',
        userMessage: 'sigue',
        priorStates: r1.states
      }
    )
    expect(r2.states[0].chapterIndex).toBeGreaterThanOrEqual(mid)
    expect(parseReadingAdvance('sigue', 0, 5)).toBe(1)
  })
})
