import { describe, expect, it } from 'vitest'
import {
  appendAssistantMemoryTurnReceipt,
  createAssistantMemoryTurnReceipt,
  hasAssistantMemoryTurnReceipt
} from './assistant-memory-idempotency'

describe('assistant memory turn receipts', () => {
  it('creates a stable key scoped to conversation, turn, and extractor version', () => {
    const receipt = createAssistantMemoryTurnReceipt('conv-1', 'turn-2', 3)
    expect(receipt).toBe('assistant-memory:v3:conv-1:turn-2')
    expect(createAssistantMemoryTurnReceipt('', 'turn-2')).toBeNull()
    expect(createAssistantMemoryTurnReceipt('conv-1', '')).toBeNull()
  })

  it('appends once and keeps only the newest bounded receipts', () => {
    const first = appendAssistantMemoryTurnReceipt(['old', 'current'], 'current', 2)
    expect(first).toEqual(['old', 'current'])
    expect(hasAssistantMemoryTurnReceipt(first, 'current')).toBe(true)

    const bounded = appendAssistantMemoryTurnReceipt(first, 'next', 2)
    expect(bounded).toEqual(['current', 'next'])
    expect(hasAssistantMemoryTurnReceipt(bounded, 'old')).toBe(false)
  })
})
