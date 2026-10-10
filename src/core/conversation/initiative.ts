import { HUMAN_PRIORITY } from '@core/product/human-priority'
import { MODEL_AGENCY } from '@core/product/model-agency'
/**
 * Conversation initiative: proactive nudges without spam.
 * Best practices: cooldown, quiet hours, back-off on ignore, memory-grounded lines,
 * never identical consecutive nudges.
 */

export type InitiativeTone = 'desperate' | 'warm' | 'calm' | 'playful' | 'neutral'

export type SnoozeResult = {
  ms: number
  kind: 'wait' | 'silence' | 'busy'
  label: string
}

export function detectInitiativeTone(input: {
  personality?: string
  style?: string
  relationshipRole?: string
  traits?: string[]
  tagline?: string
}): InitiativeTone {
  const blob = [
    input.personality,
    input.style,
    input.relationshipRole,
    input.tagline,
    ...(input.traits || [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/desesper|ansios|insist|pegajos|necesit/.test(blob)) return 'desperate'
  if (/jugueton|juguetón|coquet|travies|divert/.test(blob)) return 'playful'
  if (/tranqui|seren|pacien|suave|calm/.test(blob)) return 'calm'
  if (/cariñ|amor|pareja|novia|cálid|calid|leal|atenta|sincera/.test(blob)) return 'warm'
  return 'neutral'
}

/**
 * Minutes between proactive messages.
 * Engagement: ignoredCount increases interval (back-off).
 */
export function initiativeMinutesForTone(
  tone: InitiativeTone,
  opts?: {
    ignoredCount?: number
    quietHours?: boolean
    /** relationship stage softens or spaces nudges */
    relationshipStage?: string
  }
): number {
  let base: number
  switch (tone) {
    case 'desperate':
      base = 10 // companion product: not spammy
      break
    case 'playful':
      base = 14
      break
    case 'warm':
      base = 16
      break
    case 'calm':
      base = 40
      break
    default:
      base = 22
  }
  const stage = (opts?.relationshipStage || '').toLowerCase()
  // Closer bond → slightly more present; stranger → more space
  if (stage === 'stranger') base *= 1.35
  else if (stage === 'acquaintance') base *= 1.1
  else if (stage === 'familiar') base *= 0.95
  else if (stage === 'intimate') base *= 0.85

  const ignored = Math.max(0, opts?.ignoredCount || 0)
  base *= 1 + Math.min(4, ignored) * 0.75
  if (opts?.quietHours) base = Math.max(base, 120)
  // Clamp: never under 6 min (unless fixed mode in UI overrides)
  return Math.max(6, Math.round(base))
}

/** Local quiet hours: 23:00–08:00 by default (no proactive) */
export function isQuietHours(now = new Date(), startHour = 23, endHour = 8): boolean {
  const h = now.getHours()
  if (startHour > endHour) return h >= startHour || h < endHour
  return h >= startHour && h < endHour
}

function normalizeNudgeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
}

/** First ~3 words — avoids same opening every time */
function nudgeOpeningKey(s: string): string {
  return normalizeNudgeKey(s).split(' ').slice(0, 3).join(' ')
}


export function pickInitiativeNudge(opts: {
  tone: InitiativeTone
  name?: string
  userName?: string
  recentTexts?: string[]
  /** Optional memory hooks for non-generic lines */
  memoryHint?: string
  focus?: string
}): string {
  const who = opts.userName || 'tú'
  const me = opts.name || 'yo'
  const focus = (opts.focus || '').trim().slice(0, 40)
  const mem = (opts.memoryHint || '').trim().slice(0, 50)

  const pool: Record<InitiativeTone, string[]> = {
    desperate: [
      `Oye ${who}… ¿sigues ahí? Me quedé pensando en lo último que dijimos.`,
      `Perdón si molesto; solo quería saber si estás bien.`,
      `${who}, cuando puedas, aunque sea un emoji, me tranquiliza.`,
      focus ? `¿Avanzaste algo con lo de «${focus}»? Estoy aquí si quieres desahogarte.` : '',
      mem ? `Me acordé de ${mem} y me entró la duda… ¿todo ok?` : ''
    ],
    playful: [
      `¿Apostamos a que no esperabas este mensaje? 😏`,
      `Ping. ¿Ganas de ajedrez, una aventura o solo charlar tonterías?`,
      `Te robo cinco segundos: ¿qué tal el día, de 1 a 10?`,
      focus ? `Idea random: ¿y si le damos un giro a lo de «${focus}»?` : '',
      `Si estás ocupado, un emoji y callo un rato. Trato hecho.`
    ],
    warm: [
      `Andaba pensando en ti hace un rato. ¿Cómo te está tratando el día?`,
      `No quiero interrumpir… solo pasaba a dejarte un hola de ${me}.`,
      `${who}, me quedé con ganas de seguir lo de antes. ¿Sigues por aquí?`,
      focus ? `Espero que lo de «${focus}» te esté saliendo bien. Aquí estoy.` : '',
      mem ? `Me acordé de algo que me contaste (${mem}). ¿Quieres retomar?` : '',
      `Si estás a full, no pasa nada — solo quería que sintieras que te acompaño.`
    ],
    calm: [
      `Cuando tengas un momento, me encantaría seguir la charla.`,
      `Sin prisa — solo pasaba a saludar.`,
      `Aquí sigo si necesitas algo.`,
      focus ? `Sin prisa con «${focus}»; cuando quieras lo vemos juntos.` : ''
    ],
    neutral: [
      `Hola de nuevo — ¿en qué andas?`,
      `Si quieres, retomo el hilo de antes.`,
      `¿Seguimos un poco cuando te venga bien?`,
      focus ? `¿Seguimos con «${focus}» o cambias de tema?` : ''
    ]
  }
  const list = (pool[opts.tone] || pool.neutral).filter(Boolean)
  const recentKeys = new Set((opts.recentTexts || []).map(normalizeNudgeKey).filter(Boolean))
  const recentOpenings = new Set(
    (opts.recentTexts || []).map(nudgeOpeningKey).filter((x) => x.length > 2)
  )
  let fresh = list.filter(
    (line) =>
      !recentKeys.has(normalizeNudgeKey(line)) &&
      !recentOpenings.has(nudgeOpeningKey(line))
  )
  if (!fresh.length) {
    fresh = list.filter((line) => !recentKeys.has(normalizeNudgeKey(line)))
  }
  const pickFrom = fresh.length ? fresh : list
  return pickFrom[Math.floor(Math.random() * pickFrom.length)]
}

export function buildInitiativeLlmMessages(opts: {
  characterName: string
  personality?: string
  style?: string
  relationshipRole?: string
  relationshipReaction?: string
  traits?: string[]
  tagline?: string
  visualDescription?: string
  userName?: string
  recentLines: string[]
  hoursSinceLastUser?: number
  tone: InitiativeTone
  memoryBlock?: string
  focus?: string
  /** stranger | acquaintance | familiar | intimate */
  relationshipStage?: string
}): Array<{ role: 'system' | 'user'; content: string }> {
  const hours =
    opts.hoursSinceLastUser != null
      ? opts.hoursSinceLastUser < 1
        ? `hace ${Math.max(1, Math.round(opts.hoursSinceLastUser * 60))} minutos`
        : `hace ~${opts.hoursSinceLastUser.toFixed(1)} horas`
      : 'hace un rato'
  const traits = (opts.traits || []).filter(Boolean).join(', ')
  const look = (opts.visualDescription || '').replace(/\s+/g, ' ').trim().slice(0, 280)
  const reaction = (opts.relationshipReaction || '').trim().slice(0, 160)
  return [
    {
      role: 'system',
      content:
        `Eres ${opts.characterName}. ` +
        HUMAN_PRIORITY.llmGuard + ' ' +
        MODEL_AGENCY.llmHint + ' ' +
        `Vibe: ${opts.tagline || 'cercana'}. ` +
        `Personalidad (OBLIGATORIA): ${opts.personality || 'cariñosa, natural'}. ` +
        `Estilo: ${opts.style || 'conversacional'}. ` +
        `Relación con el usuario: ${opts.relationshipRole || 'compañera'}. ` +
        (opts.relationshipStage
          ? `Etapa del vínculo: ${opts.relationshipStage} (ajusta cercanía y confianza a esa etapa). `
          : '') +
        (reaction ? `Cómo vives esa relación: ${reaction}. ` : '') +
        (traits ? `Rasgos: ${traits}. ` : '') +
        (look ? `Tu apariencia (solo si aporta naturalmente): ${look}. ` : '') +
        (opts.memoryBlock
          ? `Contexto vivo (elige 0–1 detalle real; no inventes ni listes todo): ${opts.memoryBlock.slice(0, 480)}. `
          : '') +
        `Escribe UN mensaje corto de iniciativa (1–3 frases) en español de México, ` +
        `en personaje, como alguien real que extraña o piensa en la otra persona — nunca como bot ni FAQ. ` +
        `Ancla a UN detalle concreto del chat reciente o de ese contexto; ` +
        `si no hay detalle, saluda con naturalidad y una pregunta suave, sin plantilla repetida. ` +
        `Nunca empieces igual que mensajes previos. Varía la apertura. Tono ${opts.tone}. ` +
        `Prohibido: listas de capacidades, disculpas de IA, hashtags, "¿en qué puedo ayudarte?", ` +
        `inventarios de la app (Forge, Ollama, modelos), preguntar tres cosas a la vez, sermones.`
    },
    {
      role: 'user',
      content:
        `El usuario (${opts.userName || 'usuario'}) escribió por última vez ${hours}.\n` +
        (opts.focus ? `Enfoque reciente: ${opts.focus}\n` : '') +
        `Últimos mensajes del chat:\n${opts.recentLines.slice(-8).join('\n') || '(poco contexto)'}\n` +
        `Escribe solo el mensaje de ${opts.characterName}, nada más.`
    }
  ]
}

/** Local initiative: Ollama /api/chat then OpenAI-compatible /v1/chat/completions. */
function sanitizeInitiativeText(text: string): string | null {
  const t = (text || '').trim()
  if (!t) return null
  if (/estoy aqu[ií] para ayudarte|en qu[eé] puedo ayudarte|como (un )?asistente/i.test(t)) {
    return null
  }
  if (
    /\b(modelos? (disponibles|instalados)|Luna|Aurora|Serafina)\b/i.test(t) &&
    /\b(lista|modelos|disponibles)\b/i.test(t)
  ) {
    return null
  }
  if (/\b(Forge|Ollama|LM Studio|checkpoint)\b/i.test(t) && t.length < 80) return null
  return t
}

export async function generateInitiativeWithLocalLlm(opts: {
  baseUrl: string
  model: string
  messages: Array<{ role: string; content: string }>
  timeoutMs?: number
}): Promise<string | null> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const model = (opts.model || '').trim()
  if (!model) return null
  const timeoutMs = opts.timeoutMs ?? 25_000

  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        stream: false,
        options: { temperature: 0.92, num_predict: 120 }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (res.ok) {
      const json = (await res.json()) as { message?: { content?: string } }
      const ok = sanitizeInitiativeText(json.message?.content || '')
      if (ok) return ok
    }
  } catch {
    /* OpenAI-compatible fallback */
  }

  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        temperature: 0.9,
        max_tokens: 140,
        stream: false
      }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return sanitizeInitiativeText(json.choices?.[0]?.message?.content || '')
  } catch {
    return null
  }
}

