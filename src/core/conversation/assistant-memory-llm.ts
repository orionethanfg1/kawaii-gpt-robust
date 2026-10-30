/**
 * LLM-assisted memory extraction (app as intermediary).
 * Heuristics stay high-precision / low-recall; the model proposes structured facts.
 * Never invent: only extract what the assistant clearly stated about herself.
 */

export type LlmAssistantMemoryPatch = {
  likes?: string[]
  dislikes?: string[]
  preferredNames?: string[]
  rejectedNames?: string[]
  relational?: string[]
  growthNotes?: string[]
}

const SYSTEM = `Eres un extractor de memoria del personaje asistente (NO del usuario).
Devuelve SOLO JSON válido, sin markdown:
{"likes":[],"dislikes":[],"preferredNames":[],"rejectedNames":[],"relational":[]}

Reglas:
- likes: gustos ESTABLES del asistente (temas cortos: "astronomía", "café", "música celta"). Máx 6.
- NO metas frases narrativas, roleplay, "cómo te sonrojas", "pensar en paisajes", vocativos ("querida").
- preferredNames: cómo le gusta que LA/LO llamen (apodos). No el nombre del usuario.
- rejectedNames: apodos que rechaza (no adverbios como "así").
- relational: preferencias del vínculo ("que me digas buenos días"), no gustos genéricos.
- Si no hay nada claro, arrays vacíos.
- Idioma: conserva el español del texto.`

/**
 * Build messages for a quick local/cloud extract call.
 */
export function buildAssistantMemoryExtractMessages(
  assistantReply: string,
  userText?: string
): { role: 'system' | 'user'; content: string }[] {
  const reply = String(assistantReply || '').trim().slice(0, 3500)
  const user = String(userText || '').trim().slice(0, 500)
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        (user ? `Mensaje del usuario (contexto):\n${user}\n\n` : '') +
        `Respuesta del asistente a analizar:\n${reply}`
    }
  ]
}

export function parseAssistantMemoryExtractJson(raw: string): LlmAssistantMemoryPatch {
  const t = String(raw || '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) return {}
  try {
    const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>
    const arr = (k: string) =>
      Array.isArray(obj[k])
        ? (obj[k] as unknown[])
            .map((x) => String(x || '').trim())
            .filter((x) => x.length >= 2 && x.length <= 48)
            .slice(0, 8)
        : undefined
    return {
      likes: arr('likes'),
      dislikes: arr('dislikes'),
      preferredNames: arr('preferredNames'),
      rejectedNames: arr('rejectedNames'),
      relational: arr('relational'),
      growthNotes: arr('growthNotes')
    }
  } catch {
    return {}
  }
}

/** Drop junk that models sometimes still emit */
export function sanitizeLlmMemoryPatch(patch: LlmAssistantMemoryPatch): LlmAssistantMemoryPatch {
  const bad = /^(pensar|imaginar|cómo|como|querida|querido|así|eso de|orden hermoso)/i
  const filt = (xs?: string[]) =>
    (xs || []).filter((x) => !bad.test(x) && x.split(/\s+/).length <= 6).slice(0, 6)
  return {
    likes: filt(patch.likes),
    dislikes: filt(patch.dislikes),
    preferredNames: filt(patch.preferredNames),
    rejectedNames: filt(patch.rejectedNames).filter((x) => !/^(así|asi)$/i.test(x)),
    relational: filt(patch.relational),
    growthNotes: (patch.growthNotes || []).filter((x) => x.length >= 12).slice(0, 3)
  }
}
