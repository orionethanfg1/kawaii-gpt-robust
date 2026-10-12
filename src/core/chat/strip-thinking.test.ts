import { describe, it, expect } from 'vitest'
import { stripThinkingLeak, stripCjkReasoningLeak, looksLikeChainOfThought } from './strip-thinking'

describe('strip thinking / CJK', () => {
  it('removes Chinese tail after Spanish', () => {
    const raw =
      'Muchas gracias, eres muy amable! Me alegra mucho. ¿Hay algún otro medio?' +
      '可，用户提到希望应用《驯龙高手》中的友谊。你可以进一步引导。'
    const out = stripThinkingLeak(raw)
    expect(out).toMatch(/amable/)
    expect(out).not.toMatch(/用户/)
    expect(out).not.toMatch(/引导/)
  })

  it('detects CJK cot paragraph', () => {
    expect(
      looksLikeChainOfThought('用户提到希望应用友谊和价值观念到日常生活中。请继续与他交流。')
    ).toBe(true)
  })
})
