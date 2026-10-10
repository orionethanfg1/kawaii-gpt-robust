import { describe, it, expect } from 'vitest'
import {
  buildLedger,
  canAdmit,
  estimateModelWeightGB,
  isLargeLocalModel,
  computeBudgetGB
} from './governor'

describe('ResourceGovernor', () => {
  it('estimates Qwen3.8 27B around 17GB', () => {
    expect(estimateModelWeightGB('qwen/qwen3.8-27b')).toBeGreaterThanOrEqual(14)
    expect(isLargeLocalModel('qwen/qwen3.8-27b', 32)).toBe(true)
  })

  it('admits forge when card is free', () => {
    const ledger = buildLedger({
      ramGB: 32,
      vramGB: 12,
      hasDiscreteGpu: true,
      forgeState: 'stopped',
      musicRunning: false,
      localModel: 'qwen2.5:7b'
    })
    const r = canAdmit(ledger, { layer: 'forge', estimateGB: 6 })
    expect(r.ok).toBe(true)
    expect(computeBudgetGB(ledger)).toBeGreaterThan(8)
  })

  it('suggests release when forge + large llm tight', () => {
    const ledger = buildLedger({
      ramGB: 16,
      vramGB: 8,
      hasDiscreteGpu: true,
      forgeState: 'running',
      musicRunning: false,
      localModel: 'qwen/qwen3.8-27b'
    })
    const r = canAdmit(ledger, { layer: 'music', estimateGB: 4 })
    expect(r.ok).toBe(false)
    expect(r.suggestRelease).toContain('forge')
  })
})
