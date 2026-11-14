import { describe, expect, it } from 'vitest'
import {
  shouldSendInitiative,
  detectInitiativeTone,
  initiativeMinutesForTone,
  buildInitiativeDecisionMessages,
  buildInitiativeLlmMessages,
  buildInitiativeCompositionMessages,
  parseInitiativeDecision,
  parseInitiativeSnooze
} from './initiative'

describe('initiative core', () => {
  it('allows send after long user silence', () => {
    const now = Date.now()
    const r = shouldSendInitiative({
      enabled: true,
      lastUserAt: now - 20 * 60_000,
      lastInitiativeAt: now - 30 * 60_000,
      minUserIdleMs: 45_000,
      waitMinOverride: 12,
      now,
      respectQuietHours: false
    })
    expect(r.ok).toBe(true)
  })

  it('blocks when user just wrote', () => {
    const now = Date.now()
    const r = shouldSendInitiative({
      enabled: true,
      lastUserAt: now - 10_000,
      minUserIdleMs: 45_000,
      waitMinOverride: 12,
      now,
      respectQuietHours: false
    })
    expect(r.ok).toBe(false)
  })

  it('parses decision and snooze', () => {
    expect(parseInitiativeDecision('SILENCIO').speak).toBe(false)
    expect(parseInitiativeDecision('MENSAJE: Hola, ¿sigues ahí?').speak).toBe(true)
    expect(parseInitiativeSnooze('estoy ocupado ahora')).toBeTruthy()
  })

  it('tone minutes increase when ignored', () => {
    const a = initiativeMinutesForTone('warm', { ignoredCount: 0 })
    const b = initiativeMinutesForTone('warm', { ignoredCount: 3 })
    expect(b).toBeGreaterThan(a)
  })

  it('detects warm tone', () => {
    expect(
      detectInitiativeTone({ personality: 'cariñosa y dulce con él' })
    ).toBe('warm')
  })

  it('evaluates recent context without requiring persisted goals', () => {
    const [system, user] = buildInitiativeDecisionMessages({
      hoursSinceLastUser: 3,
      recentLines: ['Usuario: me falta terminar el catálogo']
    })
    expect(system.content).toContain('No exijas que haya objetivos guardados')
    expect(system.content).toContain('El tiempo solo no basta para escribir')
    expect(system.content).toContain('no menciones la foto/avatar')
    expect(user.content).toContain('me falta terminar el catálogo')
  })

  it('allows natural proactive conversation without persisted tasks', () => {
    const [system, user] = buildInitiativeLlmMessages({
      characterName: 'Niamh',
      recentLines: ['Usuario: Hoy fue un día largo, pero terminé el diseño.'],
      hoursSinceAssistantDone: 4
    })
    expect(system.content).toContain('iniciar conversación con naturalidad')
    expect(system.content).toContain('la falta de una tarea pendiente tampoco te obliga a callar')
    expect(user.content).toContain('Hoy fue un día largo')
  })

  it('asks the LLM to write proposal copy and preserve consent without template text', () => {
    const [system, user] = buildInitiativeCompositionMessages({
      characterName: 'Niamh',
      tone: 'warm',
      draft: 'Proponer retomar los bocetos pendientes',
      recentLines: ['Usuario: me falta terminar los bocetos']
    })
    expect(system.content).toContain('mantén la elección explícita y sin presión')
    expect(user.content).toContain('Proponer retomar los bocetos pendientes')
    expect(user.content).not.toContain('Estaba pensando en ti')
  })
})
