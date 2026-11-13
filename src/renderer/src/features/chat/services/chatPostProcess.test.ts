import { describe, expect, it } from 'vitest'
import { stripWhileStreaming } from './chatPostProcess'

describe('stripWhileStreaming', () => {
  it('keeps degeneration detection enabled by default', () => {
    expect(stripWhileStreaming('x'.repeat(60))).toBe('')
  })

  it('allows the stream painter to skip checks already throttled upstream', () => {
    const text = 'x'.repeat(60)
    expect(stripWhileStreaming(text, { skipDegenerationCheck: true })).toBe(text)
  })
})
