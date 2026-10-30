import { describe, it, expect } from 'vitest'
import {
  classifyAssistantLikePhrase,
  extractAssistantSelfFacts,
  partitionAssistantLikes,
  emptyAssistantMemory
} from './assistant-memory'

describe('B2 classify assistant likes', () => {
  it('stable: café / astronomía', () => {
    expect(classifyAssistantLikePhrase('el café de olla')).toBe('stable')
    expect(classifyAssistantLikePhrase('la astronomía')).toBe('stable')
  })
  it('relational: para Nahum / contigo', () => {
    expect(classifyAssistantLikePhrase('explorar nuevas recetas y cocinar para Nahum')).toBe(
      'relational'
    )
    expect(classifyAssistantLikePhrase('pasar tiempo contigo')).toBe('relational')
  })
  it('extract splits relational', () => {
    const ex = extractAssistantSelfFacts(
      'Me encanta la astronomía. También me gusta cocinar para Nahum.'
    )
    expect(ex.likes?.some((l) => /astronom/i.test(l))).toBe(true)
    expect(ex.relational?.some((l) => /Nahum|cocinar/i.test(l))).toBe(true)
  })
  it('partition migrates legacy likes', () => {
    const m = partitionAssistantLikes({
      ...emptyAssistantMemory(),
      likes: ['la astronomía', 'cocinar para Nahum']
    })
    expect(m.likes).toEqual(['la astronomía'])
    expect(m.relational?.some((x) => /Nahum/i.test(x))).toBe(true)
  })
})
