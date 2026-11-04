/**
 * S6 — Local time / quiet-hours awareness for the model (not a weather API).
 */
import { isQuietHours } from './initiative'

export type TimeAwarenessInput = {
  now?: Date
  quietStartH?: number
  quietEndH?: number
  weatherLine?: string
  timeZone?: string
}

export function buildTimeAwarenessBlock(input?: TimeAwarenessInput): string {
  const now = input?.now || new Date()
  const tz =
    input?.timeZone ||
    (typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'local')
  const startH = input?.quietStartH ?? 23
  const endH = input?.quietEndH ?? 8
  const quiet = isQuietHours(now, startH, endH)
  const pad = (n: number) => String(n).padStart(2, '0')
  const local = pad(now.getHours()) + ':' + pad(now.getMinutes())
  const date =
    now.getFullYear() +
    '-' +
    pad(now.getMonth() + 1) +
    '-' +
    pad(now.getDate())
  const weekday = [
    'domingo',
    'lunes',
    'martes',
    'miércoles',
    'jueves',
    'viernes',
    'sábado'
  ][now.getDay()]
  const parts = [
    '[TIEMPO_LOCAL]',
    'Ahora es ' + weekday + ' ' + date + ' · ' + local + ' (' + tz + ').',
    quiet
      ? 'Franja de descanso del usuario aprox. ' +
        startH +
        ':00–' +
        endH +
        ':00: evita ser insistente; si escribes, sé breve y suave.'
      : 'Fuera de franja de descanso: puedes ser un poco más presente si el vínculo lo pide.',
    'Usa el reloj solo cuando aporte (buenas noches, «hace rato», citas); no recites la hora en cada mensaje.'
  ]
  if (input?.weatherLine?.trim()) {
    parts.push('Clima (si ayuda a vestimenta o planes): ' + input.weatherLine.trim())
  }
  return parts.join('\n')
}
