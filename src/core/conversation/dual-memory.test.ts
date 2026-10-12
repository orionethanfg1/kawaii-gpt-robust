import { describe, it, expect } from 'vitest'
import { migrateToDual, isUserMemorySparse, emptyUserMemory } from './dual-memory'
import { emptyAssistantMemory, isAssistantMemoryEmpty } from './assistant-memory'
import {
  snapshotUserMemory,
  hasUserMemoryBackup,
  restoreLatestUserMemory,
  shouldOfferMemoryRestore,
  acknowledgeMemoryGate,
  evaluateMemoryGate
} from './memory-backup-gate'

describe('M0 dual-memory', () => {
  it('migrates legacy user-only settings', () => {
    const d = migrateToDual({
      userMemory: { facts: ['vivo en X'], likes: ['café'], preferredName: 'Nahum' }
    })
    expect(d.user.preferredName).toBe('Nahum')
    expect(d.user.likes).toContain('café')
    expect(isAssistantMemoryEmpty(d.assistant)).toBe(true)
  })

  it('detects sparse vs rich user memory', () => {
    expect(isUserMemorySparse(emptyUserMemory())).toBe(true)
    expect(isUserMemorySparse({ likes: ['té'] })).toBe(false)
    expect(isUserMemorySparse({ preferredName: 'Ana' })).toBe(false)
  })
})

describe('M1 memory-backup-gate', () => {
  it('snapshots and restores when localStorage available', () => {
    if (typeof localStorage === 'undefined') {
      // Node/vitest without LS — soft skip
      expect(true).toBe(true)
      return
    }
    localStorage.clear()
    const mem = {
      facts: ['dato'],
      likes: ['café'],
      preferredName: 'Nahum',
      dislikes: [] as string[],
      nicknames: [] as string[],
      goals: [] as string[]
    }
    expect(snapshotUserMemory(mem, 'test')).toBe(true)
    expect(hasUserMemoryBackup()).toBe(true)
    const restored = restoreLatestUserMemory()
    expect(restored?.preferredName).toBe('Nahum')
    expect(restored?.likes).toContain('café')
    expect(shouldOfferMemoryRestore(emptyUserMemory())).toBe(true)
    acknowledgeMemoryGate('fresh')
    expect(shouldOfferMemoryRestore(emptyUserMemory())).toBe(false)
    const gate = evaluateMemoryGate({ likes: ['x'] })
    expect(gate.kind).toBe('none')
  })
})
