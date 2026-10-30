
import { describe, it, expect } from 'vitest'
import { conditionToSpanish } from './open-meteo'

describe('open-meteo helpers', () => {
  it('maps conditions to Spanish', () => {
    expect(conditionToSpanish('rain')).toBe('lluvioso')
    expect(conditionToSpanish('clear')).toBe('despejado')
  })
})
