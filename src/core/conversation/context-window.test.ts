import { describe, it, expect } from 'vitest'
import {
  packContext,
  defaultBudget,
  planContext
} from './index'
import {
  shrinkBudget,
  buildHeuristicSummary
} from './context-window'
import type { ChatMessage } from '@core/providers'

describe('packContext', () => {
  it('requests compaction on message overflow without marking the context tight', () => {
    const plan = planContext({
      modelId: 'qwen3:14b',
      kind: 'local',
      profile: 'mid',
      messageCount: 25
    })

    expect(plan.forceSummary).toBe(true)
    expect(plan.isTight).toBe(false)
  })

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
      { maxMessages: 20, maxChars: 50_000, keepRecentMessages: 4 },
      'RESUMEN_MODELO: el usuario habla de TypeScript'
    )
    expect(packed.summaryInjected).toBe(true)
    const summaryMsg = packed.messages.find((m) =>
      m.content.includes('RESUMEN_MODELO')
    )
    expect(summaryMsg).toBeTruthy()
  })

  it('packs summary before the capped recent history and preserves system anchors', () => {
    const system: ChatMessage[] = [
      { role: 'system', content: 'PERSONALITY_ANCHOR' },
      { role: 'system', content: 'MEMORY_ANCHOR' }
    ]
    const history: ChatMessage[] = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn-${i}`
    }))
    const packed = packContext(
      system,
      history,
      { role: 'user', content: 'current' },
      { maxMessages: 20, maxChars: 50_000, keepRecentMessages: 4 }
    )
    const contents = packed.messages.map((message) => message.content)
    const summaryIndex = contents.findIndex((content) =>
      content.includes('Resumen previo de la conversación')
    )

    expect(contents.slice(0, 2)).toEqual(['PERSONALITY_ANCHOR', 'MEMORY_ANCHOR'])
    expect(summaryIndex).toBe(2)
    expect(contents.slice(-5, -1)).toEqual(['turn-8', 'turn-9', 'turn-10', 'turn-11'])
    expect(contents.at(-1)).toBe('current')
    expect(packed.truncated).toBe(true)
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
