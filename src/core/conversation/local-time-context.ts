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

/** Human delta for prompts (es-MX, compact). */
export function formatElapsedNatural(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  if (sec < 90) return 'menos de 2 min'
  const min = Math.round(sec / 60)
  if (min < 60) return min + ' min'
  const h = Math.round(min / 60)
  if (h < 48) return h + ' h'
  const d = Math.round(h / 24)
  return d + (d === 1 ? ' día' : ' días')
}

export type ThreadTimeAnchors = {
  lastUserAt: number
  /** When the last assistant reply finished (stream done), not generation start. */
  lastAssistantDoneAt: number
  silenceSinceAssistantMs: number
  sinceUserMs: number
}

/** Resolve thread clocks. Prefer explicit stream-done for assistant pivot. */
export function resolveThreadTimeAnchors(opts: {
  now?: number
  lastUserAt?: number | null
  lastAssistantDoneAt?: number | null
  lastAssistantMsgAt?: number | null
}): ThreadTimeAnchors {
  const now = opts.now ?? Date.now()
  const lastUserAt = Math.max(0, Number(opts.lastUserAt) || 0)
  const done =
    Math.max(0, Number(opts.lastAssistantDoneAt) || 0) ||
    Math.max(0, Number(opts.lastAssistantMsgAt) || 0)
  return {
    lastUserAt,
    lastAssistantDoneAt: done,
    silenceSinceAssistantMs: done > 0 ? Math.max(0, now - done) : 0,
    sinceUserMs: lastUserAt > 0 ? Math.max(0, now - lastUserAt) : 0
  }
}

/**
 * Compact thread-gap block for chat + initiatives.
 * Pivot = when the LLM finished writing. Soft-omit if silence is tiny.
 */
export function buildThreadTimeGapBlock(
  anchors: ThreadTimeAnchors,
  opts?: { now?: Date; locale?: string; minSilenceMs?: number }
): string {
  const minSilence = opts?.minSilenceMs ?? 90_000
  const now = opts?.now ?? new Date()
  const lines: string[] = [
    '[TIEMPO_HILO — pivote: fin de tu última respuesta, no el inicio del stream]'
  ]
  try {
    const local = new Intl.DateTimeFormat(opts?.locale || 'es-MX', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(now)
    lines.push('Ahora (local): ' + local + '.')
  } catch {
    lines.push(
      'Ahora (local): ' +
        now.getHours() +
        ':' +
        String(now.getMinutes()).padStart(2, '0') +
        '.'
    )
  }
  if (anchors.lastAssistantDoneAt > 0 && anchors.silenceSinceAssistantMs >= minSilence) {
    lines.push(
      'Tu última respuesta terminó hace ' +
        formatElapsedNatural(anchors.silenceSinceAssistantMs) +
        '.'
    )
  } else if (anchors.lastAssistantDoneAt > 0) {
    lines.push('Tu última respuesta acabó de cerrar (mismo tramo de charla).')
  }
  if (anchors.lastUserAt > 0 && anchors.sinceUserMs >= minSilence) {
    lines.push(
      'Último mensaje del usuario: hace ' + formatElapsedNatural(anchors.sinceUserMs) + '.'
    )
  }
  lines.push(
    'Usa el silencio real desde que terminaste de escribir; no digas la hora en cada mensaje ni inventes esperas.'
  )
  return lines.join('\n')
}

/** One-liner for initiative N1 / message prompts */
export function buildThreadTimeGapOneLiner(
  anchors: ThreadTimeAnchors,
  minSilenceMs = 90_000
): string {
  if (anchors.lastAssistantDoneAt > 0 && anchors.silenceSinceAssistantMs >= minSilenceMs) {
    const a =
      'Silencio desde que terminaste de escribir: ' +
      formatElapsedNatural(anchors.silenceSinceAssistantMs)
    if (anchors.lastUserAt > 0 && anchors.sinceUserMs >= minSilenceMs) {
      return (
        a +
        ' · último mensaje del usuario: hace ' +
        formatElapsedNatural(anchors.sinceUserMs)
      )
    }
    return a
  }
  if (anchors.lastUserAt > 0 && anchors.sinceUserMs >= minSilenceMs) {
    return 'Último mensaje del usuario: hace ' + formatElapsedNatural(anchors.sinceUserMs)
  }
  return ''
}
