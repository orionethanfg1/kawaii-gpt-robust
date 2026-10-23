/**
 * A1 — Parse natural-language agenda intents (es-MX).
 * Pure: no Electron, no LLM. Ambiguous times → needsClarify.
 */

import {
  type AgendaItem,
  type AgendaItemType,
  type AgendaWhen,
  type AgendaSensitivity,
  newAgendaId,
  defaultAgendaPrefs
} from './types'
import {
  resolveLeadMinutes,
  resolveInsist,
  maxNudgesForInsist,
  formatLeadForConfirm,
  learnFromFeedback,
  parseLeadMinutesFromText,
  parseInsistFromText
} from './prefs'

export type AgendaParseResult = {
  ok: boolean
  intent?: 'create' | 'cancel' | 'snooze' | 'list'
  type?: AgendaItemType
  title?: string
  when?: AgendaWhen
  sensitivity?: AgendaSensitivity
  needsClarify?: boolean
  clarifyQuestion?: string
  /** Ready-to-save item if ok && create && !needsClarify */
  item?: AgendaItem
  /** Short confirmation the chat can speak (es-MX) */
  confirmPhrase?: string
  reason?: string
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function parseClock(text: string): { h: number; m: number } | null {
  const m24 = text.match(/\b([01]?\d|2[0-3])\s*[:h\.]\s*([0-5]\d)\b/)
  if (m24) return { h: Number(m24[1]), m: Number(m24[2]) }
  const m12 = text.match(/\b([1-9]|1[0-2])\s*(?::([0-5]\d))?\s*(am|pm|a\.?\s*m\.?|p\.?\s*m\.?)\b/i)
  if (m12) {
    let h = Number(m12[1])
    const min = m12[2] ? Number(m12[2]) : 0
    const ap = m12[3].toLowerCase()
    if (/p/.test(ap) && h < 12) h += 12
    if (/a/.test(ap) && h === 12) h = 0
    return { h, m: min }
  }
  const solo = text.match(/\ba\s+las\s+([01]?\d|2[0-3])\b/i)
  if (solo) return { h: Number(solo[1]), m: 0 }
  return null
}

function detectSensitive(text: string): AgendaSensitivity {
  if (/duelo|terapia|ansiedad|depres|ruptura|muerte|hospital|m[eé]dic/.test(text.toLowerCase())) {
    return 'sensitive'
  }
  return 'normal'
}

/**
 * Parse user text into agenda intent.
 */
export function parseAgendaIntent(
  text: string,
  opts?: { now?: number; prefs?: ReturnType<typeof defaultAgendaPrefs> }
): AgendaParseResult {
  const now = opts?.now ?? Date.now()
  const prefs = opts?.prefs || defaultAgendaPrefs()
  const raw = String(text || '').trim()
  const q = raw.toLowerCase()
  if (q.length < 4) return { ok: false, reason: 'too-short' }

  if (/\b(cancela|cancelar|olvida\s+el\s+recordatorio|ya\s+no\s+me\s+recuerdes)\b/i.test(q)) {
    return { ok: true, intent: 'cancel', confirmPhrase: 'Listo, lo quito de la agenda.' }
  }
  if (/\b(pospon|snooze|m[aá]s\s+tarde|en\s+un\s+rato\s+m[aá]s)\b/i.test(q) &&
      /\b(recordator|agenda|aviso)\b/i.test(q)) {
    return { ok: true, intent: 'snooze', confirmPhrase: 'De acuerdo, lo dejo para más tarde.' }
  }
  if (/\b(qu[eé]\s+tengo\s+agendado|mis\s+recordatorios|lista\s+de\s+agenda)\b/i.test(q)) {
    return { ok: true, intent: 'list' }
  }

  // Talk deferral
  const talk =
    /\b(podemos\s+hablar|lo\s+hablamos|lo\s+vemos|seguimos\s+con\s+eso|retomamos)\b/i.test(q) ||
    (/\b(mañana|en\s+una?\s+hora|m[aá]s\s+tarde|luego)\b/i.test(q) &&
      /\b(hablar|platic|tema|eso)\b/i.test(q))

  // Explicit reminder
  const reminder =
    /\b(recu[eé]rdame|recuerdame|av[ií]same|no\s+se\s+me\s+olvide)\b/i.test(q)

  if (!talk && !reminder) {
    return { ok: false, reason: 'no-agenda-intent' }
  }

  const type: AgendaItemType = reminder ? 'reminder' : 'talk'
  const sensitivity = detectSensitive(raw)

  // Topic / title
  let title = raw
  title = title
    .replace(/\b(recu[eé]rdame|recuerdame|av[ií]same|avisame)\b/gi, '')
    .replace(/\b(gracias|por\s+favor|plis|please|preciosa|hermosa|amor|cari[nñ]o)\b/gi, '')
    .replace(/\b(podemos\s+hablar\s+de|lo\s+hablamos\s+de|sobre)\b/gi, '')
    .replace(/\b(mañana|pasado\s+mañana|en\s+una?\s+hora|en\s+\d+\s*min(?:uto)?s?|en\s+un\s+minuto|hoy|ahora)\b/gi, '')
    .replace(/\ba\s+las\s+\d{1,2}(:\d{2})?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Strip leading filler repeatedly («de comer…» → «comer…»)
  for (let i = 0; i < 4; i++) {
    const next = title.replace(/^(de|a|que|para|el|la|los|las|un|una)\s+/i, '').trim()
    if (next === title) break
    title = next
  }
  if (title.length < 2) title = type === 'talk' ? 'Retomar la plática' : 'Recordatorio'
  if (title.length > 80) title = title.slice(0, 80)

  const when = resolveWhen(q, now, type)
  if (!when) {
    return {
      ok: true,
      intent: 'create',
      type,
      title,
      sensitivity,
      needsClarify: true,
      clarifyQuestion:
        type === 'talk'
          ? '¿Te late mañana por la tarde, o prefieres en un rato?'
          : '¿A qué hora te lo recuerdo?'
    }
  }

  const item: AgendaItem = {
    id: newAgendaId(),
    type,
    title,
    topic: title,
    sensitivity,
    when,
    status: 'pending',
    notify: (() => {
      const insist = resolveInsist(raw, prefs, sensitivity)
      let lead = type === 'reminder' ? resolveLeadMinutes(raw, prefs) : undefined
      const rel = when.relativeMs ?? (when.at != null ? when.at - now : 0)
      if (type === 'reminder' && rel > 0 && rel < 10 * 60_000) {
        lead = 0
      } else if (type === 'reminder' && lead != null && when.at != null) {
        const until = when.at - now
        if (until > 0 && lead * 60_000 >= until) lead = 0
      }
      return {
        leadMinutes: lead,
        insist,
        maxNudges: maxNudgesForInsist(insist),
        nudgesSent: 0
      }
    })(),
    createdAt: now,
    updatedAt: now
  }

  const lead =
    type === 'reminder' ? resolveLeadMinutes(raw, prefs) : undefined
  const confirmPhrase =
    type === 'talk'
      ? `De acuerdo, lo dejamos para ${when.label || 'después'}; cuando sea el momento lo retomamos sin prisa.`
      : `Listo: te recuerdo «${title}» ${when.label || 'a la hora que quedó'}` +
        (lead != null && lead > 0 ? ` (${formatLeadForConfirm(lead)})` : '') +
        '.' 

  return {
    ok: true,
    intent: 'create',
    type,
    title,
    when,
    sensitivity,
    item,
    confirmPhrase,
    needsClarify: false
  }
}

function resolveWhen(q: string, now: number, type: AgendaItemType): AgendaWhen | null {
  const base = new Date(now)

  // relative minutes (e.g. en 1 minuto, en 5 min)
  const relMin = q.match(/\ben\s+(\d+)\s*min(?:uto)?s?\b/)
  if (relMin) {
    const n = Math.min(24 * 60, Math.max(1, Number(relMin[1])))
    const ms = n * 60_000
    const at = now + ms
    return {
      kind: 'relative',
      relativeMs: ms,
      at,
      label: n === 1 ? 'en 1 minuto' : `en ${n} minutos`
    }
  }
  if (/\ben\s+un\s+minuto\b/.test(q)) {
    const at = now + 60_000
    return { kind: 'relative', relativeMs: 60_000, at, label: 'en 1 minuto' }
  }

  // relative hour
  const relH = q.match(/\ben\s+(\d+)\s*horas?\b/)
  if (relH) {
    const ms = Number(relH[1]) * 3600000
    const at = now + ms
    return {
      kind: 'relative',
      relativeMs: ms,
      at,
      label: Number(relH[1]) === 1 ? 'en una hora' : `en ${relH[1]} horas`
    }
  }
  if (/\ben\s+una?\s+hora\b/.test(q)) {
    const at = now + 3600000
    return { kind: 'relative', relativeMs: 3600000, at, label: 'en una hora' }
  }
  if (/\ben\s+un\s+rato\b|\bm[aá]s\s+tarde\b/.test(q) && type === 'talk') {
    const at = now + 90 * 60000
    return {
      kind: 'window',
      windowStart: now + 45 * 60000,
      windowEnd: now + 3 * 3600000,
      at,
      label: 'en un rato'
    }
  }

  const clock = parseClock(q)
  let dayOffset = 0
  if (/\bpasado\s+mañana\b/.test(q)) dayOffset = 2
  else if (/\bmañana\b/.test(q)) dayOffset = 1
  else if (/\bhoy\b/.test(q)) dayOffset = 0
  else if (clock) dayOffset = 0
  else if (type === 'talk' && /\bmañana\b/.test(q)) dayOffset = 1
  else if (!clock && !/\bmañana|hoy|pasado/.test(q)) return null

  const day = startOfDay(base)
  day.setDate(day.getDate() + dayOffset)

  if (clock) {
    const atD = new Date(day)
    atD.setHours(clock.h, clock.m, 0, 0)
    let at = atD.getTime()
    if (at < now - 60000) {
      // past today → tomorrow
      atD.setDate(atD.getDate() + 1)
      at = atD.getTime()
    }
    return {
      kind: 'exact',
      at,
      label:
        dayOffset === 1
          ? `mañana a las ${clock.h}:${String(clock.m).padStart(2, '0')}`
          : `a las ${clock.h}:${String(clock.m).padStart(2, '0')}`
    }
  }

  // mañana without clock → window afternoon for talk, morning for reminder needs clarify handled upstream
  if (dayOffset >= 1 && type === 'talk') {
    const start = new Date(day)
    start.setHours(10, 0, 0, 0)
    const end = new Date(day)
    end.setHours(20, 0, 0, 0)
    return {
      kind: 'window',
      windowStart: start.getTime(),
      windowEnd: end.getTime(),
      at: start.getTime() + 4 * 3600000,
      label: dayOffset === 2 ? 'pasado mañana' : 'mañana'
    }
  }

  if (dayOffset >= 1 && type === 'reminder') {
    // reminder mañana without hour → clarify
    return null
  }

  return null
}

/** Merge new item into list (max 40) */
export function upsertAgendaItem(list: AgendaItem[] | undefined, item: AgendaItem): AgendaItem[] {
  const prev = (list || []).filter((x) => x.status === 'pending' || x.status === 'snoozed' || x.status === 'due')
  return [item, ...prev.filter((x) => x.id !== item.id)].slice(0, 40)
}

export { learnFromFeedback, parseLeadMinutesFromText, parseInsistFromText } from './prefs'
