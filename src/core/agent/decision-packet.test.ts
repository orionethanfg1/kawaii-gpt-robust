import { describe, expect, it } from 'vitest'
import { buildDecisionPacket, formatDecisionLog } from './decision-packet'

describe('buildDecisionPacket', () => {
  it('routes bare sigue with open doc to docs + inject.docs', () => {
    const p = buildDecisionPacket({
      userText: 'sigue',
      hasOpenDocReading: true,
      forceDocContinue: true
    })
    expect(p.task).toBe('docs')
    expect(p.inject.docs).toBe(true)
    expect(p.modelHint).toBe('sticky')
    expect(p.reason).toMatch(/forceDocContinue|docs/)
  })

  it('does not inject library on pure chat', () => {
    const p = buildDecisionPacket({ userText: 'hola, cómo estás?' })
    expect(p.task).toBe('chat')
    expect(p.inject.library).toBe(false)
    expect(p.inject.docs).toBe(false)
  })

  it('flags files intent as high risk + library inject', () => {
    const p = buildDecisionPacket({
      userText: 'lista mis archivos de la biblioteca'
    })
    expect(p.task).toBe('files')
    expect(p.risk).toBe('high')
    expect(p.inject.library).toBe(true)
    expect(p.needsTools).toBe(true)
  })

  it('maps vision attachment', () => {
    const p = buildDecisionPacket({
      userText: 'qué ves?',
      hasImageAttachment: true
    })
    expect(p.needsVision).toBe(true)
    expect(['vision', 'image']).toContain(p.task)
  })

  it('formatDecisionLog is non-empty', () => {
    const p = buildDecisionPacket({ userText: 'hola' })
    expect(formatDecisionLog(p)).toMatch(/^\[decision\]/)
  })
})
