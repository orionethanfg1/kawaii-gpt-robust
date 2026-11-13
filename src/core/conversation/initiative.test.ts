import { describe, expect, it } from 'vitest'
import {
  shouldSendInitiative,
  detectInitiativeTone,
  initiativeMinutesForTone,
  hasInitiativeFollowUpSignal,
  buildInitiativeDecisionMessages,
  parseInitiativeDecision,
  parseInitiativeSnooze,
  isQuietHours
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

  it('requires a concrete follow-up signal rather than elapsed time alone', () => {
    expect(hasInitiativeFollowUpSignal({ recentUserLines: ['Usuario: ¿Qué hora es?'] })).toBe(false)
    expect(hasInitiativeFollowUpSignal({ goals: ['Completar el catálogo de Michoacán'] })).toBe(true)
    expect(
      hasInitiativeFollowUpSignal({
        recentUserLines: ['Estoy trabajando en la colección y me falta terminar el catálogo']
      })
    ).toBe(true)
  })

  it('provides goals and rejects time-only generic messages in the decision prompt', () => {
    const [system] = buildInitiativeDecisionMessages({
      activeGoals: ['Completar los bocetos pendientes'],
      hoursSinceLastUser: 3
    })
    expect(system.content).toContain('Completar los bocetos pendientes')
    expect(system.content).toContain('El tiempo transcurrido por sí solo NO justifica escribir')
    expect(system.content).toContain('no menciones la foto/avatar')
  })
})
