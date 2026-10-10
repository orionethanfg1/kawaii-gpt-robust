import { describe, it, expect } from 'vitest'
import {
  reconcileAssistantMemory,
  extractForgetOpsFromUser,
  migrateAssistantMemory,
  resolveMirrorVsStore,
  ASSISTANT_MEMORY_VERSION
} from './assistant-memory-reconcile'
import { emptyAssistantMemory } from './assistant-memory'

describe('B3 reconcile', () => {
  it('adds new like', () => {
    const r = reconcileAssistantMemory(emptyAssistantMemory(), { likes: ['la astronomía'] })
    expect(r.changed).toBe(true)
    expect(r.memory.likes).toContain('la astronomía')
    expect(r.ops.some((o) => o.kind === 'add')).toBe(true)
  })

  it('noop on duplicate', () => {
    const prev = { ...emptyAssistantMemory(), likes: ['la astronomía'] }
    const r = reconcileAssistantMemory(prev, { likes: ['la astronomía'] })
    expect(r.changed).toBe(false)
  })

  it('routes relational from likes candidate', () => {
    const r = reconcileAssistantMemory(emptyAssistantMemory(), {
      likes: ['cocinar para Nahum']
    })
    expect(r.memory.relational?.some((x) => /Nahum/i.test(x))).toBe(true)
  })

  it('forget op removes like', () => {
    const prev = { ...emptyAssistantMemory(), likes: ['el café de olla'] }
    const r = reconcileAssistantMemory(prev, {}, { userText: 'ya no te gusta el café de olla' })
    expect(r.memory.likes || []).not.toContain('el café de olla')
    expect(r.ops.some((o) => o.kind === 'remove')).toBe(true)
  })

  it('migrate sets version', () => {
    const m = migrateAssistantMemory({ likes: ['x'] })
    expect(m.memory.version).toBe(ASSISTANT_MEMORY_VERSION)
  })

  it('resolveMirrorVsStore prefers newer', () => {
    const store = { ...emptyAssistantMemory(), likes: ['a'], updatedAt: 100 }
    const mirror = { ...emptyAssistantMemory(), likes: ['b'], updatedAt: 200 }
    const r = resolveMirrorVsStore(store, mirror)
    expect(r.source).toBe('mirror')
    expect(r.memory.likes).toContain('b')
  })
})
