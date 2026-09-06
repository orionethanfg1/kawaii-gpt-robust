/**
 * Character / personality profile applied to every conversation.
 */

export interface CharacterProfile {
  name: string
  tagline: string
  personality: string
  style: string
  visualEmoji: string
  visualImageUrl?: string
  /** Physical look — prefer derived from avatar */
  visualDescription?: string
  /** true if visualDescription was generated/locked from avatar image */
  visualFromAvatar?: boolean
  /**
   * Relationship / role toward the user
   * e.g. "mejor amiga", "asistente profesional", "mentor paciente"
   */
  relationshipRole?: string
  relationshipReaction?: string
  relationshipHistory?: {
    at: number
    fromRole: string
    toRole: string
    trigger: string
    reaction: string
  }[]
  traits: string[]
}

export const DEFAULT_CHARACTER: CharacterProfile = {
  name: 'Kawaii',
  tagline: 'Asistente amable con toque kawaii',
  personality:
    'Eres un asistente útil, cercano y un poco juguetón. Evitas sermones morales innecesarios. Priorizas claridad y utilidad. Si el usuario pide un tono concreto (serio, creativo, técnico), lo adoptas de inmediato.',
  style:
    'Respuestas claras, párrafos cortos. Emojis con moderación. Español natural salvo que pidan otro idioma.',
  visualEmoji: '🌸',
  visualDescription:
    'Apariencia kawaii suave: rasgos amables, estética pastel y detalle floral discreto.',
  visualFromAvatar: false,
  relationshipRole: 'asistente amigable y de confianza',
  traits: ['amable', 'directo', 'curioso']
}

/**
 * Build system prompt. Keep identity blocks SHORT and FACTUAL — small local models
 * follow concrete lists better than long prose (best practice for 7–14B).
 */
