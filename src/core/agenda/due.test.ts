import { describe, it, expect } from 'vitest'
import {
  itemFireAt,
  isItemDue,
  collectDueItems,
  afterDelivery,
  inQuietHours,
  buildDueMessage
} from './due'
import type { AgendaItem } from './types'

function item(partial: Partial<AgendaItem> & Pick<AgendaItem, 'id' | 'type' | 'title' | 'when'>): AgendaItem {
  return {
    sensitivity: 'normal',
    status: 'pending',
    notify: { insist: 'once', maxNudges: 1, nudgesSent: 0 },
    createdAt: 0,
    updatedAt: 0,
    ...partial
  }
}

describe('A2 due engine', () => {
  it('short relative ignores lead so it is not immediately due', () => {
    const now = Date.now()
    const it = item({ id: 'short', type: 'reminder', title: 'agua', when: { kind: 'relative', at: now + 60000, relativeMs: 60000 }, notify: { insist: 'once', leadMinutes: 15, maxNudges: 1, nudgesSent: 0 }, status: 'pending' })
    expect(isItemDue(it, now)).toBe(false)
    expect(isItemDue(it, now + 61000)).toBe(true)
  })

  it('fires exact reminder with lead', () => {
    const at = 1_000_000_000_000
    const it = item({
      id: '1',
      type: 'reminder',
      title: 'luz',
      when: { kind: 'exact', at },
      notify: { insist: 'once', leadMinutes: 15, maxNudges: 1 }
    })
    expect(itemFireAt(it)).toBe(at - 15 * 60_000)
  })

  it('is due after fire time', () => {
    const at = Date.now() - 60_000
    const it = item({
      id: '2',
      type: 'talk',
      title: 'plática',
      when: { kind: 'relative', at, relativeMs: 3600000 }
    })
    expect(isItemDue(it, Date.now())).toBe(true)
  })

  it('quiet hours block delivery', () => {
    // 3 AM
    const now = new Date('2026-10-10T03:00:00').getTime()
    expect(inQuietHours(now, { defaultLeadMinutes: 15, insistStyle: 'once', quietHours: { startH: 8, endH: 20 } })).toBe(true)
    const at = now - 1000
    const it = item({
      id: '3',
      type: 'reminder',
      title: 'x',
      when: { kind: 'exact', at },
      status: 'pending'
    })
    expect(collectDueItems([it], now, { defaultLeadMinutes: 15, insistStyle: 'once', quietHours: { startH: 8, endH: 20 } })).toHaveLength(0)
  })

  it('afterDelivery marks done for once', () => {
    const it = item({
      id: '4',
      type: 'reminder',
      title: 'x',
      when: { kind: 'exact', at: Date.now() },
      notify: { insist: 'once', maxNudges: 1, nudgesSent: 0 }
    })
    const u = afterDelivery(it)
    expect(u.status).toBe('done')
    expect(u.notify.nudgesSent).toBe(1)
  })

  it('buildDueMessage differs by type', () => {
    expect(buildDueMessage(item({ id: '5', type: 'talk', title: 'tema', when: { kind: 'window', at: 1 } })).title).toMatch(/plática/i)
    expect(buildDueMessage(item({ id: '6', type: 'reminder', title: 'luz', when: { kind: 'exact', at: 1 } })).title).toMatch(/Recordatorio/)
  })
})
