export const ASSISTANT_MEMORY_EXTRACTOR_VERSION = 1
export const MAX_ASSISTANT_MEMORY_TURN_RECEIPTS = 512

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
