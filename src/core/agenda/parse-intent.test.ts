import { describe, it, expect } from 'vitest'
import { parseAgendaIntent } from './parse-intent'

describe('A1 parseAgendaIntent', () => {
  const now = new Date('2026-10-10T15:00:00').getTime()

  it('parses reminder with hour', () => {
    const r = parseAgendaIntent('Recuérdame a las 18:00 pagar la luz', { now })
    expect(r.ok).toBe(true)
    expect(r.type).toBe('reminder')
    expect(r.item?.when.kind).toBe('exact')
    expect(r.needsClarify).toBeFalsy()
  })

  it('parses talk for mañana as window', () => {
    const r = parseAgendaIntent('¿Podemos hablar de eso mañana?', { now })
    expect(r.ok).toBe(true)
    expect(r.type).toBe('talk')
    expect(r.item?.when.kind).toBe('window')
  })

  it('parses en una hora', () => {
    const r = parseAgendaIntent('Lo hablamos en una hora', { now })
    expect(r.ok).toBe(true)
    expect(r.item?.when.kind).toBe('relative')
  })

  it('reminder mañana without hour needs clarify', () => {
    const r = parseAgendaIntent('Recuérdame mañana lo de la cita', { now })
    expect(r.ok).toBe(true)
    expect(r.needsClarify).toBe(true)
  })

  it('no intent on normal chat', () => {
    const r = parseAgendaIntent('Me gusta el café de olla', { now })
    expect(r.ok).toBe(false)
  })
})
