/**
 * System hints + multimodal message build when the user attaches images.
 * Multi-reference identity: compare upload(s) against character gallery + ficha.
 */
import type { ChatContentPart, ChatMessage } from '../providers/types'
import type { Attachment } from '../conversation'

export type GalleryRef = {
  label?: string
  scene?: string
  /** true = primary chat avatar */
  primary?: boolean
}

export type VisionAttachOpts = {
  trimmed: string
  imageCount: number
  characterName?: string
  visualDescription?: string
  hasAvatar?: boolean
  /** Labels/scenes from Ajustes → galería (no need to resend all data URLs in system) */
  galleryRefs?: GalleryRef[]
}

export function buildVisionSystemHint(opts: VisionAttachOpts): string {
  const {
    trimmed,
    imageCount,
    characterName,
    visualDescription,
    hasAvatar,
    galleryRefs = []
  } = opts
  const name = (characterName || 'el personaje').trim()
  const bare = !trimmed || trimmed === '📷'
  const userSaysMe = /\b(yo|mi foto|así soy|asi soy|this is me|soy yo|soy la usuaria|soy el usuario)\b/i.test(
    trimmed
  )
  const aboutCharacter =
    /\b(t[uú]|ti|avatar|personaje|ella|eres tú|eres tu)\b/i.test(trimmed) ||
    (characterName
      ? new RegExp(characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(trimmed)
      : false)

  const lines: string[] = []
  lines.push(`[VISION_IDENTIDAD] Usuario adjuntó ${imageCount} imagen(es).`)
  lines.push(
    'Las imágenes van **embebidas en el mensaje del usuario** (píxeles reales). Míralas; no inventes una ficha de texto si no la ves.'
  )
  if (bare) {
    lines.push(
      'Sin texto del usuario: describe cada imagen (personas, cara, pelo, ojos, ropa, escena).'
    )
  } else {
    lines.push(`Instrucción del usuario: ${trimmed}`)
  }

  if (visualDescription?.trim()) {
    lines.push('')
    lines.push(`Ficha visual canónica de **${name}** (solo referencia; prioriza lo que VEAS en la foto):`)
    lines.push(`"${visualDescription.trim().slice(0, 700)}"`)
  }

  if (galleryRefs.length) {
    lines.push('')
    lines.push(
      `Galería de referencia de **${name}** (${galleryRefs.length} escena(s); misma identidad, ropa/fondo distintos):`
    )
    galleryRefs.slice(0, 12).forEach((g, i) => {
      const tag = [g.primary ? '★principal' : null, g.label, g.scene]
        .filter(Boolean)
        .join(' · ')
      lines.push(`- Ref ${i + 1}${tag ? `: ${tag}` : ''}`)
    })
    lines.push(
      'Estas refs son LA MISMA persona en otras poses/ropa. Si la foto subida coincide en cara/estructura ' +
        `(ojos, nariz, mandíbula, pelo base) con **${name}**, dilo con claridad: "sí, soy yo / es ${name}" ` +
        'aunque el vestido o el fondo cambien. Si la cara no cuadra, dilo ("no parece la misma persona").'
    )
    lines.push(
      'Prioriza **identidad facial** sobre ropa o escenario. Sé precisa: sí / no / dudoso + 1-2 rasgos clave.'
    )
  } else if (hasAvatar || visualDescription?.trim()) {
    lines.push(
      `Compara con la identidad de **${name}**. Ropa distinta no invalida identidad si la cara coincide.`
    )
  }

  if (userSaysMe) {
    lines.push('El usuario dice que es SU foto: resume rasgos para memoria de apariencia del usuario.')
  } else if (aboutCharacter) {
    lines.push(`Prioriza decidir si la imagen es **${name}** (personaje del chat).`)
  } else if (bare) {
    lines.push(
      `Si hay una mujer/persona alineada con la ficha/galería de **${name}**, reconócela como ella; si no, no asumas.`
    )
  }

  lines.push(
    'Responde por lo que se ve en la imagen adjunta. No sustituyas la foto por la ficha canónica si no coincide.'
  )
  return lines.join('\n')
}

/** Max images per turn (payload size). */
export const MAX_VISION_IMAGES = 3
/** Soft max data-url length after compress (~700KB). */
export const MAX_VISION_DATA_URL_CHARS = 900_000
/** Longest edge for VLM (LMS + Gemma stay stable). */
export const VISION_MAX_SIDE = 1280

function isImageAtt(a: Attachment): boolean {
  const mime = String(a.mimeType || '')
  const name = String(a.name || '')
  return Boolean(
    (a.dataUrl && mime.startsWith('image/')) ||
      (a.dataUrl && /\.(png|jpe?g|webp|gif)$/i.test(name))
  )
}

/** data URL or bare base64 → data URL for OpenAI-style image_url */
export function normalizeImageDataUrl(raw: string, mimeHint?: string): string | null {
  const s = String(raw || '').trim()
  if (!s) return null
  if (s.startsWith('data:image/')) {
    if (s.length > MAX_VISION_DATA_URL_CHARS) return s.slice(0, MAX_VISION_DATA_URL_CHARS)
    return s
  }
  const mime = mimeHint && mimeHint.startsWith('image/') ? mimeHint : 'image/jpeg'
  const url = `data:${mime};base64,${s.replace(/^base64,/i, '')}`
  if (url.length > MAX_VISION_DATA_URL_CHARS) return url.slice(0, MAX_VISION_DATA_URL_CHARS)
  return url
}

/** Base64 without data: prefix (Ollama images[]) */
export function dataUrlToRawBase64(dataUrl: string): string | null {
  const s = String(dataUrl || '')
  const i = s.indexOf('base64,')
  if (i >= 0) return s.slice(i + 7)
  if (/^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 80))) return s.replace(/\s/g, '')
  return null
}


