import { describe, it, expect } from 'vitest'
import { cutAtSecondRestart } from './collapse-openers'
import {
  processAssistantReplyForDisplay,
  processAssistantReplyForMemory,
  finalizeAssistantReply
} from './assistant-reply-pipeline'

describe('B1 finalize / truncation', () => {
  it('keeps two distinct Me encanta preferences', () => {
    const raw =
      'Me encanta la astronomía y mirar las estrellas. Me encanta cocinar para Nahum los domingos.'
    const cut = cutAtSecondRestart(raw)
    expect(cut).toMatch(/astronom/i)
    expect(cut).toMatch(/cocinar/i)
    const mem = processAssistantReplyForMemory(raw)
    expect(mem).toMatch(/astronom/i)
    expect(mem).toMatch(/cocinar/i)
  })

  it('cuts duplicate Gracias restart', () => {
    const raw =
      'Gracias, Nahum, por compartir eso. Me alegra. Gracias, Nahum, por compartir eso otra vez.'
    const cut = cutAtSecondRestart(raw)
    expect((cut.match(/Gracias/gi) || []).length).toBe(1)
  })

  it('marks length limited finish reason', () => {
    const fin = finalizeAssistantReply('Hola mundo completo aquí.', {
      finishReason: 'length'
    })
    expect(fin.limited).toBe(true)
    expect(fin.display).toMatch(/Hola/)
  })

  it('display and memory paths both return non-empty', () => {
    const raw = '¡Qué idea! Los bosques celtas son mágicos. Me encantaría explorarlos contigo.'
    expect(processAssistantReplyForDisplay(raw).length).toBeGreaterThan(20)
    expect(processAssistantReplyForMemory(raw).length).toBeGreaterThan(20)
  })
})
