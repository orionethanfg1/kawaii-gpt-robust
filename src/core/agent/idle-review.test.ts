import { describe, expect, it } from 'vitest'
import { planIdleReview } from './idle-review'

describe('idle-review X9', () => {
  it('returns none when streaming', () => {
    const p = planIdleReview({
      idleMs: 60_000,
      streamBusy: true,
      chatBusy: false,
      sinceLastReviewMs: 120_000
    })
    expect(p.kind).toBe('none')
  })

  it('returns none when not idle enough', () => {
    const p = planIdleReview({
      idleMs: 5_000,
      streamBusy: false,
      chatBusy: false,
      sinceLastReviewMs: 120_000
    })
    expect(p.kind).toBe('none')
  })

  it('plans harvest first then alternates', () => {
    const a = planIdleReview({
      idleMs: 60_000,
      streamBusy: false,
      chatBusy: false,
      sinceLastReviewMs: 120_000
    })
    expect(a.kind).toBe('memory_harvest')
    const b = planIdleReview({
      idleMs: 60_000,
      streamBusy: false,
      chatBusy: false,
      sinceLastReviewMs: 120_000,
      lastKind: 'memory_harvest'
    })
    expect(b.kind).toBe('memory_consistency')
  })
})
