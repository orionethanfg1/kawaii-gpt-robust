import { describe, it, expect } from 'vitest'
import { smartConversationTitle, suggestConversationTitlesHeuristic } from './index'

describe('smartConversationTitle', () => {
  it('does not use the raw first message for book review', () => {
    const t = smartConversationTitle('Puedes revisar mi libro linda? Quiero conocer tu opinión')
    expect(t.toLowerCase()).not.toMatch(/puedes revisar/)
    expect(t.toLowerCase()).toMatch(/libro|revisión|revision/)
  })

  it('strips vocatives', () => {
    const t = smartConversationTitle('Hola linda, explícame quantum')
    expect(t.toLowerCase()).not.toMatch(/linda/)
  })

  it('suggests up to 3', () => {
    const s = suggestConversationTitlesHeuristic([
      { role: 'user', content: 'Puedes revisar mi libro?' },
      { role: 'assistant', content: 'Claro' }
    ])
    expect(s.length).toBeGreaterThan(0)
    expect(s.length).toBeLessThanOrEqual(3)
  })
})
