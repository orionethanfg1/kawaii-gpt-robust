/**
 * X9 — Idle review planner (pure). No LLM, no stores, no orchestrator.
 * Decides *what* is safe to do when the user is idle.
 */
export type IdleReviewKind = 'memory_harvest' | 'memory_consistency' | 'none'

export type IdleReviewPlan = {
  kind: IdleReviewKind
  reason: string
  /** Minimum ms since last user/assistant activity before this kind is ok */
  minIdleMs: number
}

export type IdleReviewSignals = {
  /** ms since last user interaction or stream activity */
  idleMs: number
  streamBusy: boolean
  chatBusy: boolean
  /** ms since last successful idle review of any kind */
  sinceLastReviewMs: number
  /** Prefer alternating kinds */
  lastKind?: IdleReviewKind
}

const MIN_IDLE_MS = 25_000
const MIN_BETWEEN_REVIEWS_MS = 45_000

/**
 * Pure scheduler: returns one cheap review job or none.
 */
export function planIdleReview(s: IdleReviewSignals): IdleReviewPlan {
  if (s.streamBusy || s.chatBusy) {
    return { kind: 'none', reason: 'busy', minIdleMs: MIN_IDLE_MS }
  }
  if (s.idleMs < MIN_IDLE_MS) {
    return { kind: 'none', reason: 'not_idle', minIdleMs: MIN_IDLE_MS }
  }
  if (s.sinceLastReviewMs < MIN_BETWEEN_REVIEWS_MS) {
    return { kind: 'none', reason: 'cooldown', minIdleMs: MIN_IDLE_MS }
  }
  // Alternate: consistency ↔ harvest
  if (s.lastKind === 'memory_harvest') {
    return {
      kind: 'memory_consistency',
      reason: 'alternate_consistency',
      minIdleMs: MIN_IDLE_MS
    }
  }
  if (s.lastKind === 'memory_consistency') {
    return {
      kind: 'memory_harvest',
      reason: 'alternate_harvest',
      minIdleMs: MIN_IDLE_MS
    }
  }
  // First pass prefers harvest (names from open chats)
  return {
    kind: 'memory_harvest',
    reason: 'initial_harvest',
    minIdleMs: MIN_IDLE_MS
  }
}

export const IDLE_REVIEW_DEFAULTS = {
  minIdleMs: MIN_IDLE_MS,
  minBetweenReviewsMs: MIN_BETWEEN_REVIEWS_MS,
  scanIntervalMs: 20_000
} as const
