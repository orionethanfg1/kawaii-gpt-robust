import { describe, it, expect } from 'vitest'
import { shouldEnableThinking } from './think-auto'
import { splitIntoChapters, progressiveSlice, parseReadingAdvance } from './document-chunks'

describe('think-auto', () => {
  it('off only thinks for docs', () => {
    expect(shouldEnableThinking({ mode: 'off', userContent: 'hola' })).toBe(false)
    expect(shouldEnableThinking({ mode: 'off', userContent: 'hola', hasDocAttach: true })).toBe(true)
  })
  it('auto enables for code and hard Q', () => {
    expect(shouldEnableThinking({ mode: 'auto', userContent: 'hola' })).toBe(false)
    expect(shouldEnableThinking({ mode: 'auto', userContent: 'refactor este código en typescript' })).toBe(true)
    expect(shouldEnableThinking({ mode: 'auto', userContent: 'por qué funciona así' })).toBe(true)
    expect(shouldEnableThinking({ mode: 'auto', userContent: 'busca noticias', useWebSearch: true })).toBe(true)
  })
})

describe('document-chunks', () => {
  it('splits chapters', () => {
    const book =
      'Intro' +
      '\nCapítulo 1 El río\n' + 'texto uno. '.repeat(50) +
      '\nCapítulo 2 El gato\n' + 'texto dos. '.repeat(50)
    const ch = splitIntoChapters(book)
    expect(ch.length).toBeGreaterThanOrEqual(2)
  })
  it('progressive slice + advance', () => {
    const long = ('Capítulo 1 A\n' + 'x'.repeat(100) + '\nCapítulo 2 B\n' + 'y'.repeat(100))
    const s = progressiveSlice(long, { chapterIndex: 0, maxChars: 80 })
    expect(s.body.length).toBeGreaterThan(0)
    expect(parseReadingAdvance('sigue', 0, 3)).toBe(1)
    expect(parseReadingAdvance('capítulo 2', 0, 3)).toBe(1)
  })
})
