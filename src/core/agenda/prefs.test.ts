import { describe, it, expect } from 'vitest'
import {
  parseLeadMinutesFromText,
  parseInsistFromText,
  resolveLeadMinutes,
  resolveInsist,
  learnFromFeedback,
  maxNudgesForInsist
} from './prefs'
import { afterDelivery, isItemDue } from './due'
import type { AgendaItem } from './types'

describe('A3 prefs', () => {
  it('parses lead from text', () => {
    expect(parseLeadMinutesFromText('recuérdame con 30 minutos de anticipación')).toBe(30)
    expect(parseLeadMinutesFromText('avísame una hora antes')).toBe(60)
    expect(parseLeadMinutesFromText('sin anticipación')).toBe(0)
  })

  it('parses insist', () => {
    expect(parseInsistFromText('no insistas si no contesto')).toBe('off')
    expect(parseInsistFromText('si no contesto insiste un poco')).toBe('gentle')
  })

  it('resolveLead uses learned preferLead', () => {
    expect(
      resolveLeadMinutes('recuérdame a las 9', {
        defaultLeadMinutes: 15,
        insistStyle: 'once',
        learned: { preferLead: 30 }
      })
    ).toBe(30)
  })

  it('learnFromFeedback raises snoozeRate', () => {
    const p = learnFromFeedback({ defaultLeadMinutes: 15, insistStyle: 'gentle' }, 'snooze')
    expect((p.learned?.snoozeRate || 0) > 0).toBe(true)
  })

  it('gentle allows second nudge after nextNudgeAt', () => {
    const now = Date.now()
    const item: AgendaItem = {
      id: 'g1',
      type: 'reminder',
      title: 'luz',
      sensitivity: 'normal',
      when: { kind: 'exact', at: now - 120_000 },
      status: 'due',
      notify: {
        insist: 'gentle',
        maxNudges: 3,
        nudgesSent: 1,
        nextNudgeAt: now - 1000,
        leadMinutes: 15
      },
      createdAt: now,
      updatedAt: now
    }
    expect(isItemDue(item, now)).toBe(true)
    const u = afterDelivery(item, now)
    expect(u.notify.nudgesSent).toBe(2)
    expect(u.status).toBe('due')
  })

  it('maxNudges for once is 1', () => {
    expect(maxNudgesForInsist('once')).toBe(1)
    expect(maxNudgesForInsist('gentle')).toBe(3)
  })
})
