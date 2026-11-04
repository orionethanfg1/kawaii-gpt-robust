/**
 * X7 — initiative anchors after assistant stream completes (not on user send).
 * Pure timestamps + event; no LLM templates here.
 */
const lastStreamDoneAt = new Map<string, number>()

export function markAssistantStreamDone(convId: string, at = Date.now()): void {
  if (!convId) return
  lastStreamDoneAt.set(convId, at)
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('kawaii:assistant-stream-done', {
          detail: { convId, at }
        })
      )
    }
  } catch {
    /* optional */
  }
}

export function getAssistantStreamDoneAt(convId: string): number {
  return lastStreamDoneAt.get(convId) || 0
}

/** For tests */
export function _resetAssistantStreamDoneMap(): void {
  lastStreamDoneAt.clear()
}
