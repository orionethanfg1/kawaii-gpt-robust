/**
 * A2 — Pure due engine: which items fire, quiet hours, one delivery per due window.
 */

import type { AgendaItem, AgendaPrefs } from './types'
import { defaultAgendaPrefs } from './types'

export type DueCandidate = {
  item: AgendaItem
  /** Effective fire time (at − lead for reminders) */
  fireAt: number
  reason: 'exact' | 'window-start' | 'relative'
}

/** Quiet hours: local hour in [startH, endH). Outside = quiet (do not notify). */
export function inQuietHours(
  now: number,
  prefs?: AgendaPrefs | null
): boolean {
  const q = prefs?.quietHours ?? defaultAgendaPrefs().quietHours
  if (!q) return false
  const h = new Date(now).getHours()
  const { startH, endH } = q
  if (startH === endH) return false
  if (startH < endH) {
    // e.g. 8–20 active → quiet outside
    return h < startH || h >= endH
  }
  // overnight window
  return h >= endH && h < startH
}

/** Effective lead ms: never push fire before "now" for short relative reminders. */
export function effectiveLeadMs(item: AgendaItem, now = Date.now()): number {
  if (item.type !== 'reminder') return 0
  const raw = Math.max(0, item.notify?.leadMinutes ?? 0) * 60_000
  if (raw <= 0) return 0
  const at = item.when?.at
  if (at == null) return raw
  const until = at - now
  // Short deadlines: fire at `at`, not lead minutes early
  if (until > 0 && until <= raw + 60_000) return 0
  // relativeMs under 10 min → no lead
  if (item.when?.kind === 'relative' && (item.when.relativeMs ?? 0) > 0 && (item.when.relativeMs ?? 0) < 10 * 60_000) {
    return 0
  }
  return raw
}

export function itemFireAt(item: AgendaItem, now = Date.now()): number | null {
  const w = item.when
  if (!w) return null
  if (w.kind === 'exact' || w.kind === 'relative') {
    const at = w.at
    if (at == null) return null
    const lead = effectiveLeadMs(item, now)
    return at - lead
  }
  if (w.kind === 'window') {
    return w.windowStart ?? w.at ?? null
  }
  return w.at ?? null
}

export function isItemDue(
  item: AgendaItem,
  now = Date.now(),
  opts?: { graceMs?: number }
): boolean {
  if (item.status === 'done' || item.status === 'cancelled') return false
  // A3 gentle follow-up
  if (item.status === 'due') {
    const next = item.notify?.nextNudgeAt
    const max = item.notify?.maxNudges ?? 1
    const sent = item.notify?.nudgesSent ?? 0
    if (sent >= max) return false
    if (next != null && now < next) return false
    return next != null && now >= next
  }
  if (item.status !== 'pending' && item.status !== 'snoozed') return false
  const fire = itemFireAt(item)
  if (fire == null) return false
  const grace = opts?.graceMs ?? 60_000
  return now >= fire && now - fire < 24 * 3600_000 + grace
}

/**
 * List items that should deliver once now.
 * Skips quiet hours unless sensitivity is normal and type is reminder with exact time
 * and user is within 5 min of exact (optional override) — for A2 we simply skip all in quiet hours.
 */
export function collectDueItems(
  items: AgendaItem[] | undefined | null,
  now = Date.now(),
  prefs?: AgendaPrefs | null,
  alreadyDeliveredIds?: Set<string>
): DueCandidate[] {
  const list = items || []
  const quiet = inQuietHours(now, prefs)
  const out: DueCandidate[] = []
  for (const item of list) {
    if (alreadyDeliveredIds?.has(item.id)) continue
    if (!isItemDue(item, now)) continue
    if (quiet && item.sensitivity === 'sensitive') continue
    if (quiet && item.type === 'talk') continue
    // reminders in quiet hours: still skip in A2 (prefs can override later)
    if (quiet) continue
    const fireAt = itemFireAt(item, now)
    if (fireAt == null) continue
    out.push({
      item,
      fireAt,
      reason:
        item.when.kind === 'window'
          ? 'window-start'
          : item.when.kind === 'relative'
            ? 'relative'
            : 'exact'
    })
  }
  return out.sort((a, b) => a.fireAt - b.fireAt)
}

/** Mark one delivery; gentle may stay `due` for a later nudge (A3). */
export function afterDelivery(item: AgendaItem, now = Date.now()): AgendaItem {
  const nudges = (item.notify?.nudgesSent ?? 0) + 1
  const max = item.notify?.maxNudges ?? 1
  const insist = item.notify?.insist ?? 'once'
  const single =
    insist === 'off' ||
    insist === 'once' ||
    item.type === 'talk' ||
    item.sensitivity === 'sensitive'
  const done = single || nudges >= max
  return {
    ...item,
    status: done ? 'done' : 'due',
    notify: {
      ...item.notify,
      insist,
      maxNudges: item.notify?.maxNudges ?? max,
      nudgesSent: nudges,
      /** next eligible gentle nudge (ms) */
      nextNudgeAt: done
        ? undefined
        : now + (insist === 'gentle' || insist === 'learned' ? 30 * 60_000 : 0)
    } as AgendaItem['notify'] & { nextNudgeAt?: number },
    updatedAt: now
  }
}

export function buildDueMessage(item: AgendaItem): { title: string; body: string } {
  if (item.type === 'talk') {
    return {
      title: 'Retomar plática',
      body: item.topic || item.title || 'Cuando quieras, seguimos con lo que dejamos pendiente.'
    }
  }
  return {
    title: 'Recordatorio',
    body: item.title || 'Tienes un recordatorio pendiente.'
  }
}
