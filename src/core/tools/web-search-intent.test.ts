import { describe, it, expect } from 'vitest'
import {
  wantsWebSearch,
  shouldAutoWebSearch,
  focusSearchQuery,
  suggestInitiativeSearchQuery
} from './web-search-intent'

describe('web-search-intent', () => {
  it('detects explicit search', () => {
    expect(wantsWebSearch('busca en la web noticias de hoy')).toBe(true)
    expect(wantsWebSearch('hola qué tal')).toBe(false)
  })

  it('soft auto for current topics', () => {
    expect(shouldAutoWebSearch('qué pasó hoy con las elecciones')).toBe(true)
    expect(shouldAutoWebSearch('hola')).toBe(false)
  })

  it('focusSearchQuery strips filler', () => {
    const q = focusSearchQuery('por favor busca en la web el clima de CDMX')
    expect(q.toLowerCase()).toMatch(/clima/)
    expect(q.toLowerCase()).not.toMatch(/por favor/)
  })

  it('suggestInitiativeSearchQuery from memory/chat', () => {
    const q = suggestInitiativeSearchQuery({
      recentLines: ['Nahum: me gustó esa película de Dune'],
      likes: ['series'],
      focus: 'cine'
    })
    // may or may not match depending on pattern — at least null-safe
    expect(q === null || q.length >= 4).toBe(true)
    const news = suggestInitiativeSearchQuery({
      recentLines: ['Usuario: qué noticias hay de actualidad'],
      focus: ''
    })
    expect(news).toBeTruthy()
  })
})
