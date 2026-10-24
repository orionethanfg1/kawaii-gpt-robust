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
  it('greeting injects one fav and one like', () => {
    const s = selectAssistantMemoryForTurn(mem, 'hola')
    expect(s.greetingOnly).toBe(true)
    expect(s.favorites.length).toBe(1)
    expect(s.likes.length).toBe(1)
  })

  it('default chat keeps at least one like if any exist', () => {
    const s = selectAssistantMemoryForTurn(mem, 'cuéntame del clima hoy en la ciudad')
    expect(s.likes.length + s.favorites.length).toBeGreaterThan(0)
  })
})
