/**
 * E1 — Write policy: when a signal is salient enough to persist.
 * Keeps localStorage and dual-memory from filling with noise.
 */

export type MemoryWriteKind =
  | 'assistant_preferred_name'
  | 'assistant_rejected_name'
  | 'user_preferred_name'
  | 'user_like'
  | 'user_fact'
  | 'growth_note'
  | 'episode'

/** Minimum salience (0–1) to accept a write */
const THRESHOLDS: Record<MemoryWriteKind, number> = {
  assistant_preferred_name: 0.55,
  assistant_rejected_name: 0.5,
  user_preferred_name: 0.6,
  user_like: 0.45,
  user_fact: 0.4,
  growth_note: 0.5,
  episode: 0.55
}

/**
 * Score a candidate signal. Higher = more worth storing.
 */
export function scoreMemorySalience(opts: {
  kind: MemoryWriteKind
  /** Explicit phrase match (me encanta llamarte…) */
  explicit?: boolean
  /** Repeated in transcript */
  repeatCount?: number
  /** User correction / “remember this” */
  userPinned?: boolean
  /** Length of phrase (names should be short) */
  phraseLen?: number
}): number {
  let s = 0.25
  if (opts.explicit) s += 0.45
  if (opts.userPinned) s += 0.35
  const reps = Math.min(5, opts.repeatCount || 0)
  s += reps * 0.08
  const len = opts.phraseLen ?? 0
  if (opts.kind.includes('name') && len >= 2 && len <= 40) s += 0.1
  if (opts.kind.includes('name') && len > 48) s -= 0.3
  return Math.max(0, Math.min(1, s))
}

export function shouldWriteMemory(
  kind: MemoryWriteKind,
  score: number
): boolean {
  return score >= (THRESHOLDS[kind] ?? 0.5)
}

/**
 * Filter preferred names by salience before merge (explicit patterns already high).
 */
export function filterSalientNames(
  names: string[],
  opts?: { explicit?: boolean; repeatCounts?: Record<string, number> }
): string[] {
  const out: string[] = []
  for (const n of names) {
    const score = scoreMemorySalience({
      kind: 'assistant_preferred_name',
      explicit: opts?.explicit !== false,
      repeatCount: opts?.repeatCounts?.[n.toLowerCase()] || 1,
      phraseLen: n.length
    })
    if (shouldWriteMemory('assistant_preferred_name', score)) out.push(n)
  }
  return out
}
