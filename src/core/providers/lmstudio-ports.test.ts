
import { describe, it, expect } from 'vitest'
import { LM_STUDIO_CANDIDATE_PORTS, clearLmStudioPortCache } from './lmstudio-ports'

describe('lmstudio-ports', () => {
  it('includes default 1234 and alternates', () => {
    expect(LM_STUDIO_CANDIDATE_PORTS).toContain(1234)
    expect(LM_STUDIO_CANDIDATE_PORTS.length).toBeGreaterThan(3)
  })
  it('clear cache is safe', () => {
    clearLmStudioPortCache()
    expect(true).toBe(true)
  })
})
