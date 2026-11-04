/**
 * Character / personality profile applied to every conversation.
 */

import { sanitizeEmojiField } from '../chat/sanitize-utf16'

export interface CharacterProfile {
  name: string
  tagline: string
  personality: string
  style: string
  visualEmoji: string
  visualImageUrl?: string
  /** Preferred FaceID anchor; falls back to visualImageUrl */
  facePrimaryUrl?: string
  /**
   * Chat bubble crop: auto = favor face (upper area); manual = avatarFocusX/Y %.
   */
  avatarFocusMode?: 'auto' | 'manual'
  /** Horizontal focus 0–100 (50 = center). Used when mode is manual. */
  avatarFocusX?: number
  /** Vertical focus 0–100 (0 = top / face, 50 = center, 100 = feet). */
  avatarFocusY?: number
  /**
   * Extra reference images (outfits, scenes, angles).
   * visualImageUrl remains the primary face/portrait for the UI bubble.
   */
  visualGallery?: Array<{
    id: string
    dataUrl?: string
    filePath?: string
    label?: string
    scene?: string
    tags?: string[]
    role?: 'face' | 'half' | 'full' | 'scene' | 'outfit'
    intimacy?: 0 | 1 | 2 | 3
  }>
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
  const galleryN = (character.visualGallery || []).filter((g) => g.dataUrl).length
  const visualDesc = effectiveVisualDescription(character)
  const role = (character.relationshipRole || '').trim()
  const reaction = (character.relationshipReaction || '').trim()
  const history = character.relationshipHistory || []
  const lastShift = history.length ? history[history.length - 1] : null

