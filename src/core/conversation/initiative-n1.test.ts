import { describe, it, expect } from 'vitest'
import {
  parseInitiativeDecision,
  buildInitiativeDecisionMessages
} from './initiative'

describe('N1 initiative decision', () => {
  it('parses SILENCIO', () => {
    expect(parseInitiativeDecision('SILENCIO').speak).toBe(false)
    expect(parseInitiativeDecision('silencio\n').speak).toBe(false)
  })

  it('parses MENSAJE', () => {
    expect(parseInitiativeDecision('MENSAJE').speak).toBe(true)
    expect(parseInitiativeDecision('MENSAJE\nextra').speak).toBe(true)
  })

  it('ambiguous prose defaults to silence', () => {
    expect(parseInitiativeDecision('Creo que debería escribirle algo bonito').speak).toBe(
      false
    )
  })

  it('decision messages include personality and unanswered streak', () => {
    const msgs = buildInitiativeDecisionMessages({
      characterName: 'Niamh',
      personality: 'cálida',
      tone: 'warm',
      unansweredInitiatives: 2,
      recentLines: ['Usuario: hola']
    })
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].content).toMatch(/sin respuesta/i)
    expect(msgs[1].content).toMatch(/SILENCIO|MENSAJE/)
  })
})
