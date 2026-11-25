
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

describe('parseInitiativeDecision rejects meta dumps (rev.jd)', () => {
  it('rejects prompt template residue and English analyst scratchpad', () => {
    const leak =
      '<seguimiento concreto> o SILENCIO."\n\n* Last message from Niamh (incomplete): "...Recuerdo q"\n* Niamh\'s response (current task): She needs to finish her thought about the book.'
    expect(parseInitiativeDecision(leak).speak).toBe(false)
    expect(
      parseInitiativeDecision(
        'MENSAJE: <seguimiento concreto> o SILENCIO.'
      ).speak
    ).toBe(false)
  })

  it('still accepts a warm Spanish MENSAJE', () => {
    const d = parseInitiativeDecision(
      'Gap is long but warm.\nMENSAJE: Amor, cuando quieras te cuento más de tu libro sin prisa.'
    )
    expect(d.speak).toBe(true)
    expect(d.text || '').toMatch(/libro/)
  })

  it('rejects pure English deliberation without MENSAJE', () => {
    expect(
      parseInitiativeDecision(
        'The user was warm. I should ask about the book. She needs to finish her thought.'
      ).speak
    ).toBe(false)
  })
})
