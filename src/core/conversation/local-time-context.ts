/**
 * S6 — wall-clock / calendar awareness for the model (not a robot clock dump).
 * Optional weather line when settings already have a fresh snapshot.
 */

export type LocalTimeContextInput = {
  now?: Date
  locale?: string
  timeZone?: string
  /** e.g. weatherSummary from settings */
  weatherLine?: string | null
  /** character name for tone */
  characterName?: string
}

export function buildLocalTimeContextBlock(input?: LocalTimeContextInput): string {
  const now = input?.now ?? new Date()
  const locale = input?.locale || 'es-MX'
  let timeZone = input?.timeZone
  try {
    timeZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    timeZone = undefined
  }

  let weekday = ''
  let dateStr = ''
  let timeStr = ''
  try {
    weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone }).format(now)
    dateStr = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone
    }).format(now)
    timeStr = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone
    }).format(now)
  } catch {
    weekday = now.toLocaleDateString('es-MX', { weekday: 'long' })
    dateStr = now.toLocaleDateString('es-MX')
    timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  }

  const hour = now.getHours()
  let dayPart = 'noche'
  if (hour >= 5 && hour < 12) dayPart = 'mañana'
  else if (hour >= 12 && hour < 19) dayPart = 'tarde'
  else if (hour >= 19 && hour < 22) dayPart = 'noche temprano'

  const lines = [
    '[CONTEXTO_TEMPORAL — reloj del usuario, no inventes otra zona]',
    `Ahora es ${weekday} ${dateStr}, alrededor de las ${timeStr}` +
      (timeZone ? ` (${timeZone})` : '') +
      ` · tramo del día: ${dayPart}.`,
    'Úsalo solo si aporta (saludos, cansancio, planes, «buenas noches»); no digas la hora en cada mensaje.',
    'Si la conversación lleva mucho en un mismo «guion» (lectura, escena), puedes notar el paso del tiempo con naturalidad, sin sonar a reloj.'
  ]
  const w = (input?.weatherLine || '').trim()
  if (w) {
    lines.push(`Clima reciente (si ayuda al plan o al ánimo): ${w.slice(0, 160)}.`)
  }
  return lines.join('\n')
}

/** Shorter line for initiative decision prompts */
export function buildLocalTimeOneLiner(now = new Date(), locale = 'es-MX'): string {
  try {
    const t = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(now)
    return `Hora local del usuario: ${t}.`
  } catch {
    return `Hora local: ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}.`
  }
}
