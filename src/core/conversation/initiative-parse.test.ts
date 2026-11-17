
import { describe, it, expect } from 'vitest'
import { parseInitiativeDecision } from './initiative'

describe('parseInitiativeDecision with thinking', () => {
  it('extracts MENSAJE after reasoning prose', () => {
    const raw =
      'The user was warm and asked about me.\n8 hours gap.\nMENSAJE: Amor, cuando quieras te cuento más de mí sin prisa.'
    const d = parseInitiativeDecision(raw)
    expect(d.speak).toBe(true)
    expect(d.text || '').toMatch(/cuando quieras/)
  })
  it('SILENCIO without MENSAJE', () => {
    expect(parseInitiativeDecision('Better not bother him now. SILENCIO').speak).toBe(false)
  })
  it('content-only MENSAJE still works', () => {
    const d = parseInitiativeDecision('MENSAJE: Hola, aquí estoy.')
    expect(d.speak).toBe(true)
    expect(d.text).toMatch(/Hola/)
  })
})
