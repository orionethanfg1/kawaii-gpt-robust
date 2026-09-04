
import { describe, it, expect } from 'vitest'
import { buildPollinationsUrl } from './pollinations'
import { classifyImageError } from './errors'

describe('buildPollinationsUrl', () => {
  it('encodes prompt and sets size', () => {
    const url = buildPollinationsUrl('gato kawaii', {
      width: 512,
      height: 768,
      seed: 42
    })
    expect(url).toContain('image.pollinations.ai/prompt/')
    expect(url).toContain(encodeURIComponent('gato kawaii'))
    expect(url).toContain('width=512')
    expect(url).toContain('height=768')
    expect(url).toContain('seed=42')
    expect(url).toContain('nologo=true')
  })
})

describe('classifyImageError', () => {
  it('detects rate limit', () => {
    expect(classifyImageError('HTTP 429 rate limit').code).toBe('IMAGE_RATE_LIMIT')
  })
  it('detects cancel', () => {
    expect(classifyImageError('The operation was aborted').code).toBe('IMAGE_CANCELLED')
  })
})
