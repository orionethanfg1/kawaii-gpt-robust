/**
 * Interpret user feedback about a previous image and merge into a new prompt.
 * Must NOT trigger on analysis, description, or normal chat.
 */

export type ImageRevisionMemory = {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  seed?: number
  provider?: string
}

/** User wants to talk ABOUT an image (text only) — never regenerate */
const ANALYSIS_OR_TALK =
  /\b(analiz[ae]|analizar|describe|describ[ei]|explic[ae]|explica|cu[eé]ntame|coment[ae]|opina|critica|qu[eé]\s+ves|qu[e9]\s+hay|c[oó]mo\s+se\s+ve|c[oó]mo\s+queda|te\s+gusta\s+la\s+foto|qu[e9]\s+piensas\s+de\s+(la|esta)\s+(foto|imagen)|hablame\s+de)\b/i

const REVISION_EXPLICIT =
  /\b(la imagen|esta imagen|la foto|esta foto|el dibujo|esta ilustraci[oó]n|the image|this image|this photo)\b/i

const REVISION_VERB =
  /\b(cambia|cambiar|modifica|modificar|ajusta|ajustar|mejora|mejorar|quita|quitar|a[nñ]ade|añade|agrega|regenera|regenerar|edita|editar|rehaz|rehace|vuelve\s+a\s+generar|otra\s+versi[oó]n|hazla\s+de\s+nuevo|hazlo\s+de\s+nuevo)\b/i

const REVISION_VERB_WITH_IMAGE =
  /\b(cambia|cambiar|modifica|modificar|ajusta|ajustar|mejora|mejorar|quita|quitar|a[nñ]ade|añade|agrega|regenera|regenerar|edita|editar|rehaz|rehace)\b[\s\S]{0,50}\b(imagen|foto|dibujo|ilustraci[oó]n|pelo|ojos|fondo|ropa|color|luz|estilo|edad|joven|vieja|mayor)\b/i

const SIZE_ONLY =
  /\b(el doble|2x|m[aá]s grande|mas grande|m[aá]s peque[nñ]a|mas pequena|4k|1080p|mitad de tama[nñ]o|otra resoluci[oó]n)\b/i

/**
 * Short relative edits after an image (ChatGPT-style): "hazla más joven", "más rubia", "quita el fondo"
 * Requires hasPriorImage=true when calling from chat.
 */
const RELATIVE_EDIT =
  /\b(hazla|hazlo|ponla|ponlo|haz\s+que|quiero\s+que|que\s+sea|que\s+parezca)\b/i

const ATTRIBUTE_TWEAK =
  /\b(m[aá]s\s+joven|mas\s+joven|menos\s+joven|m[aá]s\s+vieja|mas\s+vieja|mayor|menor|m[aá]s\s+rubia|mas\s+rubia|m[aá]s\s+morena|m[aá]s\s+clara|m[aá]s\s+alta|m[aá]s\s+baja|m[aá]s\s+delgada|m[aá]s\s+gorda|sin\s+fondo|otro\s+fondo|ojos?\s+(azules?|verdes?|caf[eé]s?|negros?)|pelo\s+\w+|sonrisa|seria|sonriendo|de\s+cerca|de\s+cuerpo\s+completo|menos\s+\w+|m[aá]s\s+\w+)\b/i

/**
 * True only when the user wants to RE-GENERATE / edit the prior image.
 * Pass hasPriorImage when the conversation already has a generated image.
 */
/** User says the image is NOT the character / wrong person */
export function looksLikeIdentityReject(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 280) return false
  return (
    /(no\s+eres\s+t[uú]|no\s+eres\s+tu|esa\s+no\s+eres|ese\s+no\s+eres|no\s+te\s+pareces|no\s+se\s+parece|no\s+es\s+t[uú]|no\s+es\s+tu\s+(cara|foto|imagen|avatar)|wrong\s+person|that.?s\s+not\s+you|doesn.?t\s+look\s+like\s+you|no\s+coincide\s+con\s+(ti|tu\s+avatar)|otra\s+persona|persona\s+distinta)/i.test(
      t
    ) ||
    /(evidente\s+que\s+esa\s+no|claramente\s+no\s+eres|no\s+eres\s+esa)/i.test(t)
  )
}

