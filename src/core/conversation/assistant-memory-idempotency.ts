export const ASSISTANT_MEMORY_EXTRACTOR_VERSION = 1
export const MAX_ASSISTANT_MEMORY_TURN_RECEIPTS = 512
export const MAX_ASSISTANT_MEMORY_FORGOTTEN_RECEIPTS = 512

export function createAssistantMemoryTurnReceipt(
  conversationId: string,
  assistantTurnId: string,
  extractorVersion = ASSISTANT_MEMORY_EXTRACTOR_VERSION
): string | null {
  const conversation = String(conversationId || '').trim()
  const turn = String(assistantTurnId || '').trim()
  if (!conversation || !turn || !Number.isInteger(extractorVersion) || extractorVersion < 1) {
    return null
  }
  const receipt = `assistant-memory:v${extractorVersion}:${conversation}:${turn}`
  return receipt.length <= 512 ? receipt : null
}

export function hasAssistantMemoryTurnReceipt(
  receipts: readonly string[] | null | undefined,
  receipt: string
): boolean {
  return Boolean(receipt) && (receipts || []).includes(receipt)
}

export function appendAssistantMemoryTurnReceipt(
  receipts: readonly string[] | null | undefined,
  receipt: string,
  max = MAX_ASSISTANT_MEMORY_TURN_RECEIPTS
): string[] {
  if (!receipt || !Number.isInteger(max) || max < 1) return [...(receipts || [])]
  const next = [...(receipts || []).filter((item) => item !== receipt), receipt]
  return next.slice(-max)
}

/** Pure: bounded forgotten-receipt ledger (never mutates input). */
export function appendForgottenTurnReceipt(
  forgotten: readonly string[] | null | undefined,
  receipt: string,
  max = MAX_ASSISTANT_MEMORY_FORGOTTEN_RECEIPTS
): string[] {
  if (!receipt || !Number.isInteger(max) || max < 1) return [...(forgotten || [])]
  const next = [...(forgotten || []).filter((item) => item !== receipt), receipt]
  return next.slice(-max)
}

export function isTurnReceiptForgotten(
  forgotten: readonly string[] | null | undefined,
  receipt: string
): boolean {
  return Boolean(receipt) && (forgotten || []).includes(receipt)
}

export type MemoryWriteEvent = {
  kind: 'collect' | 'forget' | 'correct' | 'partial' | 'retry'
  turnReceipt: string | null
  payload?: unknown
}

export type MemoryWriteDecision = {
  allowWrite: boolean
  reason: string
  /** Receipts after this decision (deep-copied; never mutates input). */
  receipts: string[]
  /** Forgotten ledger after this decision (deep-copied). */
  forgotten: string[]
  /** When true, callers should persist the forgotten ledger. */
  markForgotten?: boolean
}

export type MemoryWriteOutcome = {
  wrote: boolean
  receipts: string[]
  forgotten: string[]
  reason: string
  appliedPayload?: unknown
}

/**
 * Pure single-event decision for the M1 write gate.
 * Never mutates inputs. Used by the collector and by multi-event simulation.
 */
export function decideMemoryWrite(
  initialReceipts: readonly string[] | null | undefined,
  event: MemoryWriteEvent,
  options?: { forgotten?: readonly string[] | ReadonlySet<string> }
): MemoryWriteDecision {
  const receipts = [...(initialReceipts || [])]
  const forgottenList = Array.isArray(options?.forgotten)
    ? [...options!.forgotten!]
    : options?.forgotten
      ? [...options.forgotten]
      : []
  const forgottenSet =
    options?.forgotten instanceof Set
      ? options.forgotten
      : new Set(forgottenList)
  const receipt = event.turnReceipt

  if (!receipt) {
    return { allowWrite: false, reason: 'invalid-receipt', receipts, forgotten: forgottenList }
  }

  if (event.kind === 'forget' || event.kind === 'correct') {
    return {
      allowWrite: false,
      reason: event.kind === 'forget' ? 'forgotten' : 'corrected',
      receipts: receipts.filter((r) => r !== receipt),
      forgotten: appendForgottenTurnReceipt(forgottenList, receipt),
      markForgotten: true
    }
  }

  if (event.kind === 'partial') {
    return {
      allowWrite: false,
      reason: 'partial-skipped',
      receipts,
      forgotten: forgottenList
    }
  }

  if (forgottenSet.has(receipt) || isTurnReceiptForgotten(forgottenList, receipt)) {
    return {
      allowWrite: false,
      reason: 'late-after-forget',
      receipts,
      forgotten: forgottenList
    }
  }

  if (hasAssistantMemoryTurnReceipt(receipts, receipt)) {
    return {
      allowWrite: false,
      reason: 'duplicate-skipped',
      receipts,
      forgotten: forgottenList
    }
  }

  return {
    allowWrite: true,
    reason: 'written',
    receipts: appendAssistantMemoryTurnReceipt(receipts, receipt),
    forgotten: forgottenList
  }
}

/**
 * Multi-event pure simulation of the M1 single-write gate.
 * Composes decideMemoryWrite; never mutates inputs.
 */
export function simulateMemoryWriteGate(
  initialReceipts: readonly string[] | null | undefined,
  events: readonly MemoryWriteEvent[],
  initialForgotten: readonly string[] | null | undefined = []
): MemoryWriteOutcome[] {
  let receipts = [...(initialReceipts || [])]
  let forgotten = [...(initialForgotten || [])]
  const outcomes: MemoryWriteOutcome[] = []

  for (const event of events) {
    const decision = decideMemoryWrite(receipts, event, { forgotten })
    receipts = decision.receipts
    forgotten = decision.forgotten
    outcomes.push({
      wrote: decision.allowWrite,
      receipts: [...decision.receipts],
      forgotten: [...decision.forgotten],
      reason: decision.reason,
      ...(decision.allowWrite && event.payload !== undefined
        ? { appliedPayload: event.payload }
        : {})
    })
  }

  return outcomes
}

/**
 * Collector-facing helper: whether a collect for this turn receipt may proceed.
 * Pure; does not mutate receipts/forgotten.
 */
export function shouldCollectForTurnReceipt(
  receipts: readonly string[] | null | undefined,
  turnReceipt: string | null | undefined,
  kind: 'collect' | 'partial' | 'retry' = 'collect',
  forgotten?: readonly string[] | null
): { allow: boolean; reason: string } {
  if (!turnReceipt) {
    return { allow: true, reason: 'no-receipt' }
  }
  const decision = decideMemoryWrite(receipts, { kind, turnReceipt }, { forgotten: forgotten || [] })
  return { allow: decision.allowWrite, reason: decision.reason }
}

/** True when ops from reconcile include a user-driven remove/forget/correct. */
export function opsIndicateForgetOrCorrect(
  ops: Array<{ kind: string }> | null | undefined
): boolean {
  if (!ops || !ops.length) return false
  return ops.some((o) => {
    const k = String(o.kind || '').toLowerCase()
    return (
      k === 'remove' ||
      k === 'forget' ||
      k === 'correct' ||
      k === 'delete' ||
      k.startsWith('remove') ||
      k.startsWith('forget')
    )
  })
}
