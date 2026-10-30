import { describe, it, expect } from 'vitest'
import {
  shouldPreferReadAndRemember,
  ingestDocumentOffline,
  detectDocSeekIntent,
  seekAndRereadPassage
} from './document-read-remember'

const BOOK =
  'Capítulo 1\n\nHabía una vez un bosque y una princesa celta.\n\n' +
  'Capítulo 2\n\nEl héroe cruzó el río bajo la luna.\n\n' +
  'Capítulo 3\n\nAl final encontraron paz en el castillo.\n\n' +
  'x'.repeat(30_000)

describe('read_and_remember', () => {
  it('prefers mode for large docs', () => {
    expect(shouldPreferReadAndRemember({ totalChars: 50_000 })).toBe('read_and_remember')
    expect(shouldPreferReadAndRemember({ totalChars: 1000 })).toBe('progressive')
    expect(
      shouldPreferReadAndRemember({
        totalChars: 50_000,
        userMessage: 'continuar lectura por capítulo'
      })
    ).toBe('progressive')
  })

  it('ingests offline without LLM', () => {
    const st = ingestDocumentOffline(BOOK, { convId: 'c1', fileName: 'saga.md' })
    expect(st.mode).toBe('read_and_remember')
    expect(st.ingestComplete).toBe(true)
    expect((st.chapterMemories || []).length).toBeGreaterThanOrEqual(2)
    expect(st.rollingSummary.length).toBeGreaterThan(20)
  })

  it('seek by chapter number enriches memory', () => {
    const st = ingestDocumentOffline(BOOK, { convId: 'c1', fileName: 'saga.md' })
    const hit = seekAndRereadPassage({
      fullText: BOOK,
      state: st,
      chapterNum: 2
    })
    expect(hit.found).toBe(true)
    expect(hit.body).toMatch(/río|luna/i)
    const mem = hit.state.chapterMemories?.find((m) => m.index === 1)
    expect(mem && mem.visits >= 1).toBe(true)
  })

  it('detectDocSeekIntent', () => {
    expect(detectDocSeekIntent('qué pasaba en el capítulo 3').seek).toBe(true)
    expect(detectDocSeekIntent('capítulo 2').chapterNum).toBe(2)
    expect(detectDocSeekIntent('hola qué tal').seek).toBe(false)
  })
})