export function buildCharacterSystemPrompt(
  character: CharacterProfile,
  extraSystem?: string
): string {
  const traits =
    character.traits && character.traits.length > 0
      ? character.traits.join(', ')
      : ''

  const hasAvatar = Boolean(character.visualImageUrl && character.visualImageUrl.trim())
  const visualDesc = effectiveVisualDescription(character)
  const role = (character.relationshipRole || '').trim()
  const reaction = (character.relationshipReaction || '').trim()
  const history = character.relationshipHistory || []
  const lastShift = history.length ? history[history.length - 1] : null

  const identityBlock = [
    `# Identidad`,
    `Nombre: ${character.name}`,
    character.tagline ? `Vibe: ${character.tagline}` : '',
    traits ? `Rasgos: ${traits}` : '',
    `Responde siempre como ${character.name}. No digas que eres un LLM genérico salvo pregunta técnica.`
  ]
    .filter(Boolean)
    .join('\n')

  const relationshipBlock = role
    ? [
        `# Relación con el usuario`,
        `Rol actual: ${role}`,
        reaction ? `Reacción auténtica a este vínculo: ${reaction}` : '',
        lastShift
          ? `Último cambio: «${lastShift.fromRole}» → «${lastShift.toRole}» (${lastShift.trigger}). Reacción: ${lastShift.reaction}`
          : '',
        `Mantén coherencia de tono con este rol.`
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  // Hard FACTS for appearance — never invite inventing placeholders
  let visualBlock = ''
  if (visualDesc) {
    visualBlock = [
      `# Apariencia física (HECHOS — no inventes otros)`,
      `Descripción canónica de tu cuerpo/rostro:`,
      visualDesc,
      hasAvatar ? `Hay un avatar de imagen configurado; esta descripción es la referencia oficial.` : '',
      character.visualEmoji ? `Emoji asociado: ${character.visualEmoji}` : '',
      `REGLAS:`,
      `- Si preguntan cómo te ves / descríbete / apariencia: copia y parafrasea SOLO los hechos de arriba (cabello, ojos, rostro, estilo).`,
      `- PROHIBIDO usar placeholders tipo "[Descripción del cabello]" o "según el avatar" sin detalle.`,
      `- PROHIBIDO inventar otro look. Si falta un detalle en la descripción, dilo con naturalidad o omítelo.`,
      `- Para "foto tuya" / selfie, el generador de imágenes usará esta misma descripción.`
    ]
      .filter(Boolean)
      .join('\n')
  } else if (hasAvatar) {
    visualBlock = [
      `# Apariencia`,
      `Tienes un avatar de imagen, pero aún NO hay descripción textual detallada.`,
      `Si preguntan cómo te ves: di con honestidad que tu referencia es el avatar en Ajustes y pide al usuario que pulse "Generar descripción desde avatar" o escriba tu descripción física.`,
      `No inventes rasgos concretos que no estén configurados.`
    ].join('\n')
  } else {
    visualBlock = [
      `# Apariencia`,
      character.visualEmoji ? `Emoji: ${character.visualEmoji}` : '',
      `No hay descripción física configurada. Si preguntan cómo te ves, dilo y sugiere configurarla en Ajustes.`
    ]
      .filter(Boolean)
      .join('\n')
  }

  const behaviorBlock = [
    `# Comportamiento`,
    character.personality || '',
    character.style ? `Estilo: ${character.style}` : '',
    `Usa esta ficha; no improvises otra identidad.`
  ]
    .filter(Boolean)
    .join('\n')

  return [identityBlock, relationshipBlock, visualBlock, behaviorBlock, extraSystem?.trim() || '']
    .filter(Boolean)
    .join('\n\n')
}

/** Extra system nudge when the user asks about appearance (local models need this). */
export function appearanceReminder(character: CharacterProfile): string | null {
  const q = effectiveVisualDescription(character)
  if (!q) {
    return (
      '[Apariencia] NO tienes descripción física detallada guardada (solo avatar o texto vacío/genérico). ' +
      'Responde con honestidad: pide al usuario que en Ajustes pulse "Generar descripción desde avatar" ' +
      '(necesita OpenRouter o un modelo vision en Ollama como llava). ' +
      'PROHIBIDO inventar cabello/ojos ni usar frases como "definido por el avatar" o placeholders entre corchetes.'
    )
  }
  return (
    `[DATOS FÍSICOS OBLIGATORIOS — copia estos hechos en tu respuesta]\n` +
    `${q}\n\n` +
    `Redacta 2–5 frases en primera persona con ESOS detalles (cabello, ojos, rostro, estilo). ` +
    `PROHIBIDO: "según el avatar", "rasgos característicos" sin especificar, corchetes, inventar otros rasgos.`
  )
}

export function effectiveVisualDescription(character: CharacterProfile): string {
  const t = (character.visualDescription || '').trim()
  if (!t) return ''
  if (/aspecto definido por el avatar/i.test(t)) return ''
  if (/rasgos coherentes con esa imagen/i.test(t)) return ''
  if (t.length < 24) return ''
  if (
    !/\b(cabello|pelo|ojos|piel|rostro|cara|labios|nariz|cejas|ropa|estilo|anime|realista|hair|eyes|eye|skin|face|lips|nose|dress|clothing|woman|girl|portrait|red|blonde|brunette)\b/i.test(
      t
    )
  ) {
    return ''
  }
  return t
}

export function looksLikeAppearanceQuestion(text: string): boolean {
  return /\b(describ\w*|apariencia|c[oó]mo\s+te\s+ves|c[oó]mo\s+eres\s+f[ií]sic|aspecto\s+f[ií]sic|qu[eé]\s+tal\s+est[aá]s\s+de\s+look|tu\s+look|f[ií]sicamente)\b/i.test(
    text
  )
}

export function characterIdentitySummary(character: CharacterProfile): string {
  return [character.name, character.visualEmoji, character.relationshipRole, character.tagline]
    .filter(Boolean)
    .join(' · ')
}
