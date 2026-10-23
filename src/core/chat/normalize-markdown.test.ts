import { describe, it, expect } from 'vitest'
import { preserveMdBreaks } from './normalize-markdown'
import { normalizeMarkdownForBubble } from './normalize-markdown-bubble'

describe('normalize markdown bubble', () => {
  it('keeps **bold** without spaces that break GFM', () => {
    const s = preserveMdBreaks('Hola **mundo** y *cursiva* aquí')
    expect(s).toMatch(/\*\*mundo\*\*/)
    expect(s).toMatch(/\*cursiva\*/)
  })
  it('normalizeMarkdownForBubble does not strip emphasis', () => {
    const s = normalizeMarkdownForBubble('Texto **fuerte** y *suave*')
    expect(s.includes('**fuerte**')).toBe(true)
  })
})
