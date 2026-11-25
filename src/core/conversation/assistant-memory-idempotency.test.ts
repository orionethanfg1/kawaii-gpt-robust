import { describe, expect, it } from 'vitest'
import {
  appendAssistantMemoryTurnReceipt,
  appendForgottenTurnReceipt,
  createAssistantMemoryTurnReceipt,
  decideMemoryWrite,
  hasAssistantMemoryTurnReceipt,
  isTurnReceiptForgotten,
  opsIndicateForgetOrCorrect,
  shouldCollectForTurnReceipt,
  simulateMemoryWriteGate
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

describe('forgotten receipt ledger (pure)', () => {
  it('appends and bounds forgotten receipts without mutating input', () => {
    const initial = ['a']
    const next = appendForgottenTurnReceipt(initial, 'b', 2)
    expect(next).toEqual(['a', 'b'])
    expect(initial).toEqual(['a'])
    expect(appendForgottenTurnReceipt(['a', 'b'], 'c', 2)).toEqual(['b', 'c'])
    expect(isTurnReceiptForgotten(['b', 'c'], 'b')).toBe(true)
    expect(isTurnReceiptForgotten(['b', 'c'], 'a')).toBe(false)
  })
})

describe('decideMemoryWrite (pure single-event gate)', () => {
  const receipt = createAssistantMemoryTurnReceipt('c1', 't1')!

  it('allows first collect and proposes appended receipts without mutating input', () => {
    const initial = ['prior']
    const decision = decideMemoryWrite(initial, {
      kind: 'collect',
      turnReceipt: receipt,
      payload: { likes: ['coffee'] }
    })
    expect(decision.allowWrite).toBe(true)
    expect(decision.reason).toBe('written')
    expect(decision.receipts).toEqual(['prior', receipt])
    expect(decision.forgotten).toEqual([])
    expect(initial).toEqual(['prior'])
  })

  it('skips duplicates', () => {
    const decision = decideMemoryWrite([receipt], { kind: 'collect', turnReceipt: receipt })
    expect(decision).toMatchObject({ allowWrite: false, reason: 'duplicate-skipped' })
  })

  it('skips partials and invalid receipts', () => {
    expect(decideMemoryWrite([], { kind: 'partial', turnReceipt: receipt }).reason).toBe(
      'partial-skipped'
    )
    expect(decideMemoryWrite([], { kind: 'collect', turnReceipt: null }).reason).toBe(
      'invalid-receipt'
    )
  })

  it('forget removes receipt and records forgotten ledger', () => {
    const afterForget = decideMemoryWrite([receipt], { kind: 'forget', turnReceipt: receipt })
    expect(afterForget).toMatchObject({
      allowWrite: false,
      reason: 'forgotten',
      markForgotten: true,
      receipts: [],
      forgotten: [receipt]
    })
    const late = decideMemoryWrite([], { kind: 'collect', turnReceipt: receipt }, {
      forgotten: afterForget.forgotten
    })
    expect(late).toMatchObject({ allowWrite: false, reason: 'late-after-forget' })
  })
})

describe('shouldCollectForTurnReceipt (collector helper)', () => {
  const receipt = createAssistantMemoryTurnReceipt('c1', 't1')!

  it('allows when no receipt (legacy turns)', () => {
    expect(shouldCollectForTurnReceipt([], null).allow).toBe(true)
    expect(shouldCollectForTurnReceipt([], undefined).reason).toBe('no-receipt')
  })

  it('blocks when receipt already present', () => {
    const r = shouldCollectForTurnReceipt([receipt], receipt)
    expect(r).toEqual({ allow: false, reason: 'duplicate-skipped' })
  })

  it('blocks when receipt is in durable forgotten ledger', () => {
    const r = shouldCollectForTurnReceipt([], receipt, 'collect', [receipt])
    expect(r).toEqual({ allow: false, reason: 'late-after-forget' })
  })

  it('allows first collect for new receipt', () => {
    expect(shouldCollectForTurnReceipt([], receipt)).toEqual({
      allow: true,
      reason: 'written'
    })
  })
})

describe('opsIndicateForgetOrCorrect', () => {
  it('detects remove/forget/correct ops', () => {
    expect(opsIndicateForgetOrCorrect([{ kind: 'remove' }])).toBe(true)
    expect(opsIndicateForgetOrCorrect([{ kind: 'forget' }])).toBe(true)
    expect(opsIndicateForgetOrCorrect([{ kind: 'add' }])).toBe(false)
    expect(opsIndicateForgetOrCorrect([])).toBe(false)
  })
})

describe('M1 pure write gate simulation', () => {
  const receipt = createAssistantMemoryTurnReceipt('c1', 't1')!

  it('writes once and skips duplicates / retries / double onDone', () => {
    const outcomes = simulateMemoryWriteGate([], [
      { kind: 'collect', turnReceipt: receipt, payload: { likes: ['coffee'] } },
      { kind: 'retry', turnReceipt: receipt },
      { kind: 'collect', turnReceipt: receipt }
    ])
    expect(outcomes.map((o) => o.wrote)).toEqual([true, false, false])
    expect(outcomes[0].reason).toBe('written')
    expect(outcomes[1].reason).toBe('duplicate-skipped')
    expect(outcomes[2].receipts).toEqual([receipt])
  })

  it('skips partial responses', () => {
    const outcomes = simulateMemoryWriteGate([], [
      { kind: 'partial', turnReceipt: receipt },
      { kind: 'collect', turnReceipt: receipt }
    ])
    expect(outcomes[0]).toMatchObject({ wrote: false, reason: 'partial-skipped' })
    expect(outcomes[1].wrote).toBe(true)
  })

  it('forget or correct wins over a later collect (durable forgotten)', () => {
    const outcomes = simulateMemoryWriteGate([receipt], [
      { kind: 'forget', turnReceipt: receipt },
      { kind: 'collect', turnReceipt: receipt, payload: { likes: ['late'] } }
    ])
    expect(outcomes[0]).toMatchObject({ wrote: false, reason: 'forgotten' })
    expect(outcomes[0].forgotten).toEqual([receipt])
    expect(outcomes[1]).toMatchObject({ wrote: false, reason: 'late-after-forget' })
    expect(outcomes[1].receipts).toEqual([])
    expect(outcomes[1].forgotten).toEqual([receipt])
  })

  it('does not mutate the original receipts array', () => {
    const original = ['prior']
    simulateMemoryWriteGate(original, [{ kind: 'collect', turnReceipt: receipt }])
    expect(original).toEqual(['prior'])
  })

  it('rejects invalid receipts', () => {
    const outcomes = simulateMemoryWriteGate([], [{ kind: 'collect', turnReceipt: null }])
    expect(outcomes[0]).toMatchObject({ wrote: false, reason: 'invalid-receipt' })
  })
})
