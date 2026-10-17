/**
 * B3 — rank batch images by optional face similarity (Python plugin).
 * Fail-soft: if deps missing or score fails, keep index 0.
 */
export type RankedBatch = {
  bestIndex: number
  scores: Array<number | null>
  note: string
}

/** Pure pick: highest score wins; null scores ignored unless all null → 0 */
export function pickBestIndex(scores: Array<number | null | undefined>): number {
  let bestI = 0
  let bestS = -Infinity
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i]
    if (s == null || Number.isNaN(s)) continue
    if (s > bestS) {
      bestS = s
      bestI = i
    }
  }
  if (bestS === -Infinity) return 0
  return bestI
}

export function formatBatchRankNote(
  bestIndex: number,
  scores: Array<number | null>,
  total: number
): string {
  const parts = scores.map((s, i) =>
    s == null ? `#${i + 1}:?` : `#${i + 1}:${s.toFixed(2)}`
  )
  return `batch×${total} · mejor #${bestIndex + 1}` + (parts.length ? ` (${parts.join(' ')})` : '')
}
