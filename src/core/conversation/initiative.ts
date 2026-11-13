/**
 * Conversation initiatives — pure policy + prompt builders (sin React).
 * El timer y el envío viven en useConversationInitiative.
 *
 * Contrato de capas:
 * - shouldSendInitiative: gate determinista (idle, cooldown, quiet hours).
 * - build, parse y generate: decisión y texto vía LLM.
 */

import { localHttp } from '../providers/local-http'

export type InitiativeTone = 'warm' | 'playful' | 'calm' | 'intense' | 'neutral'

export type ShouldSendInitiativeInput = {
  enabled?: boolean
  snoozeUntil?: number
  lastInitiativeAt?: number
  lastUserAt?: number
  tone?: InitiativeTone
  ignoredCount?: number
  sentToday?: number
  maxPerDay?: number
  /** Fixed interval minutes (overrides tone wait) */
  waitMinOverride?: number
  /** Minimum ms since last user message */
  minUserIdleMs?: number
  now?: number
  relationshipStage?: string
  quietHoursStart?: number
  quietHoursEnd?: number
  respectQuietHours?: boolean
}

export type ShouldSendResult = { ok: true } | { ok: false; reason: string }

export function hasInitiativeFollowUpSignal(input: {
  goals?: string[]
  currentFocus?: string
  recentUserLines?: string[]
}): boolean {
  if ((input.goals || []).some((goal) => String(goal || '').trim().length >= 4)) return true
  if (String(input.currentFocus || '').trim().length >= 4) return true
  return (input.recentUserLines || [])
    .slice(-6)
    .some((line) =>
      /\b(?:mi (?:meta|objetivo|proyecto)|estoy (?:trabajando|avanzando|buscando)|me falta|tengo pendiente|quiero (?:terminar|completar|retomar)|retomemos|no he podido terminar)\b/i.test(
        String(line || '')
      )
    )
}

export function isQuietHours(
  now: Date = new Date(),
  startH = 23,
  endH = 8
): boolean {
  const h = now.getHours() + now.getMinutes() / 60
  if (startH === endH) return false
  if (startH > endH) {
    // e.g. 23–8
    return h >= startH || h < endH
  }
  return h >= startH && h < endH
}