export function looksLikeImageRevision(text: string, hasPriorImage = false): boolean {
  const t = text.trim()
  if (!t || t.length >= 320) return false
  if (looksLikeIdentityReject(t)) return true
  if (ANALYSIS_OR_TALK.test(t)) return false

  // Emotional chat without edit intent
  if (
    /\b(sentimientos?|contigo|relaci[oó]n|amor|novia|novio|te\s+quiero|buenos\s+d[ií]as)\b/i.test(
      t
    ) &&
    !REVISION_VERB.test(t) &&
    !ATTRIBUTE_TWEAK.test(t) &&
    !RELATIVE_EDIT.test(t)
  ) {
    return false
  }

  if (REVISION_VERB_WITH_IMAGE.test(t)) return true
  if (REVISION_EXPLICIT.test(t) && REVISION_VERB.test(t)) return true
  if (SIZE_ONLY.test(t) && t.length < 100) return true
  if (/\b(otra versi[oó]n|hazla de nuevo|regenera|rehaz|otra foto|otra imagen)\b/i.test(t) && t.length < 120)
    return true

  // After a prior image: short relative edits / retries are revisions
  if (hasPriorImage && t.length < 180) {
    if (RELATIVE_EDIT.test(t) && ATTRIBUTE_TWEAK.test(t)) return true
    if (RELATIVE_EDIT.test(t) && REVISION_VERB.test(t)) return true
    if (ATTRIBUTE_TWEAK.test(t) && (REVISION_VERB.test(t) || RELATIVE_EDIT.test(t) || t.length < 50))
      return true
    if (ATTRIBUTE_TWEAK.test(t) && t.length < 40) return true
    if (
      /\b(otro intento|otra vez|de nuevo|otra|reintenta|prueba)/i.test(t) &&
      t.length < 100
    )
      return true
  }

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

/** Map common Spanish tweaks to explicit English prompt deltas (helps SD/Forge) */
export function feedbackToPromptDelta(feedback: string): string {
  const t = feedback.toLowerCase()
  const parts: string[] = []
  if (/\bm[aá]s\s+joven|mas\s+joven|m[aá]s\s+jovencita|teen|younger\b/.test(t)) {
    parts.push('visibly younger face, early twenties, youthful features, smooth skin')
  }
  if (/\bm[aá]s\s+vieja|mayor|older|envejecida\b/.test(t)) {
    parts.push('older appearance, mature face, subtle age lines')
  }
  if (/\bm[aá]s\s+rubia|blonde\b/.test(t)) parts.push('blonde hair')
  if (/\bm[aá]s\s+morena|brunette|casta[nñ]a\b/.test(t)) parts.push('brunette dark brown hair')
  if (/\bojos?\s+azules?\b/.test(t)) parts.push('clear blue eyes')
  if (/\bojos?\s+verdes?\b/.test(t)) parts.push('green eyes')
  if (/\bsin\s+fondo|fondo\s+blanco|simple background\b/.test(t)) {
    parts.push('plain simple background')
  }
  if (/\bde\s+cuerpo\s+completo|full\s+body\b/.test(t)) parts.push('full body shot')
  if (/\bde\s+cerca|close[\s-]?up|primer\s+plano\b/.test(t)) parts.push('close-up portrait')
  if (/\bsonrisa|sonriendo|smil(e|ing)\b/.test(t)) parts.push('gentle natural smile')
  if (/\bseria|serious\b/.test(t)) parts.push('neutral serious expression')
  // Always keep a cleaned natural-language remainder
  const cleaned = feedback
    .replace(/\b(la imagen|esta imagen|la foto|esta foto|el dibujo)\b/gi, ' ')
    .replace(
      /\b(cambia|cambiar|modifica|ajusta|mejora|quita|añade|agrega|regenera|edita|rehaz|por favor|please|hazla|hazlo|ponla)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned && cleaned.length > 2) parts.push(cleaned)
  return parts.join(', ')
}

/**
 * Merge previous prompt + user feedback into a new generation prompt.
 */
export function mergeImageRevision(
  prev: ImageRevisionMemory,
  feedback: string
): ImageRevisionMemory {
  const fb = feedback.trim()
  const size = sizeFromFeedback(fb, prev.width || 768, prev.height || 1024)
  const delta = feedbackToPromptDelta(fb)

  // Strip previous "Changes requested" tails to avoid infinite prompt growth
  const basePrompt = prev.prompt.replace(/(?:\. )?Changes requested:.*$/i, '').trim()

  // Keep same person: do not drop prior eye/hair tokens when only changing age
  const prompt = delta
    ? `${basePrompt}. Changes requested: ${delta}. ` +
      'Same person, same face identity, same eye color and hair color as before unless the change asks otherwise. ' +
      'Single subject, one face only.'
    : basePrompt

  let negative = prev.negativePrompt || ''
  if (/\bm[aá]s\s+joven|mas\s+joven\b/i.test(fb)) {
    negative = [negative, 'elderly, wrinkled, aged skin, old woman, gray hair'].filter(Boolean).join(', ')
  }

  return {
    ...prev,
    prompt,
    negativePrompt: negative || prev.negativePrompt,
    width: size?.width ?? prev.width,
    height: size?.height ?? prev.height,
    seed: undefined
  }
}

/** Alias used by useChat — same as mergeImageRevision */
export function reviseImagePrompt(
  prev: ImageRevisionMemory,
  feedback: string,
  opts?: { characterLook?: string; characterName?: string }
): ImageRevisionMemory {
  return mergeImageRevision(prev, feedback, opts)
}


/** Force revision path: prior image + short relative language (ChatGPT-style) */
export function shouldForceImageRevision(text: string, hasPriorImage: boolean): boolean {
  if (!hasPriorImage) return false
  if (looksLikeImageRevision(text, true)) return true
  const t = text.trim()
  if (t.length === 0 || t.length > 180) return false
  if (ANALYSIS_OR_TALK.test(t)) return false
  // Imperative short commands after an image
  if (/^(hazla|hazlo|ponla|ponlo|cambia|quita|añade|agrega|mejora|ajusta)\b/i.test(t)) return true
  if (/^(m[aá]s|mas|menos)\s+\w+/i.test(t) && t.length < 40) return true
  return false
}
