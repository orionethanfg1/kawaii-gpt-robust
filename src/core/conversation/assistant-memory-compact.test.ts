import { describe, it, expect } from 'vitest'
import {
  phraseSimilarity,
  compactStringList,
  compactAssistantMemory
} from './assistant-memory-compact'

describe('B7 compact assistant memory', () => {
  it('detects similar landscape phrases', () => {
    const a = 'ver el amanecer sobre un lago, cuando la luz es suave'
    const b = 'ver el amanecer sobre un lago'
    expect(phraseSimilarity(a, b)).toBeGreaterThan(0.5)
  })

  it('merges near-duplicates keeping shorter', () => {
    const out = compactStringList(
      [
        'la astronomía',
        'la astronomía y mirar las estrellas por la noche cuando puedo',
        'explorar lugares nuevos',
        'explorar lugares nuevos, especialmente cuando hace buen clima'
      ],
      8
    )
    expect(out.length).toBeLessThanOrEqual(2)
    expect(out.some((x) => x === 'la astronomía' || x.startsWith('la astronom'))).toBe(true)
  })

  it('caps likes at 8', () => {
    const mem = compactAssistantMemory({
      likes: Array.from({ length: 20 }, (_, i) => `gusto unico numero ${i} cafe`),
      updatedAt: Date.now()
    })
    expect((mem.likes || []).length).toBeLessThanOrEqual(8)
  })
})