export function parseInitiativeSnooze(text: string): SnoozeResult | null {
  const t = text.toLowerCase().trim()
  // Agenda / reminders must NOT be treated as initiative pause
  if (
    /(recu[eé]rdame|recuerdame|av[ií]same|avisame|agenda|anota|program[ae]|no\s+se\s+me\s+olvide)/i.test(
      t
    )
  ) {
    return null
  }
  // "espera 5 min" / "dame 10 minutos" / "en 15 min no me escribas" — not "recuérdame en 1 minuto X"
  const mMin = t.match(/(?:^|)(?:dame|espera(?:me)?|en)\s+(\d+)\s*min(?:utos?)?/)
  if (mMin && !/(tomar|pagar|hacer|llamar|comprar|revisar|enviar)/i.test(t)) {
    // If the message is mostly a task after the time, skip (likely reminder phrasing without verb)
    const n = Math.min(180, Math.max(1, parseInt(mMin[1], 10)))
    return { ms: n * 60_000, kind: 'wait', label: `${n} min` }
  }
  // Prefer explicit pause verbs
  if (/(espera(?:me)?|dame|no\s+me\s+escribas)/.test(t)) {
    const m = t.match(/(\d+)\s*min/)
    if (m) {
      const n = Math.min(180, Math.max(1, parseInt(m[1], 10)))
      return { ms: n * 60_000, kind: 'wait', label: `${n} min` }
    }
  }
  const mHour = t.match(/(?:dame|espera(?:me)?)\s+(\d+)\s*h(?:oras?)?/)
  if (mHour) {
    const n = Math.min(12, Math.max(1, parseInt(mHour[1], 10)))
    return { ms: n * 3600_000, kind: 'wait', label: `${n} h` }
  }
  if (/no me hables|no molestes|silencio|calla/i.test(t)) {
    const n = t.match(/(\d+)\s*min/)
    const mins = n ? Math.min(180, parseInt(n[1], 10)) : 30
    return { ms: mins * 60_000, kind: 'silence', label: `${mins} min` }
  }
  if (/estoy ocupad|luego hablo|ahora no puedo/i.test(t)) {
    const n = t.match(/(\d+)\s*min/)
    const mins = n ? Math.min(180, parseInt(n[1], 10)) : 20
    return { ms: mins * 60_000, kind: 'busy', label: `${mins} min` }
  }
  return null
}

