/**
 * Interpret user feedback about a previous image and merge into a new prompt.
 * Must NOT trigger on normal emotional chat ("no me gusta jugar con sentimientos").
 */

export type ImageRevisionMemory = {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  seed?: number
  provider?: string
}

/** Explicit reference to the image OR strong edit+visual cue */
const REVISION_EXPLICIT =
  /\b(la imagen|esta imagen|la foto|esta foto|el dibujo|esta ilustraci[oó]n|the image|this image|this photo)\b/i

const REVISION_VERB_WITH_IMAGE =
  /\b(cambia|cambiar|modifica|modificar|ajusta|ajustar|mejora|mejorar|quita|quitar|a[nñ]ade|añade|agrega|regenera|regenerar|edita|editar)\b[\s\S]{0,50}\b(imagen|foto|dibujo|ilustraci[oó]n|pelo|ojos|fondo|ropa|color|luz|estilo)\b/i

const SIZE_ONLY =
  /\b(el doble|2x|m[aá]s grande|mas grande|m[aá]s peque[nñ]a|mas pequena|4k|1080p|mitad de tama[nñ]o|otra resoluci[oó]n)\b/i

/**
 * True only for short feedback that is clearly about a prior image.
 * Caller must still verify a recent image exists in the chat.
 */
export function looksLikeImageRevision(text: string): boolean {
  const t = text.trim()
  if (!t || t.length >= 320) return false
  // Emotional / relational paragraphs → never image revision
  if (
    /\b(sentimientos?|quiero|contigo|relaci[oó]n|amor|novia|novio|felices|curiosidad)\b/i.test(t) &&
    !REVISION_EXPLICIT.test(t) &&
    !/\b(imagen|foto|dibujo)\b/i.test(t)
  ) {
    return false
  }
  if (REVISION_EXPLICIT.test(t)) return true
  if (REVISION_VERB_WITH_IMAGE.test(t)) return true
  if (SIZE_ONLY.test(t) && t.length < 100) return true
  return false
}

/** Scale size from phrases like "el doble", "más grande", "4k" */
export function sizeFromFeedback(
  text: string,
  width: number,
  height: number
): { width: number; height: number } | null {
  const t = text.toLowerCase()
  let scale = 1
  if (/\b(doble|2x|dos veces|el doble)\b/.test(t)) scale = 2
  else if (/\b(triple|3x)\b/.test(t)) scale = 3
  else if (/\b(mitad|m[aá]s peque[nñ]a|mas pequena|0\.5x)\b/.test(t)) scale = 0.5
  else if (/\b(m[aá]s grande|mas grande|bigger|larger|4k|alta resoluci[oó]n)\b/.test(t))
    scale = 1.5
  else if (/\b(un poco m[aá]s grande|ligeramente m[aá]s)\b/.test(t)) scale = 1.25
  else return null
  const clamp = (n: number) => Math.min(2048, Math.max(256, Math.round(n / 64) * 64))
  return { width: clamp(width * scale), height: clamp(height * scale) }
}

/**
 * Merge previous prompt + user feedback into a single generation prompt.
 */
export function reviseImagePrompt(
  previous: ImageRevisionMemory | null | undefined,
  userText: string
): ImageRevisionMemory {
  const base = previous?.prompt?.trim() || ''
  const feedback = userText.trim()
  const size =
    previous && previous.width && previous.height
      ? sizeFromFeedback(feedback, previous.width, previous.height)
      : null

  if (!base) {
    return {
      prompt: feedback,
      width: size?.width ?? previous?.width,
      height: size?.height ?? previous?.height,
      negativePrompt: previous?.negativePrompt,
      seed: undefined
    }
  }

  if (size && feedback.length < 80 && !/\b(color|pelo|fondo|ropa|estilo|cara|ojos)\b/i.test(feedback)) {
    return {
      ...previous!,
      prompt: base,
      width: size.width,
      height: size.height,
      seed: undefined
    }
  }

  const prompt =
    `${base}. Cambio solicitado por el usuario: ${feedback}. ` +
    `Mantén lo que no se pidió cambiar; aplica solo el feedback.`

  return {
    prompt: prompt.replace(/\s+/g, ' ').trim(),
    negativePrompt: previous?.negativePrompt,
    width: size?.width ?? previous?.width,
    height: size?.height ?? previous?.height,
    seed: undefined
  }
}
