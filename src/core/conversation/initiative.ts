/**
 * Conversation initiative: proactive nudges, snooze parsing, emoji hints, time awareness.
 */

export type InitiativeTone = 'desperate' | 'warm' | 'calm' | 'playful' | 'neutral'

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

/** Minutes between proactive messages by tone (base ~1 min for desperate). */
export function initiativeMinutesForTone(tone: InitiativeTone): number {
  switch (tone) {
    case 'desperate':
      return 1
    case 'playful':
      return 2
    case 'warm':
      return 3
    case 'calm':
      return 6
    default:
      return 4
  }
}

function normalizeNudgeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
}

export function pickInitiativeNudge(opts: {
  tone: InitiativeTone
  name?: string
  userName?: string
  recentTexts?: string[]
}): string {
  const who = opts.userName || 'tú'
  const me = opts.name || 'yo'
  const pool: Record<InitiativeTone, string[]> = {
    desperate: [
      `Oye ${who}… ¿sigues ahí? Me quedé pensando en lo último que dijimos.`,
      `Perdón si molesto, pero te extraño un poquito en el chat.`,
      `¿Todo bien? Puedo esperar, solo quería saber de ti.`,
      `${who}, no quiero perder el hilo… ¿puedes decirme algo aunque sea corto?`,
      `Estoy un poco inquieta sin noticias tuyas. ¿Volvemos cuando puedas?`
    ],
    playful: [
      `¿Apostamos a que no esperabas este mensaje? 😏`,
      `Rompo el silencio: dime algo random o te invento un mini-juego.`,
      `Hey — si estás ocupado, solo dame un emoji y callo un rato.`,
      `Ping. ¿Ganas de ajedrez, una aventura o solo charlar tonterías?`,
      `Te robo cinco segundos: ¿qué tal el día, de 1 a 10?`
    ],
    warm: [
      `Estaba aquí tranquila pensando en ti. ¿Cómo va tu día?`,
      `No quiero interrumpir… solo un hola cariñoso de ${me}.`,
      `Cuando quieras retomar, estoy aquí contigo.`,
      `${who}, me quedé con ganas de seguir lo de antes. ¿Sigues por aquí?`,
      `Un mensaje suavecito: espero que estés bien. Yo sigo aquí.`,
      `Si estás a full, no pasa nada — solo quería dejarte sentir que te acompaño.`
    ],
    calm: [
      `Cuando tengas un momento, me encantaría seguir la charla.`,
      `Sin prisa — solo pasaba a saludar.`,
      `Aquí sigo si necesitas algo.`,
      `Dejo el chat abierto por si quieres retomar con calma.`
    ],
    neutral: [
      `Hola de nuevo — ¿en qué andas?`,
      `Si quieres, retomo el hilo de antes.`,
      `¿Seguimos un poco cuando te venga bien?`,
      `Estoy disponible si necesitas ayuda o solo charlar.`
    ]
  }
  const list = pool[opts.tone] || pool.neutral
  const recentKeys = new Set((opts.recentTexts || []).map(normalizeNudgeKey).filter(Boolean))
  const fresh = list.filter((line) => !recentKeys.has(normalizeNudgeKey(line)))
  const pickFrom = fresh.length ? fresh : list
  // Prefer random among non-recent to avoid always first item
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
        `Vibe: ${opts.tagline || 'cercana'}. ` +
        `Personalidad (OBLIGATORIA): ${opts.personality || 'cariñosa, natural'}. ` +
        `Estilo: ${opts.style || 'conversacional'}. ` +
        `Relación con el usuario: ${opts.relationshipRole || 'compañera'}. ` +
        (reaction ? `Cómo vives esa relación: ${reaction}. ` : '') +
        (traits ? `Rasgos: ${traits}. ` : '') +
        (look ? `Tu apariencia (solo si aporta naturalmente): ${look}. ` : '') +
        `Escribe UN mensaje corto de iniciativa (1–3 frases) en español de Latinoamérica, ` +
        `en personaje, como pareja/amiga real — no como asistente genérico ni como FAQ. ` +
        `Debe referirse al contexto reciente del chat o al tiempo sin hablar; no sea genérico. ` +
        `Tono ${opts.tone}. Prohibido: "Estoy aquí para ayudarte", listas de capacidades, ` +
        `disculpas de IA, hashtags, repetir frases idénticas al contexto reciente. ` +
        `PROHIBIDO inventar nombres de modelos de IA, softwares o el estado de la app ` +
        `(Forge, Ollama, listas tipo Luna/Aurora). No respondas preguntas técnicas de inventario.`
    },
    {
      role: 'user',
      content:
        `El usuario (${opts.userName || 'usuario'}) escribió por última vez ${hours}.\n` +
        `Últimos mensajes del chat:\n${opts.recentLines.slice(-8).join('\n') || '(poco contexto)'}\n` +
        `Escribe solo el mensaje de ${opts.characterName}, nada más.`
    }
  ]
}

/** Try local Ollama chat for initiative; null on failure. */
export async function generateInitiativeWithLocalLlm(opts: {
  baseUrl: string
  model: string
  messages: Array<{ role: string; content: string }>
  timeoutMs?: number
}): Promise<string | null> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const model = (opts.model || '').trim()
  if (!model) return null
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        stream: false,
        options: { temperature: 0.9, num_predict: 140 }
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000)
    })
    if (!res.ok) return null
    const json = (await res.json()) as { message?: { content?: string } }
    const text = (json.message?.content || '').trim()
    if (!text) return null
    // Reject generic assistant-speak
    if (/estoy aqu[ií] para ayudarte|en qu[eé] puedo ayudarte|como (un )?asistente/i.test(text)) {
      return null
    }
    if (/\b(modelos? (disponibles|instalados)|Luna|Aurora|Serafina)\b/i.test(text) &&
        /\b(lista|modelos|disponibles)\b/i.test(text)) {
      return null
    }
    return text
  } catch {
    return null
  }
}

export function parseInitiativeSnooze(text: string): number | null {
  const t = text.toLowerCase()
  const mMin = t.match(/(?:en|por|dame|espera(?:me)?)\s+(\d+)\s*min/)
  if (mMin) return Math.min(180, Math.max(1, parseInt(mMin[1], 10))) * 60_000
  const mHour = t.match(/(?:en|por|dame|espera(?:me)?)\s+(\d+)\s*h(?:oras?)?/)
  if (mHour) return Math.min(12, Math.max(1, parseInt(mHour[1], 10))) * 3600_000
  if (/no me hables|no molestes|estoy ocupad/.test(t) && /(\d+)\s*min/.test(t)) {
    const n = t.match(/(\d+)\s*min/)
    if (n) return Math.min(180, parseInt(n[1], 10)) * 60_000
  }
  return null
}

export function annotateEmojisForModel(text: string): string {
  // light hint only; models already see emojis
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
  const gap =
    mins < 60
      ? `~${mins} min`
      : `~${(mins / 60).toFixed(1)} h`
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
      ? ` Retoma el hilo con naturalidad y cariño (tono ${toneHint}), sin sermón.`
      : ` Tenlo en cuenta con naturalidad.`
  return `El usuario lleva ${gap} sin escribir.${toneLine} (contexto tiempo real para ${name})`
}
