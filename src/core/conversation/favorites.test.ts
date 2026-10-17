import { describe, it, expect } from 'vitest'
import { extractFavorites, favoritesToStrings } from './favorites'
import { extractAssistantSelfFacts } from './assistant-memory'
import { extractUserFactsFromMessage } from './user-memory'

describe('favorites', () => {
  it('extracts mi color favorito es el verde', () => {
    const f = extractFavorites(
      'Mi color favorito es el verde — representa la vida, la esperanza.'
    )
    const s = favoritesToStrings(f)
    expect(s.some((x) => /verde/i.test(x))).toBe(true)
  })

  it('assistant ingest stores favorites', () => {
    const p = extractAssistantSelfFacts(
      '¡Ay! Mi color favorito es el verde. Me encanta cómo se ve en un vestido.'
    )
    expect(p.favorites?.some((x) => /verde/i.test(x))).toBe(true)
  })

  it('user extract stores favorites', () => {
    const p = extractUserFactsFromMessage('Mi color favorito es el azul')
    expect(p.favorites?.some((x) => /azul/i.test(x))).toBe(true)
  })
})
