import { describe, it, expect } from 'vitest'
import {
  packContext,
  defaultBudget,
  shrinkBudget,
  buildHeuristicSummary
} from './context-window'
import type { ChatMessage } from '@core/providers'

describe('packContext', () => {
  it('keeps system and recent messages under budget', () => {
    const system: ChatMessage[] = [{ role: 'system', content: 'You are helpful.' }]
    const history: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${i} ` + 'x'.repeat(200)
    }))
    const user: ChatMessage = { role: 'user', content: 'hola' }
    const packed = packContext(system, history, user, defaultBudget('local'))
    expect(packed.messages.length).toBeGreaterThan(2)
    expect(packed.messages[0].role).toBe('system')
    expect(packed.messages[packed.messages.length - 1].content).toBe('hola')
  })

  it('injects external model summary when provided', () => {
    const system: ChatMessage[] = [{ role: 'system', content: 'sys' }]
    const history: ChatMessage[] = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg ${i}`
    }))
    const user: ChatMessage = { role: 'user', content: 'nuevo' }
    const packed = packContext(
      system,
      history,
      user,
      { maxChars: 50_000, keepRecentMessages: 4 },
      'RESUMEN_MODELO: el usuario habla de TypeScript'
    )
    expect(packed.summaryInjected).toBe(true)
    const summaryMsg = packed.messages.find((m) =>
      m.content.includes('RESUMEN_MODELO')
    )
    expect(summaryMsg).toBeTruthy()
  })

  it('shrinkBudget reduces capacity', () => {
    const b = defaultBudget('cloud')
    const s = shrinkBudget(b)
    expect(s.maxChars).toBeLessThan(b.maxChars)
    expect(s.keepRecentMessages).toBeLessThanOrEqual(b.keepRecentMessages)
  })

  it('buildHeuristicSummary produces text', () => {
    const older: ChatMessage[] = [
      { role: 'user', content: 'Hola mundo' },
      { role: 'assistant', content: 'Hola, ¿en qué ayudo?' }
    ]
    const s = buildHeuristicSummary(older)
    expect(s).toContain('Usuario')
    expect(s).toContain('Asistente')
  })
})
