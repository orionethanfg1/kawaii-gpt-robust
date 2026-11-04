import { describe, it, expect } from 'vitest'
import {
  computeStage,
  shouldProposeNickname,
  acceptNickname,
  rejectNickname,
  nicknameCandidates,
  bumpTurns,
  nicknamePoolFromPersonality
} from './relationship-confidence'
import { emptyUserMemory } from './dual-memory'

describe('M4 relationship-confidence', () => {
  it('stages progress with turns and memory', () => {
    expect(computeStage({ turnsTogether: 0 })).toBe('stranger')
    expect(
      computeStage({
        turnsTogether: 20,
        userMemory: { preferredName: 'Nahum', likes: ['a', 'b', 'c'] }
      })
    ).not.toBe('stranger')
  })

  it('does not propose during onboarding or when sparse', () => {
    expect(
      shouldProposeNickname({
        userMemory: emptyUserMemory(),
        relationship: { turnsTogether: 10, stage: 'familiar' }
      })
    ).toBe(false)
  })

  it('accept and reject update lists', () => {
    const a = acceptNickname({ facts: [] }, { turnsTogether: 5 }, 'amor')
    expect(a.userMemory.nicknames).toContain('amor')
    expect(a.relationship.acceptedNicknames).toContain('amor')
    const r = rejectNickname(a.userMemory, a.relationship, 'cielo')
    expect(r.relationship.rejectedNicknames).toContain('cielo')
    expect(nicknameCandidates(r.relationship, r.userMemory)).not.toContain('amor')
  })

  it('bumpTurns increments', () => {
    const b = bumpTurns({ turnsTogether: 2 }, 1)
    expect(b.turnsTogether).toBe(3)
  })

  it('personality expands nickname pool', () => {
    const warm = nicknamePoolFromPersonality('cariñosa pareja leal')
    expect(warm.some((x) => /amor|corazón|vida/i.test(x))).toBe(true)
    const cands = nicknameCandidates(
      { rejectedNicknames: ['amor'] },
      { preferredName: 'N' },
      'cariñosa'
    )
    expect(cands.map((c) => c.toLowerCase())).not.toContain('amor')
  })
})
