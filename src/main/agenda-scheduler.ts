/**
 * A2 — Main-process agenda tick: snapshot from renderer, due check, OS notify once.
 */

import { BrowserWindow, Notification, app, nativeImage } from 'electron'
import { focusMainWindow as focusWindowShared, getMainWindow } from './window-bootstrap'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import type { AgendaItem, AgendaPrefs } from '../core/agenda/types'
import { collectDueItems, afterDelivery, buildDueMessage } from '../core/agenda/due'

let items: AgendaItem[] = []
let prefs: AgendaPrefs | null = null
let timer: ReturnType<typeof setInterval> | null = null
const delivered = new Set<string>()

const AGENDA_STORE = 'agenda-snapshot-v1.json'

function agendaStorePath(): string {
  return join(app.getPath('userData'), 'backups', AGENDA_STORE)
}

type AgendaDisk = {
  items: AgendaItem[]
  prefs: AgendaPrefs | null
  delivered: string[]
  savedAt: number
}

function loadAgendaFromDisk(): void {
  try {
    const fp = agendaStorePath()
    if (!existsSync(fp)) return
    const raw = readFileSync(fp, 'utf8')
    const data = JSON.parse(raw) as AgendaDisk
    if (Array.isArray(data.items)) {
      items = data.items.map((x) => normalizeItemLead({ ...x }))
    }
    if (data.prefs) prefs = data.prefs
    if (Array.isArray(data.delivered)) {
      delivered.clear()
      for (const id of data.delivered) delivered.add(String(id))
    }
    console.warn('[agenda] loaded from disk', items.length, 'items')
  } catch (e) {
    console.warn('[agenda] load disk', e)
  }
}

function saveAgendaToDisk(): void {
  try {
    const dir = join(app.getPath('userData'), 'backups')
    mkdirSync(dir, { recursive: true })
    const payload: AgendaDisk = {
      items,
      prefs,
      delivered: [...delivered],
      savedAt: Date.now()
    }
    writeFileSync(agendaStorePath(), JSON.stringify(payload), 'utf8')
  } catch (e) {
    console.warn('[agenda] save disk', e)
  }
}


function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      if (!w.isDestroyed()) w.webContents.send(channel, payload)
    } catch {
      /* ignore */
    }
  }
}

function focusMainWindow(convId?: string): void {
  focusWindowShared({ convId, source: 'agenda-notification' })
  // Extra: ensure main ref is used if getAllWindows is empty of visible
  try {
    const w = getMainWindow()
    if (w && !w.isDestroyed() && !w.isVisible()) {
      w.setSkipTaskbar(false)
      w.show()
      w.focus()
    }
  } catch {
    /* */
  }
}

function osNotify(title: string, body: string, convId?: string): void {
  try {
    if (!Notification.isSupported()) {
      console.warn('[agenda] Notification API unsupported')
      return
    }
    let icon: Electron.NativeImage | undefined
    try {
      const { join } = require('path') as typeof import('path')
      const candidates = [
        join(process.resourcesPath || '', 'resources', 'icon.png'),
        join(__dirname, '../../resources/icon.png')
      ]
      for (const p of candidates) {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) {
          icon = img
          break
        }
      }
    } catch {
      /* */
    }
    const n = new Notification({
      title: title.slice(0, 120),
      body: body.slice(0, 240),
      icon,
      urgency: 'normal',
      timeoutType: 'default'
    })
    const go = () => {
      console.warn('[agenda] notification click', convId || '')
      focusMainWindow(convId)
    }
    n.on('click', go)
    n.on('action', go)
    // Some Windows builds only fire 'close' after activation — still try focus if user interacted
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
      msg.body,
      (d.item as { convId?: string }).convId
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
  saveAgendaToDisk()
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
  saveAgendaToDisk()
}

export function agendaGetSnapshot(): AgendaItem[] {
  return items
}

export function startAgendaScheduler(intervalMs = 30_000): void {
  if (timer) return
  try {
    loadAgendaFromDisk()
  } catch {
    /* */
  }
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
