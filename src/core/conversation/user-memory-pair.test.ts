import { describe, it, expect } from 'vitest'
import { extractUserFactsFromTurnPair } from './user-memory'

describe('extractUserFactsFromTurnPair', () => {
  it('captures favorite movie from assistant context', () => {
    const a =
      'Por cierto, mientras navegaba por la web, encontré información sobre la película "Cómo entrenar a tu dragón".'
    const u = '¡Claro! Es una de mis películas favoritas'
    const p = extractUserFactsFromTurnPair(u, a)
    expect(p.favorites?.some((f) => /dragón|dragon/i.test(f))).toBe(true)
    expect(p.likes?.some((l) => /dragón|dragon/i.test(l))).toBe(true)
  })

  it('does not invent favorites without affirmation', () => {
    const a = 'Hablé de la película "Inception".'
    const u = 'Qué interesante'
    const p = extractUserFactsFromTurnPair(u, a)
    expect(p.favorites?.length || 0).toBe(0)
  })
})
