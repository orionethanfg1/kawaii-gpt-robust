import { describe, it, expect } from 'vitest'
import { parseInitiativeSnooze } from './initiative'

describe('parseInitiativeSnooze', () => {
  it('does not steal shared silence / aftercare', () => {
    expect(
      parseInitiativeSnooze(
        'Sí, mi amor, un ratito más en silencio, a tu lado, me parece bien.'
      )
    ).toBeNull()
    expect(parseInitiativeSnooze('quedémonos un rato en silencio juntos')).toBeNull()
  })

  it('accepts explicit pause commands', () => {
    expect(parseInitiativeSnooze('no me hables 10 min')?.kind).toBe('silence')
    expect(parseInitiativeSnooze('dame 5 minutos')?.kind).toBe('wait')
    expect(parseInitiativeSnooze('estoy ocupado')?.kind).toBe('busy')
  })

  it('ignores bare silencio without command', () => {
    expect(parseInitiativeSnooze('el silencio de la noche')).toBeNull()
  })
})
