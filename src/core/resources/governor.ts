/**
 * Resource Governor — host-owned budget for local heavy layers + LLM size.
 * Pure logic (no Electron). Main/renderer feed a ResourceLedger snapshot.
 */

export type ResourceLayer = 'llm' | 'forge' | 'music' | 'vision'

export type ResourceLedger = {
  /** System RAM GB */
  ramGB: number
  /** Discrete GPU VRAM GB when known */
  vramGB: number | null
  hasDiscreteGpu: boolean
  /** Estimated GB currently reserved by known layers */
  usedEstimateGB: number
  forgeHot: boolean
  musicHot: boolean
  /** Heuristic: a large local LLM is the active chat model */
  largeLlmResident: boolean
  notes?: string[]
}

export type AdmitRequest = {
  layer: ResourceLayer
  /** Estimated additional GB this action needs */
  estimateGB: number
  /** Soft reserve so we never plan to 100% */
  headroomGB?: number
}

export type AdmitResult = {
  ok: boolean
  reason: string
  /** Suggested actions before retry */
  suggestRelease?: Array<'forge' | 'music'>
  budgetGB: number
  freeEstimateGB: number
}

/** Rough weight size by param tag in model id */
export function estimateModelWeightGB(modelId: string): number {
  const x = (modelId || '').toLowerCase()
  if (/(70b|72b|65b)/.test(x)) return 38
  if (/(32b|33b|34b)/.test(x)) return 20
  if (/(27b|28b|26b)/.test(x)) return 17
  if (/(22b|24b)/.test(x)) return 14
  if (/(14b|13b|12b)/.test(x)) return 9
  if (/(9b|8b|7b)/.test(x)) return 5
  if (/(4b|3b|3\.5b)/.test(x)) return 2.5
  if (/(1\.5b|1b|0\.5b)/.test(x)) return 1.2
  // Unknown GGUF / LM Studio id — assume mid-size
  if (/qwen3\.8|qwen3-8|qwen3\.5/.test(x)) return 17
  return 8
}

export function isLargeLocalModel(modelId: string, ramGB = 16): boolean {
  const g = estimateModelWeightGB(modelId)
  if (g >= 14) return true
  if (ramGB < 24 && g >= 9) return true
  return false
}

/** Default estimates when caller does not pass estimateGB */
export const LAYER_DEFAULT_ESTIMATE_GB: Record<ResourceLayer, number> = {
  llm: 8,
  forge: 6,
  music: 4,
  vision: 5
}

/**
 * Compute a conservative budget from hardware.
 * Prefers VRAM when discrete GPU known; else a fraction of system RAM.
 */
export function computeBudgetGB(ledger: Pick<ResourceLedger, 'ramGB' | 'vramGB' | 'hasDiscreteGpu'>): number {
  const ram = Math.max(4, ledger.ramGB || 8)
  if (ledger.hasDiscreteGpu && ledger.vramGB != null && ledger.vramGB > 0) {
    // Leave ~1.5GB for display/OS; never claim full card
    return Math.max(3, ledger.vramGB - 1.5)
  }
  // CPU / unified: leave half of RAM for OS + Electron
  return Math.max(3, ram * 0.45)
}

export function freeEstimateGB(ledger: ResourceLedger): number {
  const budget = computeBudgetGB(ledger)
  return Math.max(0, budget - (ledger.usedEstimateGB || 0))
}

export function canAdmit(ledger: ResourceLedger, req: AdmitRequest): AdmitResult {
  const budget = computeBudgetGB(ledger)
  const headroom = req.headroomGB ?? 0.8
  const need = Math.max(0.5, req.estimateGB || LAYER_DEFAULT_ESTIMATE_GB[req.layer])
  const free = freeEstimateGB(ledger)
  const usable = free - headroom

  if (need <= usable) {
    return {
      ok: true,
      reason: `Cabe ~${need.toFixed(1)} GB (libre ~${free.toFixed(1)} / presupuesto ~${budget.toFixed(1)})`,
      budgetGB: budget,
      freeEstimateGB: free
    }
  }

  const suggestRelease: Array<'forge' | 'music'> = []
  if (ledger.forgeHot && req.layer !== 'forge') suggestRelease.push('forge')
  if (ledger.musicHot && req.layer !== 'music') suggestRelease.push('music')

  // Large LLM + forge is the common tight case
  if (req.layer === 'forge' && ledger.largeLlmResident) {
    return {
      ok: false,
      reason:
        `VRAM/RAM justa para Forge (~${need.toFixed(1)} GB) con LLM grande residente. ` +
        `Libera capas pesadas o usa un modelo chat más pequeño.`,
      suggestRelease: suggestRelease.length ? suggestRelease : ['music'],
      budgetGB: budget,
      freeEstimateGB: free
    }
  }

  if (req.layer === 'music' && ledger.forgeHot) {
    return {
      ok: false,
      reason: `Música necesita ~${need.toFixed(1)} GB y Forge sigue caliente. El scheduler debería liberar imagen primero.`,
      suggestRelease: ['forge'],
      budgetGB: budget,
      freeEstimateGB: free
    }
  }

  return {
    ok: false,
    reason: `No cabe ~${need.toFixed(1)} GB (libre ~${free.toFixed(1)} / presupuesto ~${budget.toFixed(1)})`,
    suggestRelease: suggestRelease.length ? suggestRelease : undefined,
    budgetGB: budget,
    freeEstimateGB: free
  }
}

/**
 * Build a ledger from coarse runtime flags (renderer or main).
 */
export function buildLedger(input: {
  ramGB?: number
  vramGB?: number | null
  hasDiscreteGpu?: boolean | null
  forgeState?: string
  musicRunning?: boolean
  localModel?: string
  /** Extra GB already booked (optional) */
  extraUsedGB?: number
}): ResourceLedger {
  const ramGB = input.ramGB && input.ramGB > 0 ? input.ramGB : 16
  const forgeHot = /running|starting/i.test(input.forgeState || '')
  const musicHot = Boolean(input.musicRunning)
  const largeLlmResident = isLargeLocalModel(input.localModel || '', ramGB)

  let used = input.extraUsedGB || 0
  if (forgeHot) used += LAYER_DEFAULT_ESTIMATE_GB.forge
  if (musicHot) used += LAYER_DEFAULT_ESTIMATE_GB.music
  // Chat LLM is assumed partially resident when a large model is selected
  if (largeLlmResident) used += Math.min(12, estimateModelWeightGB(input.localModel || '') * 0.35)

  const notes: string[] = []
  if (forgeHot) notes.push('Forge caliente')
  if (musicHot) notes.push('ACE caliente')
  if (largeLlmResident) notes.push(`LLM grande: ${input.localModel}`)

  return {
    ramGB,
    vramGB: input.vramGB ?? null,
    hasDiscreteGpu: input.hasDiscreteGpu === true,
    usedEstimateGB: Number(used.toFixed(2)),
    forgeHot,
    musicHot,
    largeLlmResident,
    notes
  }
}

export function formatLedgerForPrompt(ledger: ResourceLedger): string {
  const budget = computeBudgetGB(ledger)
  const free = freeEstimateGB(ledger)
  return (
    `recursos: RAM~${ledger.ramGB}GB` +
    (ledger.vramGB != null ? ` VRAM~${ledger.vramGB}GB` : '') +
    ` presupuesto~${budget.toFixed(1)} usado~${ledger.usedEstimateGB} libre~${free.toFixed(1)}` +
    (ledger.notes?.length ? ` (${ledger.notes.join(', ')})` : '')
  )
}
