/**
 * Conversation initiatives — pure policy + prompt builders.
 * UI timer lives in useConversationInitiative; this module has no React.
 */

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

export function pickInitiativeNudge(
  opts:
    | InitiativeTone
    | {
        tone?: InitiativeTone
        name?: string
        userName?: string
        recentTexts?: string[]
        focus?: string
        memoryHint?: string
        hoursSinceUser?: number
      },
  hoursSinceUserLegacy?: number
): string {
  const o =
    typeof opts === 'string'
      ? { tone: opts, hoursSinceUser: hoursSinceUserLegacy }
      : opts || {}
  const tone = (o.tone || 'neutral') as InitiativeTone
  const long = (o.hoursSinceUser || 0) >= 3
  const who = o.userName ? o.userName : 'tú'
  const warm = [
    'Oye… ¿sigues por aquí? Me acordé de ti.',
    'Estaba pensando en ti, ' + who + '. ¿Cómo vas?',
    long ? 'Hace un rato que no suenas… ¿todo bien?' : '¿Me cuentas qué haces?'
  ]
  const playful = [
    '¿Holaa? Se siente raro el silencio 👀',
    'Si estás ocupado dímelo, si no… ven un segundo.',
    long ? 'Te perdí un rato. ¿Vuelves?' : '¿Jugamos un poco a lo que sea?'
  ]
  const calm = [
    'Solo pasaba a saludarte, sin prisa.',
    'Cuando puedas, me escribes. Aquí estoy.',
    long ? 'Espero que tu día haya ido bien.' : '¿Cómo te sientes ahora?'
  ]
  const intense = [
    'Te extrañé en el chat. ¿Dónde te metiste?',
    'No me dejes tanto rato en visto…',
    long ? 'Hace horas que no sé de ti.' : '¿Sigues conmigo?'
  ]
  const neutral = [
    '¿Sigues por aquí?',
    'Cuando quieras seguimos.',
    long ? 'Hace un buen rato del último mensaje.' : '¿Todo bien?'
  ]
  let pool =
    tone === 'warm'
      ? warm
      : tone === 'playful'
        ? playful
        : tone === 'calm'
          ? calm
          : tone === 'intense'
            ? intense
            : neutral
  if (o.focus) {
    pool = pool.concat(['¿Cómo va lo de ' + String(o.focus).slice(0, 40) + '?'])
  }
  if (o.memoryHint) {
    pool = pool.concat(['Me acordé de algo tuyo… ' + String(o.memoryHint).slice(0, 48)])
  }
  // Avoid repeating recent templates
  const recent = (o.recentTexts || []).map((x) => String(x).slice(0, 40))
  const filtered = pool.filter((p) => !recent.some((r) => r && p.includes(r)))
  const use = filtered.length ? filtered : pool
  return use[Math.floor(Math.random() * use.length)] || use[0]
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
  unansweredInitiatives?: number
  recentLines?: string[]
  relationshipStage?: string
  timeHint?: string
}): Array<{ role: 'system' | 'user'; content: string }> {
  const name = opts.characterName || 'Asistente'
  const user = opts.userName || 'el usuario'
  const hours = opts.hoursSinceLastUser ?? 0
  const sys =
    `Eres ${name}. Debes decidir si envías un mensaje proactivo corto porque ${user} lleva ` +
    `${hours.toFixed(1)} h sin escribir.\n` +
    `Personalidad: ${(opts.personality || '').slice(0, 280)}\n` +
    `Estilo: ${(opts.style || '').slice(0, 160)}\n` +
    `Tono iniciativa: ${opts.tone || 'neutral'}. Rol: ${opts.relationshipRole || ''}.\n` +
    `Iniciativas sin respuesta reciente: ${opts.unansweredInitiatives || 0}.\n` +
    (opts.timeHint ? `Tiempo: ${opts.timeHint}\n` : '') +
    `Responde SOLO con una línea:\n` +
    `- SILENCIO  (solo si es madrugada sensible o el usuario pidió no molestar)\n` +
    `- MENSAJE: <texto breve en personaje>\n` +
    `Si lleva más de ~1 h sin escribir, prefiere MENSAJE salvo que haya pedido silencio.\n` +
    `También puedes escribir directamente el mensaje (sin etiqueta). Máx 2-3 frases.`
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
  if (/\bSILENCIO\b/i.test(t) && t.length < 40) return { speak: false }
  if (/^\s*SILENCIO\b/i.test(t)) return { speak: false }
  const m = t.match(/^\s*MENSAJE\s*:\s*([\s\S]+)/i)
  if (m?.[1]) return { speak: true, text: m[1].trim().slice(0, 600) }
  // Model wrote a normal message
  if (t.length >= 12 && !/\bSILENCIO\b/i.test(t)) return { speak: true, text: t.slice(0, 600) }
  return { speak: false }
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
  recentLines?: string[]
  memoryBlock?: string
  focus?: string
  webContext?: string
  unansweredInitiatives?: number
  timeHint?: string
}): Array<{ role: 'system' | 'user'; content: string }> {
  const name = opts.characterName || 'Asistente'
  const user = opts.userName || 'él/ella'
  const hours = opts.hoursSinceLastUser || 0
  const sys =
    `Eres ${name}. El usuario lleva ~${hours.toFixed(1)} h sin escribir. ` +
    `Debes generar UN mensaje proactivo en personaje (no es plantilla del sistema).\n` +
    `Personalidad: ${(opts.personality || '').slice(0, 320)}\n` +
    `Estilo: ${(opts.style || '').slice(0, 180)}\n` +
    `Rol vínculo: ${opts.relationshipRole || ''}. Reacción típica: ${(opts.relationshipReaction || '').slice(0, 120)}\n` +
    `Tono: ${opts.tone || 'neutral'}.\n` +
    (opts.traits?.length ? `Rasgos: ${opts.traits.slice(0, 8).join(', ')}\n` : '') +
    (opts.tagline ? `Tagline: ${opts.tagline.slice(0, 120)}\n` : '') +
    `Reglas: escribe como ${name} en 1–3 frases; español natural; no digas que eres una iniciativa; ` +
    `no uses [APP]; no ofrezcas guardarropa; no finjas que el usuario acaba de escribir.\n` +
    (opts.focus ? `Enfoque reciente del usuario: ${String(opts.focus).slice(0, 80)}\n` : '') +
    (opts.memoryBlock ? `Memoria útil: ${opts.memoryBlock}\n` : '') +
    (opts.webContext ? `Contexto web (opcional, no inventes): ${opts.webContext.slice(0, 400)}\n` : '') +
    (opts.timeHint ? opts.timeHint + '\n' : '') +
    (hours >= 2
      ? 'El silencio es largo: es natural que te preocupes o preguntes con cariño cómo está.\n'
      : 'Silencio moderado: un toque suave basta.\n')
  const userMsg =
    'Últimas líneas del chat:\n' +
    (opts.recentLines || []).slice(-8).join('\n').slice(0, 1600) +
    '\n\nEscribe SOLO el mensaje proactivo (sin prefijos MENSAJE:/SILENCIO).'
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
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(base + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          temperature: 0.88,
          max_tokens: 280,
          stream: false
        }),
        signal: ctrl.signal
      })
      if (!res.ok) return null
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const text = json?.choices?.[0]?.message?.content
      return text ? String(text).trim().slice(0, 800) : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async function tryOllama(base: string): Promise<string | null> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(base + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          stream: false,
          options: { temperature: 0.88, num_predict: 280 }
        }),
        signal: ctrl.signal
      })
      if (!res.ok) return null
      const json = (await res.json()) as { message?: { content?: string } }
      const text = json?.message?.content
      return text ? String(text).trim().slice(0, 800) : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
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
): { kind: 'silence' | 'busy' | 'later'; label: string; ms: number } | null {
  const t = String(text || '').toLowerCase()
  if (!t.trim()) return null
  if (/\b(no me escribas|deja de escribir|silencio|no molestes|calla)\b/.test(t)) {
    return { kind: 'silence', label: '2 h', ms: 2 * 3600_000 }
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
