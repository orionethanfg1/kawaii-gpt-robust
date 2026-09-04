
import { describe, it, expect } from 'vitest'
import { recommendImageStack, resolveImageRoute } from './recommendations'

describe('recommendImageStack', () => {
  it('prefers cloud without GPU', () => {
    const r = recommendImageStack({ totalMemoryGB: 8 })
    expect(r.preferLocal).toBe(false)
    expect(r.localTier).toBe('none')
  })
  it('suggests sd15 for 6GB', () => {
    const r = recommendImageStack({
      totalMemoryGB: 16,
      vramGB: 6,
      hasDiscreteGpu: true
    })
    expect(r.localTier).toBe('sd15')
  })
  it('suggests sdxl for 12GB', () => {
    const r = recommendImageStack({
      totalMemoryGB: 32,
      vramGB: 12,
      hasDiscreteGpu: true
    })
    expect(r.localTier).toBe('sdxl-comfortable')
  })
})

describe('resolveImageRoute', () => {
  it('smart falls back to pollinations', () => {
    expect(
      resolveImageRoute('smart', false, { totalMemoryGB: 16, vramGB: 12, hasDiscreteGpu: true })
    ).toBe('pollinations')
  })
  it('smart uses a1111 when healthy and VRAM ok', () => {
    expect(
      resolveImageRoute('smart', true, { totalMemoryGB: 16, vramGB: 12, hasDiscreteGpu: true })
    ).toBe('a1111')
  })
})
