import { describe, it, expect } from 'vitest'
import { emptyDocReadingState, isDocReadingPending } from './document-reading-state'

describe('isDocReadingPending', () => {
  it('false for empty-ish', () => {
    expect(isDocReadingPending(null)).toBe(false)
    const s = emptyDocReadingState('c', 'a.txt', 100, 1)
    s.chapterIndex = 1
    expect(isDocReadingPending(s)).toBe(false)
  })

  it('true for progressive mid-book', () => {
    const s = emptyDocReadingState('c', 'book.md', 50_000, 12)
    s.chapterIndex = 4
    expect(isDocReadingPending(s)).toBe(true)
  })

  it('read_and_remember respects ingestComplete', () => {
    const s = emptyDocReadingState('c', 'book.md', 50_000, 12) as ReturnType<
      typeof emptyDocReadingState
    > & { mode?: string; ingestComplete?: boolean }
    s.mode = 'read_and_remember'
    s.ingestComplete = false
    s.chapterIndex = 3
    expect(isDocReadingPending(s)).toBe(true)
    s.ingestComplete = true
    s.chapterIndex = 12
    expect(isDocReadingPending(s)).toBe(false)
  })
})
