import { describe, expect, it } from 'vitest'
import { assertIdentityPromptConsistency } from './assert-identity-prompt'

describe('assertIdentityPromptConsistency', () => {
  it('removes rival hair color vs DNA brown straight', () => {
    const r = assertIdentityPromptConsistency(
      'portrait, (black hair:1.45), (curly hair:1.45), upper body',
      'cabello castaño oscuro liso, ojos verdes'
    )
    expect(r.positive.toLowerCase()).toMatch(/brown hair|casta/)
    expect(r.positive.toLowerCase()).not.toMatch(/black hair/)
    expect(r.positive.toLowerCase()).not.toMatch(/curly hair/)
    expect(r.positive.toLowerCase()).toMatch(/straight hair/)
  })

  it('keeps consistent DNA tags', () => {
    const r = assertIdentityPromptConsistency(
      '(brown hair:1.45), (straight hair:1.45), green eyes',
      'cabello castaño liso, ojos verdes'
    )
    expect(r.ok).toBe(true)
    expect(r.positive.toLowerCase()).toMatch(/brown hair/)
  })
})