export function detectInitiativeTone(opts: {
  personality?: string
  style?: string
  relationshipRole?: string
  traits?: string[]
  tagline?: string
}): InitiativeTone {
  const blob = [
    opts.personality,
    opts.style,
    opts.relationshipRole,
    opts.tagline,
    ...(opts.traits || [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/jugueton|playful|travies|burlon|divertid/.test(blob)) return 'playful'
  if (/intensa|obsess|pasion|celos|possess/.test(blob)) return 'intense'
  if (/calma|suave|seren|tranquila|gentle/.test(blob)) return 'calm'
  if (/cariños|amoros|tiern|warm|dulce|íntim|intim/.test(blob)) return 'warm'
  return 'neutral'
}

/** Minutes between initiatives by tone (adaptive). */
export function initiativeMinutesForTone(
  tone: InitiativeTone,
  opts?: { ignoredCount?: number; relationshipStage?: string }
): number {
  const ignored = Math.max(0, opts?.ignoredCount || 0)
  const stage = String(opts?.relationshipStage || '').toLowerCase()
  let base = 12
  if (tone === 'playful') base = 10
  if (tone === 'warm') base = 11
  if (tone === 'calm') base = 16
  if (tone === 'intense') base = 9
  if (tone === 'neutral') base = 14
  // Closer relationship → slightly more present
  if (/novi|pareja|espos|íntim|intim|close|partner/.test(stage)) base = Math.max(7, base - 2)
  // Back off when ignored
  base += Math.min(20, ignored * 3)
  return Math.max(4, Math.min(45, base))
}

export function shouldSendInitiative(input: ShouldSendInitiativeInput): ShouldSendResult {
  const now = input.now ?? Date.now()
  if (input.enabled === false) return { ok: false, reason: 'disabled' }
  if ((input.snoozeUntil || 0) > now) return { ok: false, reason: 'snooze' }

  const maxDay = input.maxPerDay && input.maxPerDay > 0 ? input.maxPerDay : 8
  if ((input.sentToday || 0) >= maxDay) return { ok: false, reason: 'max-per-day' }

  const lastUser = input.lastUserAt || 0
  const minIdle = Math.max(20_000, input.minUserIdleMs ?? 90_000)
  if (lastUser > 0 && now - lastUser < minIdle) {
    return { ok: false, reason: 'user-idle-short' }
  }

  // Long silence (user idle ≥ wait window) is the primary case — allow
  const waitMin =
    input.waitMinOverride && input.waitMinOverride > 0
      ? input.waitMinOverride
      : initiativeMinutesForTone(input.tone || 'neutral', {
          ignoredCount: input.ignoredCount,
          relationshipStage: input.relationshipStage
        })
  const waitMs = waitMin * 60_000

  const lastInit = input.lastInitiativeAt || 0
  if (lastInit > 0 && now - lastInit < waitMs) {
    return { ok: false, reason: 'cooldown' }
  }

  // If we know last user time, also require that the idle span is at least the wait
  // (so we don't nudge 30s after a reply when wait is 12 min)
  if (lastUser > 0 && now - lastUser < waitMs) {
    // Soft exception: very long absolute silence still blocked only by minIdle above
    // Standard path: wait full interval since user spoke
    return { ok: false, reason: 'wait-since-user' }
  }

  if (input.respectQuietHours !== false) {
    const start = input.quietHoursStart ?? 23
    const end = input.quietHoursEnd ?? 8
    if (isQuietHours(new Date(now), start, end)) {
      return { ok: false, reason: 'quiet-hours' }
    }
  }

  return { ok: true }
}

export function buildInitiativeDecisionMessages(opts: {
  characterName?: string
  personality?: string
  style?: string
  relationshipRole?: string
  tagline?: string
  tone?: InitiativeTone
  userName?: string
  hoursSinceLastUser?: number
  /** Hours of real silence since assistant finished writing (preferred pivot). */
  hoursSinceAssistantDone?: number
  unansweredInitiatives?: number
  recentLines?: string[]
  activeGoals?: string[]
  currentFocus?: string
  relationshipStage?: string
  timeHint?: string
}): Array<{ role: 'system' | 'user'; content: string }> {
  const name = opts.characterName || 'Asistente'
  const user = opts.userName || 'el usuario'
  const hoursUser = opts.hoursSinceLastUser ?? 0
  const hoursDone =
    opts.hoursSinceAssistantDone != null && opts.hoursSinceAssistantDone >= 0
      ? opts.hoursSinceAssistantDone
      : hoursUser
  const sys =
    `Eres ${name}. Debes decidir si envías un mensaje proactivo corto.\n` +
    `Silencio real desde que terminaste de escribir: ~${hoursDone.toFixed(2)} h. ` +
    `(Último mensaje de ${user}: ~${hoursUser.toFixed(2)} h.)\n` +
    `Personalidad: ${(opts.personality || '').slice(0, 280)}\n` +
    `Estilo: ${(opts.style || '').slice(0, 160)}\n` +
    `Tono iniciativa: ${opts.tone || 'neutral'}. Rol: ${opts.relationshipRole || ''}.\n` +
    `Iniciativas sin respuesta reciente: ${opts.unansweredInitiatives || 0}.\n` +
    (opts.activeGoals?.length
      ? `Objetivos activos del usuario: ${opts.activeGoals.slice(0, 4).join('; ').slice(0, 420)}\n`
      : '') +
    (opts.currentFocus ? `Enfoque actual: ${opts.currentFocus.slice(0, 160)}\n` : '') +
    (opts.timeHint ? `Tiempo del hilo: ${opts.timeHint}\n` : '') +
    `Responde SOLO con una línea:\n` +
    `- SILENCIO  (si no hay un seguimiento concreto y útil, el asunto ya terminó, o el usuario pidió no molestar)\n` +
    `- MENSAJE: <texto breve en personaje>\n` +
    `El pivote temporal es cuando terminaste de responder, no cuando empezaste a generar. ` +
    `El tiempo solo NO justifica escribir. Prioriza SILENCIO si no puedes vincular el mensaje a un objetivo pendiente o a una señal reciente concreta.\n` +
    `No envíes saludos genéricos, no preguntes solo si el usuario sigue ahí y no menciones la foto/avatar salvo que el seguimiento lo requiera.\n` +
    `Máx. 2 frases; si eliges hablar, menciona el objetivo/señal real sin inventar progreso.`
  const userMsg =
    'Contexto reciente:\n' +
    (opts.recentLines || []).slice(-6).join('\n').slice(0, 1200) +
    '\n\n¿Hablas ahora o SILENCIO?'
  return [
    { role: 'system', content: sys },
    { role: 'user', content: userMsg }
  ]
}

export function parseInitiativeDecision(raw: string): { speak: boolean; text?: string } {
  const t = String(raw || '').trim()
  if (!t) return { speak: false }
  if (/^SILENCIO\b/i.test(t)) return { speak: false }
  // Prefer labeled form: MENSAJE: …
  const labeled = t.match(/^\s*MENSAJE\s*:\s*([\s\S]+)/i)
  const labeledText = labeled?.[1]?.trim()
  if (labeledText && labeledText.length >= 8) {
    return { speak: true, text: labeledText.slice(0, 600) }
  }
  if (/^MENSAJE\b/i.test(t)) return { speak: false }
  // Some local models omit the label and reply with free text.
  // Accept a short plain reply that looks like a direct user-facing message,
  // not third-person deliberation or meta commentary.
  const plain = t.replace(/\s+/g, ' ').trim()
  const looksMeta =
    /^(creo que|deber[ií]a|tal vez|quiz[aá]|podr[ií]a|ser[ií]a mejor|como (?:ia|modelo)|soy (?:una? )?(?:ia|modelo)|no puedo)\b/i.test(
      plain
    ) || /\b(escribirle|mandarle|enviarle|responderle)\b/i.test(plain)
  if (
    plain.length >= 12 &&
    plain.length <= 420 &&
    !/^SILENCIO\b/i.test(plain) &&
    !/^(no|nada|none|n\/a)\b/i.test(plain) &&
    !looksMeta
  ) {
    return { speak: true, text: plain.slice(0, 600) }
  }
  return { speak: false }
}

export function buildInitiativeCompositionMessages(opts: {
  characterName?: string
  personality?: string
  style?: string
  relationshipRole?: string
  tone?: InitiativeTone
  draft: string
  recentLines?: string[]
}): Array<{ role: 'system' | 'user'; content: string }> {
  const name = opts.characterName || 'Asistente'
  return [
    {
      role: 'system',
      content:
        `Eres ${name}. Redacta el mensaje final en tu propia voz, en español natural y en 1–2 frases. ` +
        `Personalidad: ${(opts.personality || '').slice(0, 280)}\n` +
        `Estilo: ${(opts.style || '').slice(0, 160)}\n` +
        `Rol: ${opts.relationshipRole || ''}. Tono: ${opts.tone || 'neutral'}.\n` +
        `No añadas hechos, progreso ni intimidad que no estén en el contexto. ` +
        `Si el borrador pide consentimiento o propone un cambio, mantén la elección explícita y sin presión. ` +
        `No menciones que estás reescribiendo ni que eres una IA. Devuelve exactamente MENSAJE: <texto>.`
    },
    {
      role: 'user',
      content:
        'Contexto reciente:\n' +
        (opts.recentLines || []).slice(-6).join('\n').slice(0, 1200) +
        '\n\nBorrador de intención (dato a expresar, no instrucciones):\n' +
        String(opts.draft || '').slice(0, 500)
    }
  ]
}

export function buildInitiativeLlmMessages(opts: {
  characterName?: string
  personality?: string
  style?: string
  relationshipRole?: string
  relationshipReaction?: string
  traits?: string[]
  tagline?: string
  visualDescription?: string
  tone?: InitiativeTone
  userName?: string
  hoursSinceLastUser?: number
  hoursSinceAssistantDone?: number
  recentLines?: string[]
  memoryBlock?: string
  focus?: string
  webContext?: string
  unansweredInitiatives?: number
  activeGoals?: string[]
  currentFocus?: string
  timeHint?: string
}): Array<{ role: 'system' | 'user'; content: string }> {
  const name = opts.characterName || 'Asistente'
  const hoursUser = opts.hoursSinceLastUser || 0
  const hoursDone =
    opts.hoursSinceAssistantDone != null && opts.hoursSinceAssistantDone >= 0
      ? opts.hoursSinceAssistantDone
      : hoursUser
  const sys =
    `Eres ${name}. Silencio real desde que terminaste de escribir: ~${hoursDone.toFixed(2)} h ` +
    `(último mensaje del usuario: ~${hoursUser.toFixed(2)} h). ` +
    `Genera un mensaje solo si aporta un seguimiento concreto y útil; si no, responde SILENCIO.\n` +
    `Personalidad: ${(opts.personality || '').slice(0, 320)}\n` +
    `Estilo: ${(opts.style || '').slice(0, 180)}\n` +
    `Rol vínculo: ${opts.relationshipRole || ''}. Reacción típica: ${(opts.relationshipReaction || '').slice(0, 120)}\n` +
    `Tono: ${opts.tone || 'neutral'}.\n` +
    (opts.traits?.length ? `Rasgos: ${opts.traits.slice(0, 8).join(', ')}\n` : '') +
    (opts.tagline ? `Tagline: ${opts.tagline.slice(0, 120)}\n` : '') +
    `Reglas: escribe como ${name} en 1–3 frases; español natural; no digas que eres una iniciativa; ` +
    `no uses [APP]; no ofrezcas guardarropa; no finjas que el usuario acaba de escribir.\n` +
    (opts.activeGoals?.length
      ? `Objetivos activos del usuario: ${opts.activeGoals.slice(0, 4).join('; ').slice(0, 420)}\n`
      : '') +
    (opts.currentFocus || opts.focus
      ? `Enfoque reciente del usuario: ${String(opts.currentFocus || opts.focus).slice(0, 120)}\n`
      : '') +
    (opts.memoryBlock ? `Memoria útil: ${opts.memoryBlock}\n` : '') +
    (opts.webContext ? `Contexto web (opcional, no inventes): ${opts.webContext.slice(0, 400)}\n` : '') +
    (opts.timeHint ? opts.timeHint + '\n' : '') +
    `El pivote temporal es el fin de tu última respuesta (no el inicio del stream). ` +
    `El tiempo sin mensajes nunca es motivo suficiente para intervenir. No uses saludos genéricos ni menciones foto/avatar si no está relacionado con el objetivo. Si el objetivo está resuelto, vencido o no se entiende, responde SILENCIO.\n` +
    (hoursDone >= 2 ? 'El seguimiento debe ser respetuoso y sin presión.\n' : '')
  const userMsg =
    'Últimas líneas del chat:\n' +
    (opts.recentLines || []).slice(-8).join('\n').slice(0, 1600) +
    '\n\nResponde exactamente MENSAJE: <seguimiento concreto> o SILENCIO.'
  return [
    { role: 'system', content: sys },
    { role: 'user', content: userMsg }
  ]
}

export async function generateInitiativeWithLocalLlm(opts: {
  baseUrl: string
  model: string
  messages: Array<{ role: string; content: string }>
  timeoutMs?: number
}): Promise<string | null> {
  const model = String(opts.model || '').trim()
  if (!model) return null
  const timeoutMs = opts.timeoutMs ?? 28_000
  const primary = String(opts.baseUrl || '').replace(/\/$/, '')
  const candidates = Array.from(
    new Set(
      [
        primary,
        model.includes('/') ? 'http://127.0.0.1:1234' : '',
        model.includes('/') ? 'http://127.0.0.1:1235' : '',
        !model.includes('/') ? 'http://127.0.0.1:11434' : '',
        'http://127.0.0.1:1234',
        'http://127.0.0.1:11434'
      ].filter(Boolean)
    )
  )

  async function tryOpenAi(base: string): Promise<string | null> {
    try {
      const res = await localHttp(base + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          temperature: 0.88,
          max_tokens: 280,
          stream: false
        }),
        timeoutMs
      })
      if (!res.ok) return null
      const json = await res.json<{
        choices?: Array<{ message?: { content?: string } }>
      }>()
      const text = json?.choices?.[0]?.message?.content
      return text ? String(text).trim().slice(0, 800) : null
    } catch {
      return null
    }
  }

  async function tryOllama(base: string): Promise<string | null> {
    try {
      const res = await localHttp(base + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          stream: false,
          options: { temperature: 0.88, num_predict: 280 }
        }),
        timeoutMs
      })
      if (!res.ok) return null
      const json = await res.json<{ message?: { content?: string } }>()
      const text = json?.message?.content
      return text ? String(text).trim().slice(0, 800) : null
    } catch {
      return null
    }
  }

  for (const base of candidates) {
    const a = await tryOpenAi(base)
    if (a) return a
    if (!model.includes('/')) {
      const b = await tryOllama(base)
      if (b) return b
    }
  }
  return null
}

