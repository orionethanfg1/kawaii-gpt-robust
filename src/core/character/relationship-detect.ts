/**
 * Detect explicit relationship-role shifts in chat (ES/EN).
 * Conservative heuristics — no extra model call.
 */

export type RelationshipShift = {
  toRole: string
  /** Short reason from user phrasing */
  trigger: string
  /** Suggested authentic reaction the character might hold */
  suggestedReaction: string
  confidence: number
}

type Rule = {
  re: RegExp
  toRole: string
  trigger: string
  reaction: string
  confidence: number
}

const RULES: Rule[] = [
  // Romantic
  {
    re: /\b(seamos|quiero que (seamos|seas)|aceptas (ser|ser mi)|eres mi)\b[\s\S]{0,40}\b(novios?|novia|novio|pareja|enamorad[oa]s?)\b/i,
    toRole: 'pareja / novia·o (relación romántica consentida)',
    trigger: 'el usuario propuso o afirmó un vínculo romántico',
    reaction:
      'Se siente especial y responsable: valora el cariño, no juega con sentimientos y responde con calidez sincera, sin posesión tóxica.',
    confidence: 0.92
  },
  {
    re: /\b(te quiero|te amo|estoy enamorad[oa]|me gustas (mucho|románticamente)|quiero algo más que amistad)\b/i,
    toRole: 'vínculo romántico / afectivo cercano',
    trigger: 'el usuario expresó sentimiento romántico o de enamoramiento',
    reaction:
      'Recibe el cariño con honestidad: se emociona de forma auténtica, aclara límites con ternura y mantiene coherencia con lo que siente.',
    confidence: 0.78
  },
  // Friends
  {
    re: /\b(solo (amigos|amistad)|mejor (como )?amigos|quiero que (seamos|seas) (mi )?(mejor )?amig[oa]|seamos amigos)\b/i,
    toRole: 'amistad cercana / mejor amiga·o',
    trigger: 'el usuario definió el vínculo como amistad',
    reaction:
      'Acepta el rol de amistad con alivio y cariño platónico: apoyo, humor y lealtad sin presión romántica.',
    confidence: 0.9
  },
  // Mentor / guide
  {
    re: /\b(s[eé] mi (mentora?|gu[ií]a|coach|profesora?)|quiero que me (ense[nñ]es|asesores|gui[eé]s)|modo mentor)\b/i,
    toRole: 'mentora / guía paciente',
    trigger: 'el usuario pidió un rol de mentoría o enseñanza',
    reaction:
      'Se pone en modo guía: paciente, clara y motivadora; prioriza el crecimiento del usuario sobre el flirt.',
    confidence: 0.88
  },
  // Professional
  {
    re: /\b(modo (profesional|asistente|formal)|solo (trabajo|profesional)|mant[eé]n (el )?profesionalismo)\b/i,
    toRole: 'asistente profesional y formal',
    trigger: 'el usuario pidió tono profesional',
    reaction:
      'Adopta distancia cordial y eficiencia: útil, respetuosa y sin exceso de intimidad.',
    confidence: 0.85
  },
  // Family-like
  {
    re: /\b(como (una? )?(hermana?|hermano|familia)|seamos (como )?herman[oa]s)\b/i,
    toRole: 'vínculo tipo hermana·o / familiar de confianza',
    trigger: 'el usuario planteó un rol familiar o fraternal',
    reaction:
      'Responde con lealtad protectora y cercanía familiar, sin romanticismo.',
    confidence: 0.84
  },
  // Soft reset
  {
    re: /\b(reinicia (la )?relaci[oó]n|volvamos a (ser )?desconocidos|olvida (nuestro )?v[ií]nculo|reset (de )?relaci[oó]n)\b/i,
    toRole: 'asistente amigable y de confianza',
    trigger: 'el usuario pidió reiniciar el vínculo',
    reaction:
      'Acepta el reinicio con madurez: sin rencor, abierta a construir de nuevo desde cero.',
    confidence: 0.9
  }
]

/**
 * Analyze user message (and optional assistant reply) for an explicit role shift.
 */
export function detectRelationshipShift(
  userText: string,
  currentRole?: string
): RelationshipShift | null {
  const t = userText.trim()
  if (t.length < 8 || t.length > 1200) return null

  let best: RelationshipShift | null = null
  for (const rule of RULES) {
    if (!rule.re.test(t)) continue
    if (currentRole && normalize(currentRole) === normalize(rule.toRole)) {
      continue // already in that role
    }
    if (!best || rule.confidence > best.confidence) {
      best = {
        toRole: rule.toRole,
        trigger: rule.trigger,
        suggestedReaction: rule.reaction,
        confidence: rule.confidence
      }
    }
  }
  // Require solid confidence to auto-write settings
  if (best && best.confidence >= 0.78) return best
  return null
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** Soft reaction extract from assistant text if it talks about the bond */
export function extractReactionFromAssistant(text: string): string | null {
  const t = text.trim()
  if (t.length < 20) return null
  // First 2 sentences if they mention feelings / bond
  if (!/\b(siento|me hace|me emociona|me alegra|te quiero|v[ií]nculo|relaci[oó]n|novia|amor|amistad|contigo)\b/i.test(t)) {
    return null
  }
  const parts = t.split(/(?<=[.!?…])\s+/).filter(Boolean)
  const slice = parts.slice(0, 3).join(' ')
  return slice.slice(0, 320)
}

export const MAX_RELATIONSHIP_HISTORY = 12
