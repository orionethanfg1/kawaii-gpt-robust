import { describe, it, expect } from 'vitest'
import { progressiveSlice, splitIntoChapters } from './document-chunks'
import { markSliceRead, emptyDocReadingState, isDocReadingComplete } from './document-reading-state'

describe('streamOffset progressive', () => {
  it('second slice of long chapter is not the same start', () => {
    const ch10 = 'Capítulo 10\n' + ('palabra magia portal '.repeat(4000))
    const ch11 = '\n\nCapítulo 11\n' + ('final del arco '.repeat(500))
    const full = ch10 + ch11
    const max = 8000
    const a = progressiveSlice(full, { chapterIndex: 0, streamOffset: 0, maxChars: max })
    expect(a.body.length).toBeLessThanOrEqual(max + 10)
    expect(a.nextStreamOffset).toBeGreaterThan(1000)
    const b = progressiveSlice(full, {
      chapterIndex: a.chapterIndex,
      streamOffset: a.nextStreamOffset,
      maxChars: max
    })
    expect(b.streamOffset).toBe(a.nextStreamOffset)
    // Overlap of starts should be low
    expect(b.body.slice(0, 80)).not.toBe(a.body.slice(0, 80))
  })

  it('markSliceRead persists streamOffset', () => {
    const s = emptyDocReadingState('c', 'book.docx', 100_000, 12)
    const n = markSliceRead(s, {
      chapterIndex: 9,
      lastChapterIndex: 9,
      titles: ['Capítulo 10'],
      sliceBody: 'x'.repeat(100),
      streamOffset: 25000
    })
    expect(n.streamOffset).toBe(25000)
    expect(isDocReadingComplete(n)).toBe(false)
  })
})