/**
 * Shrink large phone photos so LM Studio / Gemma does not return empty content.
 * Runs in renderer (canvas). Falls back to original on failure.
 */
export async function compressDataUrlForVision(
  dataUrl: string,
  opts?: { maxSide?: number; quality?: number; mime?: string }
): Promise<string> {
  const maxSide = opts?.maxSide ?? VISION_MAX_SIDE
  const quality = opts?.quality ?? 0.82
  const outMime = opts?.mime || 'image/jpeg'
  const raw = String(dataUrl || '').trim()
  if (!raw.startsWith('data:image/')) return raw
  // Already small enough
  if (raw.length < 280_000) return raw

  // Never fetch(data:) — Electron CSP connect-src blocks it (empty vision turns).
  try {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      return raw.length > MAX_VISION_DATA_URL_CHARS
        ? raw.slice(0, MAX_VISION_DATA_URL_CHARS)
        : raw
    }

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('img load'))
      el.src = raw
    })
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) {
      return raw.length > MAX_VISION_DATA_URL_CHARS
        ? raw.slice(0, MAX_VISION_DATA_URL_CHARS)
        : raw
    }

    const scale = Math.min(1, maxSide / Math.max(w, h))
    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return raw.length > MAX_VISION_DATA_URL_CHARS
        ? raw.slice(0, MAX_VISION_DATA_URL_CHARS)
        : raw
    }
    ctx.drawImage(img, 0, 0, tw, th)
    const url = canvas.toDataURL(outMime, quality)
    if (url && url.startsWith('data:image/') && url.length < raw.length) return url
    return raw.length > MAX_VISION_DATA_URL_CHARS
      ? raw.slice(0, MAX_VISION_DATA_URL_CHARS)
      : raw
  } catch {
    return raw.length > MAX_VISION_DATA_URL_CHARS
      ? raw.slice(0, MAX_VISION_DATA_URL_CHARS)
      : raw
  }
}

/**
 * Build user message content that actually includes pixels for VLM backends.
 * OpenAI-compat (LM Studio): content array with image_url parts.
 */
export function buildMultimodalUserContent(
  text: string,
  attachments?: Attachment[] | null
): { content: string | ChatContentPart[]; imageCount: number; ollamaImages: string[] } {
  const imgs = (attachments || []).filter(isImageAtt).slice(0, MAX_VISION_IMAGES)
  const ollamaImages: string[] = []
  const parts: ChatContentPart[] = []
  const body =
    (text || '').trim() ||
    (imgs.length ? '¿Qué ves en esta imagen? Opina con honestidad.' : '')

  if (!imgs.length) {
    return { content: body, imageCount: 0, ollamaImages: [] }
  }

  parts.push({ type: 'text', text: body })
  for (const a of imgs) {
    const url = normalizeImageDataUrl(String(a.dataUrl), a.mimeType)
    if (!url) continue
    parts.push({ type: 'image_url', image_url: { url, detail: 'high' } })
    const raw = dataUrlToRawBase64(url)
    if (raw) ollamaImages.push(raw)
  }
  if (parts.length === 1) {
    return { content: body, imageCount: 0, ollamaImages: [] }
  }
  return { content: parts, imageCount: parts.length - 1, ollamaImages }
}

export function chatContentCharLen(content: string | ChatContentPart[] | undefined): number {
  if (content == null) return 0
  if (typeof content === 'string') return content.length
  let n = 0
  for (const p of content) {
    if (p && typeof p === 'object' && p.type === 'text') n += String(p.text || '').length
    else if (p && typeof p === 'object' && p.type === 'image_url') n += 500
  }
  return n
}

export function asChatMessageUser(
  text: string,
  attachments?: Attachment[] | null
): ChatMessage {
  const m = buildMultimodalUserContent(text, attachments)
  const msg: ChatMessage = { role: 'user', content: m.content }
  if (m.ollamaImages.length) msg.images = m.ollamaImages
  return msg
}


/** Compress then build multimodal user message (preferred in renderer). */
export async function asChatMessageUserAsync(
  text: string,
  attachments?: Attachment[] | null
): Promise<ChatMessage> {
  const imgs = (attachments || []).filter(isImageAtt).slice(0, MAX_VISION_IMAGES)
  if (!imgs.length) return asChatMessageUser(text, attachments)
  const next: Attachment[] = []
  for (const a of imgs) {
    const url = normalizeImageDataUrl(String(a.dataUrl), a.mimeType)
    if (!url) continue
    let compressed = url
    try {
      compressed = await compressDataUrlForVision(url)
    } catch {
      compressed = url
    }
    next.push({ ...a, dataUrl: compressed, mimeType: a.mimeType || 'image/jpeg' })
  }
  // keep non-image atts
  for (const a of attachments || []) {
    if (!isImageAtt(a)) next.push(a)
  }
  return asChatMessageUser(text, next)
}