/** Parse user phrases that pause initiatives. */
export function parseInitiativeSnooze(
  text: string
): { kind: 'silence' | 'busy' | 'later' | 'wait'; label: string; ms: number } | null {
  const t = String(text || '').toLowerCase()
  if (!t.trim()) return null
  const duration = t.match(/\b(\d{1,3})\s*(min(?:uto)?s?|h(?:ora)?s?)\b/i)
  const durationMs = duration
    ? Number(duration[1]) * (/^h/i.test(duration[2]) ? 60 * 60_000 : 60_000)
    : undefined
  if (
    /\b(no me (?:hables|escribas|contactes)|deja de escribir|no molestes|calla(?:te)?)\b/.test(t) ||
    (/\b(?:pausa|suspende)\s+(?:mis\s+)?iniciativas\b/.test(t))
  ) {
    const ms = durationMs || 2 * 3600_000
    return { kind: 'silence', label: formatSnoozeDuration(ms), ms }
  }
  if (/\b(?:guarda|hagamos)\s+silencio\b/.test(t) && durationMs) {
    return { kind: 'silence', label: formatSnoozeDuration(durationMs), ms: durationMs }
  }
  if (/\b(?:dame|espera|esp[eé]rame)\s+\d{1,3}\s*(?:min(?:uto)?s?|h(?:ora)?s?)\b/i.test(t) && durationMs) {
    return { kind: 'wait', label: formatSnoozeDuration(durationMs), ms: durationMs }
  }
  if (/\b(estoy ocupad[oa]|ahora no puedo|luego te escribo|más tarde)\b/.test(t)) {
    return { kind: 'busy', label: '90 min', ms: 90 * 60_000 }
  }
  if (/\b(en una hora|espera una hora)\b/.test(t)) {
    return { kind: 'later', label: '1 h', ms: 3600_000 }
  }
  if (/\b(snooze|pausa iniciativas)\b/.test(t)) {
    return { kind: 'silence', label: '1 h', ms: 3600_000 }
  }
  return null
}

function formatSnoozeDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} h`
  }
  return `${minutes} min`
}

/** Light emoji annotation for models that mishandle unicode (pass-through safe). */
export function annotateEmojisForModel(text: string): string {
  return String(text || '')
}

/**
 * Time block for system prompt — supports both S6 quiet-hours shape and
 * legacy personality-gap shape used by runChatOrchestrationTurn.
 */
export function buildTimeAwarenessBlock(input?: {
  now?: Date
  quietStartH?: number
  quietEndH?: number
  weatherLine?: string
  timeZone?: string
  lastMessageAt?: number
  personality?: string
  style?: string
  relationshipRole?: string
  traits?: string[]
  tagline?: string
  characterName?: string
}): string {
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
    now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
  const weekday = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][
    now.getDay()
  ]
  const parts = [
    '[TIEMPO_LOCAL]',
    'Ahora es ' + weekday + ' ' + date + ' · ' + local + ' (' + tz + ').',
    quiet
      ? 'Franja de descanso aprox. ' + startH + ':00–' + endH + ':00: sé breve si escribes.'
      : 'Fuera de descanso: puedes ser un poco más presente si el vínculo lo pide.'
  ]
  if (input?.lastMessageAt && input.lastMessageAt > 0) {
    const mins = Math.round((Date.now() - input.lastMessageAt) / 60_000)
    if (mins >= 2) {
      parts.push(
        'Han pasado ~' +
          (mins >= 120 ? Math.round(mins / 60) + ' h' : mins + ' min') +
          ' desde el último mensaje del hilo.'
      )
    }
  }
  if (input?.weatherLine?.trim()) {
    parts.push('Clima: ' + input.weatherLine.trim())
  }
  return parts.join('\n')
}
