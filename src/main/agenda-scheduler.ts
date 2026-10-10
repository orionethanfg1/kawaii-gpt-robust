/**
 * A2 — Main-process agenda tick: snapshot from renderer, due check, OS notify once.
 */

import { BrowserWindow, Notification, app } from 'electron'
import type { AgendaItem, AgendaPrefs } from '../core/agenda/types'
import { collectDueItems, afterDelivery, buildDueMessage } from '../core/agenda/due'

let items: AgendaItem[] = []
let prefs: AgendaPrefs | null = null
let timer: ReturnType<typeof setInterval> | null = null
const delivered = new Set<string>()

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      if (!w.isDestroyed()) w.webContents.send(channel, payload)
    } catch {
      /* ignore */
    }
  }
}

function focusMainWindow(): void {
  try {
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
    const w = wins.find((x) => x.isVisible()) || wins[0]
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  } catch {
    /* ignore */
  }
}

function osNotify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: title.slice(0, 120), body: body.slice(0, 240) })
    n.on('click', () => focusMainWindow())
    n.show()
  } catch (e) {
    console.warn('[agenda] notify', e)
  }
}

function tick(): void {
  const now = Date.now()
  const due = collectDueItems(items, now, prefs, delivered)
  if (!due.length) return
  const nextItems = [...items]
  for (const d of due) {
    const msg = buildDueMessage(d.item)
    osNotify(
      d.item.type === 'talk' ? 'KawaiiGPT · plática' : 'KawaiiGPT · recordatorio',
      msg.body
    )
    const updated = afterDelivery(d.item, now)
    if (updated.status === 'done' || updated.status === 'cancelled') {
      delivered.add(d.item.id)
    } else {
      // A3 gentle: allow future ticks when nextNudgeAt passes
      delivered.delete(d.item.id)
    }
    const idx = nextItems.findIndex((x) => x.id === d.item.id)
    if (idx >= 0) nextItems[idx] = updated
    broadcast('agenda:due', {
      item: updated,
      title: msg.title,
      body: msg.body,
      at: now
    })
  }
  items = nextItems
  broadcast('agenda:sync-result', { items: nextItems })
}

function normalizeItemLead(it: AgendaItem): AgendaItem {
  if (it.type !== 'reminder' || !it.notify) return it
  const rel = it.when?.relativeMs ?? 0
  const lead = it.notify.leadMinutes ?? 0
  if (rel > 0 && rel < 10 * 60_000 && lead > 0) {
    return { ...it, notify: { ...it.notify, leadMinutes: 0 } }
  }
  if (it.when?.at != null && lead > 0) {
    const until = it.when.at - Date.now()
    if (until > 0 && lead * 60_000 >= until) {
      return { ...it, notify: { ...it.notify, leadMinutes: 0 } }
    }
  }
  return it
}

export function agendaSetSnapshot(
  next: AgendaItem[] | undefined | null,
  nextPrefs?: AgendaPrefs | null
): void {
  items = Array.isArray(next) ? next.map((x) => normalizeItemLead({ ...x })) : []
  if (nextPrefs) prefs = nextPrefs
  // prune delivered for removed or still-pending/snoozed (re-arm after edit)
  for (const id of [...delivered]) {
    const it = items.find((x) => x.id === id)
    if (!it || it.status === 'pending' || it.status === 'snoozed') delivered.delete(id)
  }
}

export function agendaGetSnapshot(): AgendaItem[] {
  return items
}

export function startAgendaScheduler(intervalMs = 30_000): void {
  if (timer) return
  timer = setInterval(() => {
    try {
      tick()
    } catch (e) {
      console.warn('[agenda] tick', e)
    }
  }, intervalMs)
  // first pass soon
  setTimeout(() => {
    try {
      tick()
    } catch {
      /* ignore */
    }
  }, 5_000)
  console.warn('[agenda] scheduler started', intervalMs)
}

export function stopAgendaScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
