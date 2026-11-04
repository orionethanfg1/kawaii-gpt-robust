import { describe, it, expect } from 'vitest'
import {
  shouldProposeIntimacy,
  effectiveRelationshipStage,
  applyIntimacyResolution,
  buildIntimacyStagePromptRules,
  hasIntimacySoftNo,
  clearStaleIntimacyBoundary,
  stampIntimacyBoundary,
  userReopenedIntimacy
} from './intimacy-stage'

describe('intimacy-stage R1/R2', () => {
  it('clamps intimate_adult without opt-in', () => {
    expect(
      effectiveRelationshipStage({ stage: 'intimate_adult' }, false)
    ).toBe('intimate')
    expect(
      effectiveRelationshipStage({ stage: 'intimate_adult' }, true)
    ).toBe('intimate_adult')
  })

  it('blocks adult proposal without opt-in', () => {
    const g = shouldProposeIntimacy({
      stage: 'intimate',
      adultOptIn: false,
      preferAdult: true,
      conversationInitiativeEnabled: true
    })
    expect(g.ok).toBe(false)
    expect(g.reason).toBe('adult_opt_in_off')
  })

  it('allows emotional proposal at familiar', () => {
    const g = shouldProposeIntimacy({
      stage: 'familiar',
      adultOptIn: false,
      conversationInitiativeEnabled: true
    })
    expect(g.ok).toBe(true)
    expect(g.kind).toBe('emotional')
  })

  it('accept adult raises stage', () => {
    const r = applyIntimacyResolution({
      relationship: { stage: 'intimate', turnsTogether: 20 },
      action: 'accept',
      kind: 'adult',
      adultOptIn: true,
      facts: []
    })
    expect(r.relationship.stage).toBe('intimate_adult')
    expect(r.facts.some((f) => f.includes('INTIMACY_OPEN'))).toBe(true)
  })

  it('decline sets soft_no', () => {
    const r = applyIntimacyResolution({
      relationship: { stage: 'familiar' },
      action: 'decline',
      kind: 'emotional',
      facts: []
    })
    expect(hasIntimacySoftNo(r.facts)).toBe(true)
  })

  it('prompt rules mention consent', () => {
    const p = buildIntimacyStagePromptRules({
      stage: 'intimate',
      adultOptIn: false
    })
    expect(p.toLowerCase()).toMatch(/consent|respet/)
  })
})

describe('R4 boundary TTL', () => {
  it('expires soft_no after TTL', () => {
    const now = 1_000_000_000_000
    const fact = stampIntimacyBoundary('soft_no', now - 8 * 24 * 60 * 60 * 1000)
    const cleaned = clearStaleIntimacyBoundary([fact, 'other'], { now })
    expect(cleaned).toEqual(['other'])
    expect(hasIntimacySoftNo([fact], { now })).toBe(false)
  })

  it('userReopenedIntimacy detects phrases', () => {
    expect(userReopenedIntimacy('ok intimidad otra vez')).toBe(true)
    expect(userReopenedIntimacy('hola qué tal')).toBe(false)
  })
})

it('skips formal propose when intimacy already open', async () => {
  const { shouldProposeIntimacy } = await import('./intimacy-stage')
  const r = shouldProposeIntimacy({
    conversationInitiativeEnabled: true,
    adultOptIn: true,
    stage: 'intimate_adult',
    intimacyOpen: true,
    preferAdult: true
  })
  expect(r.ok).toBe(false)
  expect(r.reason).toBe('already_open')
})
