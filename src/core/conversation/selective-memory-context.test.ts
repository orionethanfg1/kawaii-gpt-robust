import { describe, it, expect } from 'vitest'
import { selectAssistantMemoryForTurn } from './selective-memory-context'
import type { AssistantMemory } from './assistant-memory'

const mem: AssistantMemory = {
  likes: ['el café', 'los atardeceres'],
  favorites: ['color: verde'],
  dislikes: [],
  habits: [],
  relational: [],
  boundaries: ['no gritar'],
  voiceNotes: []
}

describe('CV1 selective memory', () => {
  it('greeting does not inject arbitrary likes or favorites', () => {
    const s = selectAssistantMemoryForTurn(mem, 'hola')
    expect(s.greetingOnly).toBe(true)
    expect(s.favorites).toEqual([])
    expect(s.likes).toEqual([])
  })

  it('does not inject unrelated likes or favorites', () => {
    const s = selectAssistantMemoryForTurn(mem, 'cuéntame del clima hoy en la ciudad')
    expect(s.likes).toEqual([])
    expect(s.favorites).toEqual([])
  })

  it('injects tastes when the message is about them', () => {
    const s = selectAssistantMemoryForTurn(mem, 'Hablemos sobre café de olla')
    expect(s.likes).toContain('el café')
  })
})