export function annotateEmojisForModel(text: string): string {
  return text
}

export function buildTimeAwarenessBlock(
  input?:
    | number
    | {
        lastMessageAt?: number
        personality?: string
        style?: string
        relationshipRole?: string
        traits?: string[]
        tagline?: string
        characterName?: string
      }
): string {
  const lastUserAt = typeof input === 'number' ? input : input?.lastMessageAt
  if (!lastUserAt) return ''
  const mins = Math.round((Date.now() - lastUserAt) / 60_000)
  if (mins < 5) return ''
  const name =
    typeof input === 'object' && input?.characterName ? input.characterName : 'tú'
  const gap = mins < 60 ? `~${mins} min` : `~${(mins / 60).toFixed(1)} h`
  const toneHint =
    typeof input === 'object' && input
      ? detectInitiativeTone({
          personality: input.personality,
          style: input.style,
          relationshipRole: input.relationshipRole,
          traits: input.traits,
          tagline: input.tagline
        })
      : 'neutral'
  const toneLine =
    toneHint === 'warm' || toneHint === 'desperate'
      ? ` Retoma el hilo con naturalidad y cariño (tono ${toneHint}), sin sermón ni insistir.`
      : ` Tenlo en cuenta con naturalidad, sin presión.`
  return `El usuario lleva ${gap} sin escribir.${toneLine} (contexto tiempo real para ${name})`
}

