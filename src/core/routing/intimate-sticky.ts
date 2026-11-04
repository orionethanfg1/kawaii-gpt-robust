/**
 * R5 — Sticky intimacy task window so short follow-ups stay on abliterated path.
 * Reset when chat changes or adult opt-in is turned off.
 */

export const INTIMATE_STICKY_MS = 2 * 60 * 1000

const G = globalThis as {
  __kawaiiIntimateStickyUntil?: number
  __kawaiiIntimateStickyConvId?: string | null
}

/** Remaining sticky until timestamp (0 if expired). */
export function getIntimateStickyUntil(): number {
  const until = G.__kawaiiIntimateStickyUntil || 0
  return until > Date.now() ? until : 0
}

export function isIntimateStickyActive(opts?: {
  adultOptIn?: boolean
  conversationId?: string | null
}): boolean {
  if (opts && opts.adultOptIn === false) return false
  const until = getIntimateStickyUntil()
  if (!until) return false
  if (opts?.conversationId != null && G.__kawaiiIntimateStickyConvId != null) {
    if (String(opts.conversationId) !== String(G.__kawaiiIntimateStickyConvId)) return false
  }
  return true
}

export function armIntimateSticky(opts?: {
  ms?: number
  conversationId?: string | null
}): number {
  const ms = opts?.ms ?? INTIMATE_STICKY_MS
  const until = Date.now() + ms
  G.__kawaiiIntimateStickyUntil = until
  if (opts?.conversationId !== undefined) {
    G.__kawaiiIntimateStickyConvId = opts.conversationId
  }
  return until
}

export function clearIntimateSticky(reason?: string): void {
  G.__kawaiiIntimateStickyUntil = 0
  G.__kawaiiIntimateStickyConvId = null
  if (reason) {
    try {
      console.info('[auto-route] intimate sticky cleared:', reason)
    } catch {
      /* */
    }
  }
}

/** Call when active conversation changes. */
export function onConversationChanged(nextId: string | null | undefined): void {
  const prev = G.__kawaiiIntimateStickyConvId
  if (prev != null && String(nextId || '') !== String(prev)) {
    clearIntimateSticky('conversation-changed')
  }
  // Bind sticky to current chat if still active
  if (getIntimateStickyUntil() && nextId) {
    G.__kawaiiIntimateStickyConvId = nextId
  }
}

/** Call when adultIntimacyOptIn flips to false. */
export function onAdultOptInChanged(enabled: boolean): void {
  if (!enabled) clearIntimateSticky('adult-opt-in-off')
}
