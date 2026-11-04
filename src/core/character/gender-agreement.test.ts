import { describe, it, expect } from 'vitest'
import { correctSelfGenderSpanish } from './gender-agreement'
import { buildPronounSystemHint, inferAssistantGender } from './pronouns'

describe('A2 gender-agreement female', () => {
  it('fixes soy todo tuyo → soy toda tuya', () => {
    expect(correctSelfGenderSpanish('— "Soy todo tuyo, Nahum."', 'female')).toContain(
      'Soy toda tuya'
    )
  })
  it('fixes estoy listo → estoy lista', () => {
    expect(correctSelfGenderSpanish('Estoy listo para ti.', 'female')).toBe(
      'Estoy lista para ti.'
    )
  })
  it('fixes me siento nervioso', () => {
    expect(correctSelfGenderSpanish('Me siento nervioso.', 'female')).toBe(
      'Me siento nerviosa.'
    )
  })
  it('leaves neutral untouched', () => {
    const s = 'Soy todo tuyo.'
    expect(correctSelfGenderSpanish(s, 'neutral')).toBe(s)
  })
})

describe('A2 gender-agreement male', () => {
  it('fixes soy toda tuya → soy todo tuyo', () => {
    expect(correctSelfGenderSpanish('Soy toda tuya.', 'male')).toBe('Soy todo tuyo.')
  })
})

describe('A1 pronoun system hint', () => {
  it('female includes toda tuya rule', () => {
    const h = buildPronounSystemHint({ assistantGender: 'female' })
    expect(h).toMatch(/toda tuya/i)
    expect(h).toMatch(/femenino/i)
  })
  it('infer from novia role', () => {
    expect(
      inferAssistantGender({ relationshipRole: 'novia / pareja romántica' })
    ).toBe('female')
  })
})
