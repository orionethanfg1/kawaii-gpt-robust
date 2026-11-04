/**
 * Detect when a new assistant reply is mostly an echo of the previous assistant turn
 * (common failure mode with broken thinking templates / stuck local models).
 */

function normalizeForEcho(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenSet(s: string): Set<string> {
  const n = normalizeForEcho(s)
  const parts = n.split(' ').filter((w) => w.length > 2)
  return new Set(parts)
}

/** Jaccard similarity on word tokens (0..1). */
export function textSimilarity(a: string, b: string): number {
  const A = tokenSet(a)
  const B = tokenSet(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  const union = A.size + B.size - inter
  return union > 0 ? inter / union : 0
}

/**
 * True if `next` is likely a near-copy of `prev` (or empty-ish while prev is long).
 */
export function isNearEchoOfPrevious(
  prev: string | undefined | null,
  next: string | undefined | null,
  opts?: { minPrevChars?: number; threshold?: number }
): boolean {
  const p = String(prev || '').trim()
  const n = String(next || '').trim()
  const minPrev = opts?.minPrevChars ?? 80
  const threshold = opts?.threshold ?? 0.72
  if (p.length < minPrev) return false
  if (n.length < 40) return false
  // Exact / prefix echo
  if (n === p) return true
  if (p.startsWith(n) && n.length > p.length * 0.85) return true
  if (n.startsWith(p.slice(0, Math.min(200, p.length))) && n.length < p.length * 1.15) {
    return textSimilarity(p, n) >= threshold - 0.05
  }
  return textSimilarity(p, n) >= threshold
}
