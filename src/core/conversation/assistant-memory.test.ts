import { describe, it, expect } from 'vitest'
import {
  extractAssistantSelfFacts,
  hasAssistantMemorySignal,
  ingestAssistantReply,
  emptyAssistantMemory
} from './assistant-memory'

describe('M3 assistant-memory extract', () => {
  it('extracts likes from first person', () => {
    const p = extractAssistantSelfFacts('La verdad es que me gusta el café por la mañana.')
    expect(hasAssistantMemorySignal(p)).toBe(true)
    expect(p.likes?.some((x) => /café/i.test(x))).toBe(true)
  })

  it('extracts me encanta / me apasiona self talk', () => {
    const p = extractAssistantSelfFacts(
      'Me encanta hablar de mí misma. Me apasiona aprender cosas nuevas y a veces me dedico a pintar.'
    )
    expect(hasAssistantMemorySignal(p)).toBe(true)
    expect((p.likes?.length || 0) + (p.habits?.length || 0)).toBeGreaterThan(0)
  })

  it('does not treat user-directed as self', () => {
    const p = extractAssistantSelfFacts('Me alegra que te guste el café.')
    expect(p.likes?.length || 0).toBe(0)
  })

  it('merges via ingest', () => {
    const next = ingestAssistantReply(
      emptyAssistantMemory(),
      'Prefiero el té al vino y siempre escribo con calma.'
    )
    expect(next).not.toBeNull()
    expect((next!.likes?.length || 0) + (next!.habits?.length || 0)).toBeGreaterThan(0)
  })

  it('extracts soy fan de…', () => {
    const p = extractAssistantSelfFacts('La verdad soy fan del café de olla.')
    expect(p.likes?.some((x) => /café/i.test(x))).toBe(true)
  })

  it('extracts de mis favoritos', () => {
    const p = extractAssistantSelfFacts('El verde es de mis favoritos, sobre todo en ropa.')
    expect(p.likes?.some((x) => /verde/i.test(x))).toBe(true)
  })

  it('extracts me late / me muero por', () => {
    const a = extractAssistantSelfFacts('Me late mucho el jazz suave por la noche.')
    const b = extractAssistantSelfFacts('Me muero por un buen pan dulce.')
    expect(a.likes?.length || 0).toBeGreaterThan(0)
    expect(b.likes?.length || 0).toBeGreaterThan(0)
  })

  it('extracts una de las cosas que más me gustan', () => {
    const p = extractAssistantSelfFacts(
      'Una de las cosas que más me gustan es platicar contigo sin prisa.'
    )
    expect(hasAssistantMemorySignal(p)).toBe(true)
  })
})
