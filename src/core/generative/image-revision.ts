export type ImageRevisionMemory = {
  prompt?: string
  width?: number
  height?: number
  seed?: number
  provider?: string
}

export function looksLikeImageRevision(text: string, hasPrev: boolean): boolean {
  if (!hasPrev) return false
  return /\b(m[aá]s|menos|cambia|hazla|ponle|quita|otro|otra|mejor|joven|mayor|pelo|cabello|ojos|fondo)\b/i.test(
    text
  )
}

export function looksLikeIdentityReject(text: string): boolean {
  return /\b(no eres t[uú]|esa no eres|no te pareces|identidad|no soy yo|wrong person)\b/i.test(
    text
  )
}

export function reviseImagePrompt(
  base: ImageRevisionMemory,
  userText: string,
  opts?: { characterLook?: string; characterName?: string }
): { prompt: string; width?: number; height?: number; negativePrompt?: string } {
  const look = (opts?.characterLook || '').trim()
  const name = opts?.characterName || ''
  const baseP = (base.prompt || '').trim()
  const prompt = [
    baseP,
    look ? `must match: ${look}` : '',
    name ? `character ${name}` : '',
    userText
  ]
    .filter(Boolean)
    .join(', ')
  return {
    prompt,
    width: base.width,
    height: base.height,
    negativePrompt: 'wrong person, different face, wrong hair color, two heads'
  }
}

export function shouldForceImageRevision(text: string, hasPrev: boolean): boolean {
  return looksLikeImageRevision(text, hasPrev) || looksLikeIdentityReject(text)
}
