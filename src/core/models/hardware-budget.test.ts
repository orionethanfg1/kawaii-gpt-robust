import { describe, it, expect } from 'vitest'
import {
  hardwareModelBudget,
  recommendCompanionUncensored,
  catalogSpeedFit,
  LOCAL_MODEL_CATALOG
} from './recommendations'

const mid = { totalMemoryGB: 32, cpuCores: 8, architecture: 'x64', vramGB: 8 }

describe('C1 hardwareModelBudget', () => {
  it('comfort ~14B and ok ~27B on 32GB class', () => {
    const b = hardwareModelBudget(mid)
    expect(b.comfortParamsB).toBeLessThanOrEqual(14)
    expect(b.okParamsB).toBeGreaterThanOrEqual(14)
    expect(b.summary).toMatch(/recomendado/)
  })
})

describe('C2 companion prefers abliterated over RP', () => {
  it('lists abliterated before optional RP', () => {
    const list = recommendCompanionUncensored(mid, [], { includeOptionalRp: true })
    expect(list.length).toBeGreaterThan(0)
    const firstRp = list.findIndex(
      (m) => m.roles?.includes('optional-rp') || m.tags?.includes('optional-rp')
    )
    const firstAblit = list.findIndex((m) => m.tags?.includes('abliterated'))
    if (firstAblit >= 0 && firstRp >= 0) {
      expect(firstAblit).toBeLessThan(firstRp)
    }
  })

  it('hides RP by default', () => {
    const list = recommendCompanionUncensored(mid, [])
    expect(list.every((m) => !m.roles?.includes('optional-rp'))).toBe(true)
  })
})
