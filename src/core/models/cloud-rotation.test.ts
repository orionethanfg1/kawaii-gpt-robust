import { describe, it, expect } from 'vitest'
import {
  orderCloudEndpoints,
  shouldRotateCloud,
  defaultCloudSlots
} from './cloud-rotation'

describe('orderCloudEndpoints', () => {
  it('orders by key presence and priority', () => {
    const slots = defaultCloudSlots().map((s) => ({
      ...s,
      enabled: true
    }))
    const ordered = orderCloudEndpoints(
      slots,
      { groq: 'g'.repeat(20), openrouter: 'o'.repeat(20) },
      'https://openrouter.ai/api/v1'
    )
    expect(ordered.length).toBe(2)
    expect(ordered[0].id).toBe('openrouter')
    expect(ordered[1].id).toBe('groq')
  })

  it('skips disabled or keyless', () => {
    const slots = defaultCloudSlots()
    const ordered = orderCloudEndpoints(slots, { groq: 'short' }, undefined)
    expect(ordered.every((e) => e.apiKey.length >= 8)).toBe(true)
  })
})

describe('shouldRotateCloud', () => {
  it('rotates on rate limit and quota', () => {
    expect(shouldRotateCloud('PROVIDER_RATE_LIMIT')).toBe(true)
    expect(shouldRotateCloud('PROVIDER_QUOTA')).toBe(true)
    expect(shouldRotateCloud('PROVIDER_AUTH')).toBe(false)
  })
})
