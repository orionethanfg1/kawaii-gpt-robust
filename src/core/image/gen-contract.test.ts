import { describe, it, expect } from 'vitest'
import {
  resolveQualityParams,
  degradeQualityProfile,
  clampLongEdge,
  isRetryableImageMessage,
  classifyGenFailureCode
} from './gen-contract'

describe('I3 resolveQualityParams', () => {
  it('forces batch=1 with FaceID path', () => {
    const q = resolveQualityParams({
      profile: 'quality',
      batchSize: 4,
      usesFaceIdOrControlNet: true
    })
    expect(q.batchSize).toBe(1)
    expect(q.profile).toBe('quality')
  })

  it('fast caps long edge at 1024', () => {
    const q = resolveQualityParams({
      profile: 'fast',
      width: 2048,
      height: 2048
    })
    expect(Math.max(q.width, q.height)).toBeLessThanOrEqual(1024)
  })

  it('degrade quality → balanced → fast', () => {
    expect(degradeQualityProfile('quality')).toBe('balanced')
    expect(degradeQualityProfile('balanced')).toBe('fast')
    expect(degradeQualityProfile('fast')).toBe('fast')
  })
})

describe('I1 failure classify', () => {
  it('marks timeout retryable', () => {
    expect(isRetryableImageMessage('Timeout waiting for API')).toBe(true)
    expect(classifyGenFailureCode('ECONNREFUSED 127.0.0.1:7860')).toBe(
      'IMAGE_BACKEND_DOWN'
    )
  })

  it('clampLongEdge preserves aspect roughly', () => {
    const s = clampLongEdge(1920, 1080, 1024)
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(1024)
  })
})
