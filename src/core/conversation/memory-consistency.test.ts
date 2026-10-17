import { describe, it, expect } from 'vitest'
import { runMemoryConsistencyPass } from './memory-consistency'

describe('memory consistency', () => {
  it('picks favorite color from assistant history', () => {
    const r = runMemoryConsistencyPass({
      messages: [
        {
          role: 'assistant',
          content:
            '¡Ay, Nahum! Mi color favorito es el verde — representa la vida. Me encanta cómo se ve.'
        }
      ],
      assistantMemory: { likes: [], favorites: [] },
      userMemory: { facts: [] }
    })
    expect(r.favoritesFound.some((x) => /verde/i.test(x))).toBe(true)
  })
})
