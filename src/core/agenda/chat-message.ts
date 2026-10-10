/**
 * Soft in-chat lines when an agenda item becomes due (es-MX, companion tone).
 * Separate bubble from the LLM turn that created the reminder — never mix.
 */

import type { AgendaItem } from './types'

export function buildAgendaDueChatMessage(
  item: AgendaItem,
  opts?: { characterName?: string; userName?: string }
): string {
  const who = opts?.userName || ''
  const title = (item.title || item.topic || '').trim()
  const short = title.length > 60 ? title.slice(0, 57) + '…' : title

  if (item.type === 'talk') {
    if (item.sensitivity === 'sensitive') {
      return who
        ? `${who}, cuando te sientas con ganas, podemos retomar lo de «${short || 'eso que dejamos'}». Sin prisa.`
        : `Cuando te sientas con ganas, podemos retomar lo de «${short || 'eso que dejamos'}». Sin prisa.`
    }
    return who
      ? `Oye ${who}… ¿retomamos lo de «${short || 'nuestra plática'}»? Aquí estoy.`
      : `¿Retomamos lo de «${short || 'nuestra plática'}»? Aquí estoy.`
  }

  if (item.sensitivity === 'sensitive') {
    return short
      ? `Hey… solo un toque suave: «${short}». Cuando quieras lo vemos.`
      : `Hey… tenías algo pendiente; cuando quieras lo vemos, sin presión.`
  }
  if (short) {
    return who
      ? `${who}, te acordaba de «${short}». ¿Ya o lo movemos un poco?`
      : `Te acordaba de «${short}». ¿Ya o lo movemos un poco?`
  }
  return `Tenías un recordatorio por aquí. ¿Lo damos por hecho o lo movemos un rato?`
}
