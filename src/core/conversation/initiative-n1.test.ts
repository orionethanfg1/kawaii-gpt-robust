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

  it('requires an explicit, non-empty MENSAJE decision', () => {
    expect(parseInitiativeDecision('MENSAJE').speak).toBe(false)
    expect(parseInitiativeDecision('MENSAJE\nextra').speak).toBe(false)
    expect(parseInitiativeDecision('MENSAJE: Retomamos los bocetos pendientes?').speak).toBe(true)
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
    expect(msgs[0].content).toMatch(/sin respuesta/i)
    expect(msgs[0].content).toMatch(/SILENCIO|MENSAJE/)
  })
})
