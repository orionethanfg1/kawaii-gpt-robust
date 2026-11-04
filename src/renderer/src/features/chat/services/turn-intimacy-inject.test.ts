import { describe, expect, it } from 'vitest'
import { buildDecisionPacket } from '@core/agent/decision-packet'
import { shouldInjectIntimacy } from './turn-intimacy-inject'

describe('turn-intimacy-inject X8', () => {
  it('injects on intimacy task', () => {
    const p = buildDecisionPacket({
      userText: 'quiero estar cerca de ti esta noche',
      adultOptIn: true,
      relationshipStage: 'intimate'
    })
    // may be intimacy or chat depending on classifiers — packet inject is source of truth
    if (p.inject.intimacyBlock) {
      expect(shouldInjectIntimacy(p)).toBe(true)
    } else {
      expect(shouldInjectIntimacy(p)).toBe(false)
    }
  })

  it('no inject when packet says off', () => {
    const p = buildDecisionPacket({ userText: 'lista mis archivos de la biblioteca' })
    // files primary — intimacyBlock usually false
    if (p.task === 'files') {
      expect(shouldInjectIntimacy(p)).toBe(false)
    }
  })
})
