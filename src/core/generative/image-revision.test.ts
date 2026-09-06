import { describe, it, expect } from 'vitest'
import {
  looksLikeImageRevision,
  shouldForceImageRevision,
  feedbackToPromptDelta,
  mergeImageRevision
} from './image-revision'

describe('image revision intelligence', () => {
  it('detects hazla más joven when prior image exists', () => {
    expect(looksLikeImageRevision('hazla más joven', true)).toBe(true)
    expect(shouldForceImageRevision('hazla más joven', true)).toBe(true)
    expect(looksLikeImageRevision('hazla más joven', false)).toBe(false)
  })
  it('forces short mas/menos tweaks', () => {
    expect(shouldForceImageRevision('más rubia', true)).toBe(true)
  })
  it('does not treat analysis as revision', () => {
    expect(looksLikeImageRevision('analiza la foto', true)).toBe(false)
  })
  it('maps age tweak to prompt delta', () => {
    const d = feedbackToPromptDelta('hazla más joven')
    expect(d.toLowerCase()).toMatch(/young/)
  })
  it('merges without exploding prompt', () => {
    const m = mergeImageRevision(
      { prompt: 'photo of a woman with blue eyes. Changes requested: smile' },
      'hazla más joven'
    )
    expect(m.prompt).toMatch(/young/)
    expect(m.prompt.match(/Changes requested/gi)?.length || 0).toBeLessThanOrEqual(1)
  })
})