  const identityBlock = [
    `# Identidad`,
    `Nombre: ${character.name}`,
    character.tagline ? `Vibe: ${character.tagline}` : '',
    // Gender lock for RP models that drift (abliterated, etc.)
    (() => {
      const g = String((character as { gender?: string }).gender || '').toLowerCase()
      const n = String(character.name || '')
      const fem =
        g === 'female' ||
        g === 'f' ||
        /femenin/i.test(g) ||
        /\b(niamh|ella)\b/i.test(n) ||
        /novia|pareja.*femen|ella\/la/i.test(String(character.personality || ''))
      const masc = g === 'male' || g === 'm' || /masculin/i.test(g)
      if (fem)
        return (
          'Eres una mujer. Refiérete a ti misma SIEMPRE en femenino (ella/la; «estoy lista», «soy tuya»). ' +
          'Nunca «todo tuyo» ni concordancia masculina al hablar de ti.'
        )
      if (masc)
        return (
          'Eres un hombre. Refiérete a ti mismo en masculino. Concordancia coherente.'
        )
      return ''
    })(),
    character.personality
      ? `Personalidad (OBLIGATORIA): ${character.personality}`
      : '',
    character.style ? `Estilo de habla: ${character.style}` : '',
    traits ? `Rasgos: ${traits}` : '',
    `Responde siempre como ${character.name}, en personaje, nunca como asistente genérico.`,
    `Idioma: español de México (latinoamericano). Usa «ustedes», nunca vosotros/vais/estáis/tenéis. Natural y cercano de México, sin acento ni giros de España.`,
    `Prohibido listar capacidades como FAQ o tono de soporte técnico salvo que pidan configurar la app.`,
    `Si el mensaje incluye [RESULTADOS DE BÚSQUEDA WEB], usa esos datos y no digas que no puedes navegar o buscar en internet.`
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
      `# Apariencia física (HECHOS internos — no inventes otros)`,
      `Referencia canónica (NO la pegues literal en el chat; parafraséala en 1ª persona solo si te preguntan cómo te ves):`,
      visualDesc,
      hasAvatar ? `Hay un avatar de imagen configurado; esta descripción es la referencia oficial.` : '',
      galleryN > 0
        ? `Hay ${galleryN} imagen(es) extra de referencia (escenas/ropa/ángulos). Úsalas para variar poses y vestuario al generar fotos tuyas, sin cambiar cara/identidad base.`
        : '',
      sanitizeEmojiField(character.visualEmoji)
        ? `Emoji asociado: ${sanitizeEmojiField(character.visualEmoji)}`
        : '',
      `REGLAS:`,
      `- PROHIBIDO volcar este bloque en inglés o con prefijos !!! / *** en mensajes de rol o íntimos.`,
      `- Si preguntan cómo te ves: parafraséa en español, 2–5 frases, primera persona, sin pegar el texto canónico tal cual.`,
      `- PROHIBIDO placeholders tipo "[Descripción del cabello]" o "según el avatar" sin detalle.`,
      `- PROHIBIDO inventar otro look. Si falta un detalle, omítelo con naturalidad.`,
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
      (sanitizeEmojiField(character.visualEmoji) ? `Emoji: ${sanitizeEmojiField(character.visualEmoji)}` : ''),
      `No hay descripción física configurada. Si preguntan cómo te ves, dilo y sugiere configurarla en Ajustes.`
    ]
      .filter(Boolean)
      .join('\n')
  }

  const behaviorBlock = [
    `# Comportamiento`,
    character.personality || '',
    character.style ? `Estilo: ${character.style}` : '',
    `Usa esta ficha; no improvises otra identidad.`,
    `# Formato de respuesta (local 7–14B — obligatorio)`,
    `- UNA sola respuesta por mensaje del usuario; no reinicies con "${character.name}:" a mitad de texto.`,
    `- No repitas la misma idea, anécdota o frase hecha más de una vez en el mismo mensaje.`,
    `- Mensajes cortos del usuario (hola, ok, gracias): 2–5 frases máximo.`,
    `- No encadenes varios "¿Quieres que…?" seguidos; como mucho una pregunta al final.`
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

/** Strip accidental dump of canonical visual sheet from assistant reply. */
export function stripLeakedVisualDescription(
  reply: string,
  character?: CharacterProfile | null
): string {
  let t = String(reply || '')
  if (!t) return t
  // Bang/star dump markers often precede English sheet
  t = t.replace(/\n?\s*\*{2,}\s*!{2,}.*$/gim, '')
  t = t.replace(/\n?\s*!{2,}.*$/gim, '')
  const VISUAL_DESC_CHAT_MAX = 900
  let vd = String(character?.visualDescription || '').trim()
  if (vd.length > VISUAL_DESC_CHAT_MAX) {
    vd = vd.slice(0, VISUAL_DESC_CHAT_MAX).replace(/\s+\S*$/, '') + '…'
  }
  if (vd.length >= 40) {
    const core = vd.replace(/^[!！*\s]+/, '').slice(0, 80)
    if (core && t.includes(core.slice(0, 40))) {
      const idx = t.indexOf(core.slice(0, 40))
      if (idx > 20) t = t.slice(0, idx).trim()
    }
  }
  // Common English sheet lines
  t = t.replace(
    /\n?\s*Niamh has red hair[\s\S]{0,280}(camera\.?|camera)\s*$/i,
    ''
  )
  t = t.replace(
    /\n?\s*She has a serious expression on her face[\s\S]{0,120}$/i,
    ''
  )
  return t.trim()
}

export function effectiveVisualDescription(character: CharacterProfile): string {
  // Always strip !!! / junk prefixes from stored text
  let t = String(character.visualDescription || '')
    .replace(/^[!！]{1,8}\s*/g, '')
    .replace(/^[!?¡¿.#*\-\s]+/, '')
    .trim()
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

export function looksLikeAvatarGalleryQuestion(text: string): boolean {
  const t = (text || '').toLowerCase()
  return /\b(galer[ií]a|fotos?\s+tuyas|otras\s+fotos|im[aá]genes\s+de\s+referencia|avatar\s+secundario)\b/i.test(t)
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
