import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  emptyDocReadingState,
  isDocReadingComplete,
  isDocReadingPending,
  preserveCompletedReading,
  makeDocReadingKey,
  documentSourceChanged,
  makeContentFingerprint
} from './document-reading-state'

describe('B1 — lectura completa no se reinicia', () => {
  it('stable key does not include totalChars', () => {
    const a = makeDocReadingKey('c1', 'Libro.docx', 1000)
    const b = makeDocReadingKey('c1', 'Libro.docx', 2000)
    expect(a).toBe(b)
    expect(a).toBe('c1::libro.docx')
  })

  it('preserveCompletedReading keeps complete after rehydrate with more chapters', () => {
    const prior = emptyDocReadingState('c', 'book.md', 50_000, 10)
    prior.chapterIndex = 10
    prior.streamOffset = 50_000
    prior.readTitles = ['cap1', 'cap10']
    prior.rollingSummary = 'Leído completo'
    expect(isDocReadingComplete(prior)).toBe(true)

    const next = emptyDocReadingState('c', 'book.md', 51_000, 12)
    const kept = preserveCompletedReading(prior, next)
    expect(isDocReadingComplete(kept)).toBe(true)
    expect(isDocReadingPending(kept)).toBe(false)
    expect(kept.streamOffset).toBeGreaterThanOrEqual(50_000)
  })

  it('tiny length noise does not mark source changed when already complete', () => {
    const text = 'A'.repeat(10_000)
    const st = emptyDocReadingState('c', 'a.txt', text.length, 3, {
      fingerprint: makeContentFingerprint(text)
    })
    st.chapterIndex = 3
    st.streamOffset = text.length
    expect(isDocReadingComplete(st)).toBe(true)
    const noisy = text + 'B'.repeat(50) // ~0.5%
    expect(documentSourceChanged(st, noisy)).toBe(false)
  })
})

describe('B1 — cancel pending auto-doc timer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    const g = globalThis as unknown as {
      __kawaiiDocAuto?: unknown
      __kawaiiDocAutoGen?: number
      __kawaiiDocAutoTimer?: ReturnType<typeof setTimeout>
    }
    g.__kawaiiDocAuto = { convId: 'c', incomplete: true, armed: true }
    g.__kawaiiDocAutoGen = 0
    g.__kawaiiDocAutoTimer = undefined
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancelPendingDocAutoContinue prevents scheduled callback', async () => {
    const { scheduleDocAutoContinue, cancelPendingDocAutoContinue } = await import(
      '@features/chat/services/documentReadingStore'
    )
    let fired = 0
    scheduleDocAutoContinue(() => {
      fired += 1
    }, 2200)
    cancelPendingDocAutoContinue('pure-chat')
    await vi.advanceTimersByTimeAsync(5000)
    expect(fired).toBe(0)
  })

  it('only matching generation runs the callback', async () => {
    const { scheduleDocAutoContinue, cancelPendingDocAutoContinue } = await import(
      '@features/chat/services/documentReadingStore'
    )
    let fired = 0
    scheduleDocAutoContinue(() => {
      fired += 1
    }, 1000)
    // schedule again replaces timer; cancel bumps gen
    cancelPendingDocAutoContinue('write-continue')
    scheduleDocAutoContinue(() => {
      fired += 10
    }, 1000)
    await vi.advanceTimersByTimeAsync(1500)
    expect(fired).toBe(10)
  })
})
