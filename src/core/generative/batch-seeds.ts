/**
 * Hito 3.2 — batch of seeds for "pick the best" self-portraits.
 */
export function generateSeedBatch(count = 4, baseSeed?: number): number[] {
  const n = Math.max(1, Math.min(8, count))
  const base =
    typeof baseSeed === 'number' && Number.isFinite(baseSeed)
      ? Math.abs(Math.floor(baseSeed)) % 2_147_483_647
      : Math.floor(Math.random() * 2_147_483_647)
  const out: number[] = [base]
  let x = base || 1
  for (let i = 1; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    out.push(x % 2_147_483_647)
  }
  return out
}

/** FaceID research defaults (2026): weight ~0.82–0.85, CFG ~6–6.5 */
export function identityLockHints(isSelf: boolean): {
  ipAdapterWeight: number
  cfgScale: number
  note: string
} {
  if (isSelf) {
    return {
      ipAdapterWeight: 0.85,
      cfgScale: 6.2,
      note: 'Identidad: FaceID Plus v2 + avatar. Batch de seeds recomendado para elegir el mejor rostro.'
    }
  }
  return {
    ipAdapterWeight: 0,
    cfgScale: 7,
    note: 'Otra persona: sin DNA del personaje.'
  }
}