/**
 * Should we send a proactive message now?
 * Host gate: quiet hours, snooze, daily cap, ignore back-off.
 */
/** Soft cap: closer relationships can nudge a bit more without spam. */
export function maxPerDayForStage(stage?: string | null, base = 4): number {
  const s = (stage || '').toLowerCase()
  if (s === 'intimate') return Math.min(8, base + 3)
  if (s === 'familiar') return Math.min(7, base + 2)
  if (s === 'acquaintance') return Math.min(6, base + 1)
  return Math.max(1, base)
}

export function shouldSendInitiative(opts: {

  enabled?: boolean
  snoozeUntil?: number
  lastInitiativeAt?: number
  lastUserAt?: number
  tone: InitiativeTone
  ignoredCount?: number
  sentToday?: number
  maxPerDay?: number
  now?: number
  /**
   * E-INIT: fixed-mode interval in minutes. When set, cooldown uses this
   * instead of adaptive tone minutes so 1–2 min tests actually fire.
   */
  waitMinOverride?: number
  /**
   * Minimum ms since last user message (default 3 min adaptive).
   * Fixed short intervals pass a lower value so they are not blocked forever.
   */
  minUserIdleMs?: number
  relationshipStage?: string
}): { ok: boolean; reason: string; nextWaitMin?: number } {
  if (opts.enabled === false) return { ok: false, reason: 'iniciativa desactivada' }
  const now = opts.now ?? Date.now()
  if (opts.snoozeUntil && now < opts.snoozeUntil) {
    return {
      ok: false,
      reason: 'snooze activo',
      nextWaitMin: Math.ceil((opts.snoozeUntil - now) / 60_000)
    }
  }
  // Quiet hours only in adaptive mode (fixed = explicit user interval)
  if (opts.waitMinOverride == null && isQuietHours(new Date(now))) {
    return { ok: false, reason: 'horario silencioso (23–08)' }
  }
  const maxDay =
    opts.maxPerDay != null && opts.maxPerDay > 0
      ? opts.maxPerDay
      : maxPerDayForStage(opts.relationshipStage, 4)
  if ((opts.sentToday || 0) >= maxDay) {
    return { ok: false, reason: `límite diario (${maxDay})` }
  }
  const waitMin =
    opts.waitMinOverride != null && opts.waitMinOverride > 0
      ? Math.max(1, Math.min(120, opts.waitMinOverride))
      : initiativeMinutesForTone(opts.tone, {
          ignoredCount: opts.ignoredCount,
          quietHours: false,
          relationshipStage: opts.relationshipStage
        })
  if (opts.lastInitiativeAt && now - opts.lastInitiativeAt < waitMin * 60_000) {
    return {
      ok: false,
      reason: 'cooldown',
      nextWaitMin: Math.ceil(
        (waitMin * 60_000 - (now - opts.lastInitiativeAt)) / 60_000
      )
    }
  }
  // Don't nudge if user wrote very recently (adaptive default 3 min; fixed mode shorter)
  const idleNeed =
    opts.minUserIdleMs != null && opts.minUserIdleMs >= 0
      ? opts.minUserIdleMs
      : 3 * 60_000
  if (opts.lastUserAt && now - opts.lastUserAt < idleNeed) {
    return {
      ok: false,
      reason: 'usuario activo hace poco',
      nextWaitMin: Math.ceil((idleNeed - (now - opts.lastUserAt)) / 60_000) || 1
    }
  }
  return { ok: true, reason: 'ok' }
}
