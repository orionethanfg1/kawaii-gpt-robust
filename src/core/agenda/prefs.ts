/**
 * A3 — Lead minutes + insistence preferences (learned from user behavior).
 */

import type { AgendaInsist, AgendaPrefs } from './types'
import { defaultAgendaPrefs } from './types'

const LEAD_OPTIONS = [5, 15, 30, 60, 120] as const

export function parseLeadMinutesFromText(text: string): number | null {
  const q = String(text || '').toLowerCase()
  // "con 15 minutos de anticipación" / "avísame 30 min antes"
  const m = q.match(
    /\b(?:con\s+)?(\d+)\s*(?:min(?:utos?)?|m)\s*(?:de\s+)?(?:anticipaci[oó]n|antes)?\b/
  )
  if (m) {
    const n = Number(m[1])
    if (n >= 1 && n <= 24 * 60) return n
  }
  if (/\b(?:media\s+hora|30\s*min)\s*(?:antes|de\s+anticipaci[oó]n)?\b/.test(q)) return 30
  if (/\b(?:una?\s+hora|1\s*h)\s*(?:antes|de\s+anticipaci[oó]n)?\b/.test(q)) return 60
  if (/\bsin\s+anticipaci[oó]n\b|\bal\s+momento\b|\ben\s+punto\b/.test(q)) return 0
  return null
}

export function parseInsistFromText(text: string): AgendaInsist | null {
  const q = String(text || '').toLowerCase()
  if (/\b(no\s+insistas|sin\s+insist|solo\s+una?\s+vez|una?\s+sola?\s+vez|no\s+me\s+est[eé]s\s+recordando)\b/.test(q))
    return 'off'
  if (/\b(insiste\s+un\s+poco|si\s+no\s+contesto|vuelve\s+a\s+avisar|recu[eé]rdame\s+otra?\s+vez)\b/.test(q))
    return 'gentle'
  if (/\b(solo\s+av[ií]same\s+una?\s+vez)\b/.test(q)) return 'once'
  return null
}

/** Resolve lead for a new item: explicit text > learned preferLead > default */
export function resolveLeadMinutes(
  text: string,
  prefs?: AgendaPrefs | null
): number {
  const explicit = parseLeadMinutesFromText(text)
  if (explicit != null) return explicit
  const p = prefs || defaultAgendaPrefs()
  if (typeof p.learned?.preferLead === 'number' && p.learned.preferLead >= 0) {
    return p.learned.preferLead
  }
  return p.defaultLeadMinutes ?? 15
}

/** Resolve insist style for a new item */
export function resolveInsist(
  text: string,
  prefs?: AgendaPrefs | null,
  sensitivity?: string
): AgendaInsist {
  if (sensitivity === 'sensitive') return 'off'
  const explicit = parseInsistFromText(text)
  if (explicit) return explicit
  const p = prefs || defaultAgendaPrefs()
  if (p.insistStyle === 'learned') {
    // Map learned snooze rate → style
    const rate = p.learned?.snoozeRate ?? 0
    if (rate >= 0.5) return 'off'
    if (rate >= 0.25) return 'once'
    return 'gentle'
  }
  return p.insistStyle || 'once'
}

export function maxNudgesForInsist(insist: AgendaInsist): number {
  if (insist === 'off' || insist === 'once') return 1
  if (insist === 'gentle' || insist === 'learned') return 3
  return 1
}

/** Minutes between gentle nudges */
export function nudgeGapMinutes(insist: AgendaInsist): number {
  if (insist === 'gentle' || insist === 'learned') return 30
  return 0
}

/**
 * Update prefs after user snoozes or rejects insistence.
 * snooze → raise snoozeRate; "no insistas" → insistStyle off + rate up.
 */
export function learnFromFeedback(
  prev: AgendaPrefs | null | undefined,
  kind: 'snooze' | 'cancel' | 'done' | 'no-insist' | 'set-lead',
  opts?: { leadMinutes?: number }
): AgendaPrefs {
  const base = { ...defaultAgendaPrefs(), ...(prev || {}) }
  const learned = { ...(base.learned || {}) }
  const rate = learned.snoozeRate ?? 0

  if (kind === 'snooze') {
    learned.snoozeRate = Math.min(1, rate * 0.7 + 0.3)
    if (learned.snoozeRate >= 0.45 && base.insistStyle === 'gentle') {
      base.insistStyle = 'once'
    }
  } else if (kind === 'no-insist') {
    base.insistStyle = 'off'
    learned.snoozeRate = Math.min(1, rate + 0.2)
  } else if (kind === 'done') {
    // successful completion without snooze → slight trust in current style
    learned.snoozeRate = Math.max(0, rate * 0.85)
  } else if (kind === 'cancel') {
    learned.snoozeRate = Math.min(1, rate + 0.1)
  } else if (kind === 'set-lead' && opts?.leadMinutes != null) {
    learned.preferLead = opts.leadMinutes
    base.defaultLeadMinutes = opts.leadMinutes
  }

  // Snap preferLead to common options when close
  if (typeof learned.preferLead === 'number') {
    const nearest = LEAD_OPTIONS.reduce((a, b) =>
      Math.abs(b - learned.preferLead!) < Math.abs(a - learned.preferLead!) ? b : a
    )
    if (Math.abs(nearest - learned.preferLead) <= 5) learned.preferLead = nearest
  }

  return { ...base, learned }
}

export function formatLeadForConfirm(minutes: number): string {
  if (minutes <= 0) return 'en el momento'
  if (minutes < 60) return `con ${minutes} min de anticipación`
  if (minutes === 60) return 'con una hora de anticipación'
  const h = Math.round(minutes / 60)
  return `con ${h} h de anticipación`
}
