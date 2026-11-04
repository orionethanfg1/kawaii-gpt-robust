import { describe, it, expect } from 'vitest'
import {
  shouldRunOnboarding,
  inferStepFromMemory,
  applyOnboardingChip,
  advanceOnboardingAfterExtract,
  buildOnboardingSystemPrompt
} from './memory-onboarding'
import { emptyUserMemory } from './dual-memory'

describe('M2 memory-onboarding', () => {
  it('runs when sparse and not dismissed', () => {
    expect(
      shouldRunOnboarding({ userMemory: emptyUserMemory(), onboarding: { active: true, step: 'name' } })
    ).toBe(true)
    expect(
      shouldRunOnboarding({ userMemory: emptyUserMemory(), onboarding: { dismissed: true } })
    ).toBe(false)
    expect(
      shouldRunOnboarding({ userMemory: emptyUserMemory(), memoryGatePending: true })
    ).toBe(false)
  })

  it('applies like chip and advances', () => {
    const { memory, step } = applyOnboardingChip(emptyUserMemory(), 'like', 'café')
    expect(memory.likes?.some((x) => /café/i.test(x))).toBe(true)
    expect(step).toBe('dislike')
  })

  it('advances after extract name', () => {
    expect(advanceOnboardingAfterExtract('name', { preferredName: 'Nahum' })).toBe('nickname')
  })

  it('builds non-empty prompt for name step', () => {
    expect(buildOnboardingSystemPrompt('name').length).toBeGreaterThan(20)
    expect(buildOnboardingSystemPrompt('done')).toBe('')
  })

  it('infers done when rich', () => {
    expect(
      inferStepFromMemory({ preferredName: 'A', likes: ['x'], dislikes: ['y'] })
    ).toBe('done')
  })
})
