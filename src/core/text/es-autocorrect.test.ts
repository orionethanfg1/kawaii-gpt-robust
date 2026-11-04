
import { describe, it, expect } from 'vitest'
import { applySpanishAutocorrectLight, suggestSpanishAutocorrect } from './es-autocorrect'

describe('es-autocorrect', () => {
  it('fixes aser and tambien', () => {
    const out = applySpanishAutocorrectLight('voy a aser algo tambien')
    expect(out).toMatch(/hacer/)
    expect(out).toMatch(/también/)
  })
  it('suggests asi', () => {
    const s = suggestSpanishAutocorrect('hazlo asi porfa')
    expect(s.some((x) => x.to === 'así' || x.to === 'por favor')).toBe(true)
  })
})
