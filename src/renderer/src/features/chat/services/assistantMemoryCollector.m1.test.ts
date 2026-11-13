/**
 * M1 — turnKey idempotency for assistant memory collector.
 * Pure helpers only (no Zustand/localStorage required for key construction).
 */
import { describe, it, expect } from 'vitest'
import {
  buildAssistantMemoryTurnKey,
  ASSISTANT_COLLECTOR_EXTRACTOR_VERSION
} from './assistantMemoryCollector'

describe('M1 buildAssistantMemoryTurnKey', () => {
  it('uses conversationId + assistantMessageId when both present', () => {
    const k = buildAssistantMemoryTurnKey({
      conversationId: 'conv-a',
      assistantMessageId: 'msg-1',
      replyText: 'ignored when ids present'
    })
    expect(k).toBe(`conv-a::msg-1::${ASSISTANT_COLLECTOR_EXTRACTOR_VERSION}`)
  })

  it('is stable for the same ids', () => {
    const a = buildAssistantMemoryTurnKey({
      conversationId: 'c1',
      assistantMessageId: 'm1'
    })
    const b = buildAssistantMemoryTurnKey({
      conversationId: 'c1',
      assistantMessageId: 'm1'
    })
    expect(a).toBe(b)
  })

  it('differs across message ids', () => {
    const a = buildAssistantMemoryTurnKey({
      conversationId: 'c1',
      assistantMessageId: 'm1'
    })
    const b = buildAssistantMemoryTurnKey({
      conversationId: 'c1',
      assistantMessageId: 'm2'
    })
    expect(a).not.toBe(b)
  })

  it('falls back to content fingerprint without ids', () => {
    const k = buildAssistantMemoryTurnKey({
      replyText: 'Me gusta el café de olla por las mañanas.'
    })
    expect(k.startsWith('anon::')).toBe(true)
    expect(k.includes(ASSISTANT_COLLECTOR_EXTRACTOR_VERSION)).toBe(true)
  })
})
