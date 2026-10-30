import { describe, it, expect } from 'vitest'
import { collectAssistantMemoryFromReply } from './collect-assistant-memory'
import { emptyAssistantMemory } from './assistant-memory'

describe('B0 collectAssistantMemoryFromReply', () => {
  it('extracts explicit like from cafe phrase', () => {
    const r = collectAssistantMemoryFromReply(
      emptyAssistantMemory(),
      'Me gusta el café de olla por las mañanas, es mi ritual favorito.'
    )
    expect(r.changed).toBe(true)
    expect(r.reason).toBe('merged')
    expect(r.memory.likes?.some((l) => /caf/i.test(l))).toBe(true)
  })

  it('no-signal on pure greeting', () => {
    const r = collectAssistantMemoryFromReply(
      emptyAssistantMemory(),
      '¡Hola! ¿Cómo estás hoy?'
    )
    expect(r.changed).toBe(false)
    expect(r.reason).toMatch(/no-signal|empty/)
  })
})
