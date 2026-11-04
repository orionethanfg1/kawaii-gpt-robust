import { describe, it, expect } from 'vitest'
import {
  recommendCompanionUncensored,
  isUncensoredCompanionId
} from './recommendations'

describe('R3 companion uncensored catalog', () => {
  it('returns companion-tagged models within RAM', () => {
    const list = recommendCompanionUncensored(
      { totalMemoryGB: 32, cpuCores: 8, architecture: 'x64' },
      ['dolphin-llama3']
    )
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((m) => m.risk === 'uncensored')).toBe(true)
  })

  it('detects uncensored ids', () => {
    expect(isUncensoredCompanionId('dolphin-mistral')).toBe(true)
    expect(isUncensoredCompanionId('qwen2.5:14b')).toBe(false)
  })
})
