/**
 * A0 — Agenda domain (separate from user/assistant memory likes).
 */

export type AgendaItemType = 'talk' | 'reminder' | 'event'
export type AgendaWhenKind = 'exact' | 'window' | 'relative'
export type AgendaStatus = 'pending' | 'due' | 'done' | 'snoozed' | 'cancelled'
export type AgendaInsist = 'off' | 'once' | 'gentle' | 'learned'
export type AgendaSensitivity = 'normal' | 'sensitive'

export type AgendaWhen = {
  kind: AgendaWhenKind
  at?: number
  windowStart?: number
  windowEnd?: number
  relativeMs?: number
  tz?: string
  /** Human label for UI / confirm (es-MX) */
  label?: string
}

export type AgendaNotify = {
  leadMinutes?: number
  insist: AgendaInsist
  maxNudges?: number
  nudgesSent?: number
  /** A3 — earliest time for next gentle nudge */
  nextNudgeAt?: number
}

export type AgendaItem = {
  id: string
  type: AgendaItemType
  title: string
  topic?: string
  sensitivity: AgendaSensitivity
  when: AgendaWhen
  status: AgendaStatus
  notify: AgendaNotify
  createdAt: number
  updatedAt: number
  sourceTurnId?: string
}

export type AgendaPrefs = {
  defaultLeadMinutes: number
  insistStyle: AgendaInsist
  quietHours?: { startH: number; endH: number }
  learned?: {
    snoozeRate?: number
    preferLead?: number
    /** total snoozes observed */
    snoozeCount?: number
    doneCount?: number
  }
}

export function defaultAgendaPrefs(): AgendaPrefs {
  return {
    defaultLeadMinutes: 15,
    insistStyle: 'once',
    quietHours: { startH: 8, endH: 20 }
  }
}

export function emptyAgenda(): AgendaItem[] {
  return []
}

export function newAgendaId(): string {
  return `ag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
