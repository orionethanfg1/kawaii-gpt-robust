/**
 * Pronoun / label helpers from character + user identity.
 * Mexican Spanish; avoids Spain-specific forms.
 */

export type GenderMark = 'female' | 'male' | 'neutral'

export function normalizeGenderMark(raw?: string | null): GenderMark {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return 'neutral'
  if (
    /^(f|female|femenin|mujer|ella|chica|girl|woman|novia|amiga|hermana)/i.test(s) ||
    /\b(ella|mujer|femenin|novia)\b/i.test(s)
  ) {
    return 'female'
  }
  if (
    /^(m|male|masculin|hombre|él|el|chico|boy|man|novio|amigo|hermano)/i.test(s) ||
    /\b(él|hombre|masculin|novio)\b/i.test(s)
  ) {
    return 'male'
  }
  return 'neutral'
}

/** Infer assistant gender from role + name hints when not explicit. */
export function inferAssistantGender(opts: {
  explicit?: string | null
  relationshipRole?: string | null
  name?: string | null
  personality?: string | null
}): GenderMark {
  const ex = normalizeGenderMark(opts.explicit)
  if (ex !== 'neutral') return ex
  const blob = `${opts.relationshipRole || ''} ${opts.personality || ''}`.toLowerCase()
  if (/\b(novia|amiga|esposa|hermana|ella|femenin|mujer)\b/.test(blob)) return 'female'
  if (/\b(novio|amigo|esposo|hermano|él|masculin|hombre)\b/.test(blob)) return 'male'
  return 'neutral'
}

export function assistantLikeLabels(g: GenderMark): {
  likes: string
  dislikes: string
  habits: string
  subject: string // ella / él / la persona
} {
  if (g === 'male') {
    return {
      likes: 'Le gusta (él)',
      dislikes: 'No le gusta (él)',
      habits: 'Hábitos',
      subject: 'él'
    }
  }
  if (g === 'female') {
    return {
      likes: 'Le gusta (ella)',
      dislikes: 'No le gusta (ella)',
      habits: 'Hábitos',
      subject: 'ella'
    }
  }
  return {
    likes: 'Le gusta',
    dislikes: 'No le gusta',
    habits: 'Hábitos',
    subject: 'la persona'
  }
}

/** System hint: how the model should refer to itself and the user. */
export function buildPronounSystemHint(opts: {
  assistantGender: GenderMark
  userGender?: GenderMark
  assistantName?: string
  userName?: string
}): string {
  const lines: string[] = []
  const a = opts.assistantGender
  const u = opts.userGender || 'neutral'
  if (a === 'female') {
    lines.push(
      'Refiérete a ti misma en femenino (ella/la; «estoy lista», «soy buena en…»). No uses masculino para ti.'
    )
  } else if (a === 'male') {
    lines.push(
      'Refiérete a ti mismo en masculino (él/lo; «estoy listo», «soy bueno en…»). No uses femenino para ti.'
    )
  }
  if (u === 'female') {
    lines.push(
      'Dirígete al usuario en femenino (tú/te; «¿lista?», «guapa» solo si el tono lo permite).'
    )
  } else if (u === 'male') {
    lines.push(
      'Dirígete al usuario en masculino (tú/te; «¿listo?»). Evita tratarlo en femenino.'
    )
  } else if (opts.userName) {
    lines.push(
      `Usa el nombre del usuario (${opts.userName}) y evita asumir género si no está claro.`
    )
  }
  lines.push('Español de México: evita vosotros/vais y giros de España.')
  return lines.join(' ')
}
