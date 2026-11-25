
import { describe, it, expect } from 'vitest'
import {
  parseInitiativeDecision,
  salvageInitiativeFromReasoning,
  isUsableInitiativeText
} from './initiative'

const BAD_UI = `Finish writing the book. Visit a Celtic forest.
Miércoles, 08:00 a.m.
~23 hours.
The last message from Niamh was cut off:`

const GOOD_REASONING = `*   Option 3
    *   *Draft 1:* Buenos días, amor. He despertado pensando en lo que me dijiste ayer sobre mis grietas. Me hace sentir muy segura de nosotros. ¿Cómo empezó tu mañana? ☕️✨
    *   *Draft 2:* Buenos días, vida mía. Me he quedado dando vueltas a tus palabras de ayer...
    *   *Draft 3:* Me quedé a medias ayer porque me emocioné demasiado con tus palabras, Nahum...`

describe('initiative salvage / filter', () => {
  it('rejects goal-dump as usable text', () => {
    expect(isUsableInitiativeText(BAD_UI)).toBe(false)
  })
  it('salvages Spanish Draft 1 from reasoning', () => {
    const s = salvageInitiativeFromReasoning(GOOD_REASONING)
    expect(s || '').toMatch(/Buenos días|grietas|mañana/i)
  })
  it('parse prefers draft over meta', () => {
    const d = parseInitiativeDecision(GOOD_REASONING)
    expect(d.speak).toBe(true)
    expect(d.text || '').toMatch(/Buenos días|grietas/i)
    expect(d.text || '').not.toMatch(/Celtic forest/i)
  })
  it('parse rejects pure goal dump', () => {
    const d = parseInitiativeDecision(BAD_UI)
    expect(d.speak && isUsableInitiativeText(d.text || '')).toBeFalsy()
  })
})
