/**
 * I3 — In-character reaction after a generated image lands in the bubble.
 * Host builds the instruction; LLM answers as the companion. Fail-soft → short fallback.
 */

export type ImageReactionInput = {
  userText: string
  isSelf: boolean
  characterName?: string
  imageTitle?: string
  faceIdStatus?: 'applied' | 'missing' | 'unknown' | string
  faceMatchScore?: number | null
  usedFallbackProvider?: boolean
  revisionNote?: string
}

export type ImageReactionResult = {
  content: string
  source: 'llm' | 'fallback'
}

/** Deterministic fallback when the micro-turn fails or times out. */
export function buildImageReactionFallback(input: ImageReactionInput): string {
  const bits: string[] = []
  if (input.isSelf) {
    bits.push('Aquí me tienes. ¿Qué te parece esta foto?')
  } else {
    bits.push('Listo, aquí está la imagen. ¿Quieres cambiar algo?')
  }
  if (input.usedFallbackProvider) {
    bits.push('_Nota: se usó un proveedor alternativo (Forge no estaba listo)._')
  }
  if (input.isSelf && input.faceIdStatus === 'missing') {
    bits.push(
      '_⚠️ No pude anclar bien la cara (FaceID). Revisa Forge o el avatar en Ajustes → Personalidad._'
    )
  }
  if (input.isSelf && input.faceIdStatus === 'no-ref') {
    bits.push(
      '_⚠️ Sin foto de referencia en la ficha: sube un retrato en Ajustes para que me parezca más a mí._'
    )
  }
  bits.push('_Si quieres, dime qué cambiar (fondo, ropa, tamaño…) y la ajusto._')
  return bits.filter(Boolean).join('\n\n')
}

export function buildImageReactionSystemPrompt(input: ImageReactionInput): string {
  const name = (input.characterName || 'la compañera').trim()
  const selfLine = input.isSelf
    ? `Acabas de mostrar una imagen de TI misma (${name}) al usuario.`
    : `Acabas de generar una imagen pedida por el usuario (no es necesariamente tu autorretrato).`
  return (
    `Eres ${name}, en un chat companion íntimo y cálido.\n` +
    selfLine +
    '\n' +
    'Responde en 1–3 frases cortas, en personaje, en español.\n' +
    'Habla como si la imagen ya estuviera visible en el chat.\n' +
    'Prohibido: JSON, etiquetas técnicas, listar el prompt SD, decir "como IA", "he generado", "aquí tienes la imagen" de forma robótica.\n' +
    'Puedes invitar suavemente a pedir un cambio (ropa, fondo, pose) si encaja.\n' +
    'No inventes detalles visuales que el usuario no pidió.'
  )
}

export function buildImageReactionUserPrompt(input: ImageReactionInput): string {
  const parts = [
    `Pedido del usuario: ${String(input.userText || '').trim().slice(0, 400) || '(imagen)'}`
  ]
  if (input.imageTitle) parts.push(`Título corto: ${input.imageTitle}`)
  if (input.isSelf) parts.push('Tipo: autorretrato / foto de la compañera.')
  if (typeof input.faceMatchScore === 'number' && input.faceMatchScore > 0) {
    parts.push(`Similitud facial (orientativa): ${input.faceMatchScore.toFixed(2)}`)
  }
  if (input.revisionNote) parts.push(`Nota de revisión: ${input.revisionNote.slice(0, 120)}`)
  parts.push('Escribe solo el mensaje visible al usuario.')
  return parts.join('\n')
}

/** Sanitize model output into a short chat bubble. */
export function sanitizeImageReactionText(raw: string): string {
  let t = String(raw || '').trim()
  if (!t) return ''
  // Drop fenced blocks / JSON
  if (t.startsWith('{') && t.includes('}')) {
    const m = t.match(/"(?:content|text|message|reply)"\s*:\s*"((?:\\.|[^"\\])*)"/i)
    if (m?.[1]) t = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
  t = t
    .replace(/^```[\s\S]*?```/g, '')
    .replace(/^["«]+|["»]+$/g, '')
    .replace(/^Asistente:\s*/i, '')
    .trim()
  // Cap length — reaction, not essay
  if (t.length > 600) t = t.slice(0, 597).replace(/\s+\S*$/, '') + '…'
  // Reject pure technical dumps
  if (/^(masterpiece|best quality|negative prompt)/i.test(t)) return ''
  if (t.length < 8) return ''
  return t
}

/**
 * Run micro-turn with timeout. llmFn(system, user) → raw text.
 */
export async function craftImageReactionWithLlm(
  input: ImageReactionInput,
  llmFn: (system: string, user: string) => Promise<string>,
  timeoutMs = 6000
): Promise<ImageReactionResult> {
  const fallback = buildImageReactionFallback(input)
  try {
    const system = buildImageReactionSystemPrompt(input)
    const user = buildImageReactionUserPrompt(input)
    const text = await Promise.race([
      llmFn(system, user),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error('image-reaction-timeout')), timeoutMs)
      )
    ])
    const clean = sanitizeImageReactionText(text)
    if (!clean) return { content: fallback, source: 'fallback' }
    // Append technical warnings only (not the robotic opener)
    const extras: string[] = []
    if (input.usedFallbackProvider) {
      extras.push('_Nota: se usó un proveedor alternativo (Forge no estaba listo)._')
    }
    if (input.isSelf && input.faceIdStatus === 'missing') {
      extras.push(
        '_⚠️ No pude anclar bien la cara (FaceID). Revisa Forge o el avatar en Ajustes → Personalidad._'
      )
    }
    if (input.isSelf && input.faceIdStatus === 'no-ref') {
      extras.push(
        '_⚠️ Sin foto de referencia en la ficha: sube un retrato en Ajustes para que me parezca más a mí._'
      )
    }
    const content = extras.length ? clean + '\n\n' + extras.join('\n\n') : clean
    return { content, source: 'llm' }
  } catch {
    return { content: fallback, source: 'fallback' }
  }
}
