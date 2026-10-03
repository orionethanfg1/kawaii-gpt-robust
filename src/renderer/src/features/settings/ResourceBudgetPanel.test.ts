/**
 * Pure logic smoke for budget math used by the panel (no React).
 */
import { describe, it, expect } from 'vitest'
import {
  buildLedger,
  canAdmit,
  computeBudgetGB,
  freeEstimateGB,
  LAYER_DEFAULT_ESTIMATE_GB
} from '@core/resources'

describe('ResourceBudgetPanel math', () => {
  it('shows tight forge when large LLM + forge both hot', () => {
    const ledger = buildLedger({
      ramGB: 16,
      vramGB: 8,
      hasDiscreteGpu: true,
      forgeState: 'running',
      musicRunning: false,
      localModel: 'qwen/qwen3.8-27b'
    })
    expect(ledger.largeLlmResident).toBe(true)
    expect(ledger.forgeHot).toBe(true)
    const budget = computeBudgetGB(ledger)
    const free = freeEstimateGB(ledger)
    expect(budget).toBeGreaterThan(0)
    expect(free).toBeLessThan(budget)

    const admit = canAdmit(ledger, {
      layer: 'music',
      estimateGB: LAYER_DEFAULT_ESTIMATE_GB.music
    })
    // May or may not fit; at least returns structured result
    expect(admit.budgetGB).toBe(budget)
    expect(typeof admit.ok).toBe('boolean')
  })

  it('admits forge on free mid-range card without large LLM', () => {
    const ledger = buildLedger({
      ramGB: 32,
      vramGB: 12,
      hasDiscreteGpu: true,
      forgeState: 'stopped',
      musicRunning: false,
      localModel: 'qwen2.5:7b'
    })
    const admit = canAdmit(ledger, {
      layer: 'forge',
      estimateGB: LAYER_DEFAULT_ESTIMATE_GB.forge
    })
    expect(admit.ok).toBe(true)
  })
})
