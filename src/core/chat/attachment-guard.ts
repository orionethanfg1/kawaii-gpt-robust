/**
 * Classify and guard user attachments so unknown media never crashes the turn.
 */

import type { Attachment } from '../conversation'

export type AttachmentKind = 'image' | 'document' | 'audio' | 'video' | 'unknown'

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024
/** Soft target after compress for VLM stability */
export const TARGET_IMAGE_DATA_URL_CHARS = 900_000

export function classifyAttachmentKind(a: {
  name?: string
  mimeType?: string
}): AttachmentKind {
  const mime = String(a.mimeType || '').toLowerCase()
  const name = String(a.name || '').toLowerCase()
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(name)) {
    return 'image'
  }
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(name)) {
    return 'audio'
  }
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi)$/i.test(name)) {
    return 'video'
  }
  if (
    mime.startsWith('text/') ||
    /json|pdf|wordprocessingml|msword|xml|csv/.test(mime) ||
    /\.(txt|md|markdown|json|csv|tsv|log|pdf|docx|py|ts|tsx|js|jsx|css|html|xml|ya?ml|toml|sql)$/i.test(
      name
    )
  ) {
    return 'document'
  }
  return 'unknown'
}

export function partitionAttachments(atts?: Attachment[] | null): {
  images: Attachment[]
  documents: Attachment[]
  audio: Attachment[]
  video: Attachment[]
  unknown: Attachment[]
} {
  const images: Attachment[] = []
  const documents: Attachment[] = []
  const audio: Attachment[] = []
  const video: Attachment[] = []
  const unknown: Attachment[] = []
  for (const a of atts || []) {
    const k = classifyAttachmentKind(a)
    if (k === 'image' && a.dataUrl) images.push(a)
    else if (k === 'document' && (a.textContent || a.filePath)) documents.push(a)
    else if (k === 'audio') audio.push(a)
    else if (k === 'video') video.push(a)
    else if (k === 'image') images.push(a) // image without dataUrl still listed
    else if (k === 'document') documents.push(a)
    else unknown.push(a)
  }
  return { images, documents, audio, video, unknown }
}

/**
 * System note when user sent media we cannot process this turn.
 * Honest, short, no crash path.
 */
export function buildUnsupportedMediaSystemHint(parts: {
  audio?: number
  video?: number
  unknown?: number
  imagesWithoutPixels?: number
}): string {
  const bits: string[] = []
  if (parts.audio) bits.push(`${parts.audio} audio(s)`)
  if (parts.video) bits.push(`${parts.video} vídeo(s)`)
  if (parts.unknown) bits.push(`${parts.unknown} archivo(s) no reconocidos`)
  if (parts.imagesWithoutPixels) {
    bits.push(`${parts.imagesWithoutPixels} imagen(es) sin datos (no se pudo leer el archivo)`)
  }
  if (!bits.length) return ''
  return (
    `[ADJUNTO_NO_PROCESADO] El usuario envió: ${bits.join(', ')}. ` +
    'La app aún no transcribe ni analiza audio/vídeo en el chat. ' +
    'Explícalo con naturalidad y sugiere imagen (jpg/png/webp), texto o .docx/.pdf. ' +
    'No inventes el contenido del archivo.'
  )
}

export function attachmentUserFacingLabel(a: Attachment): string {
  const k = classifyAttachmentKind(a)
  const name = a.name || 'archivo'
  if (k === 'image') return `🖼️ ${name}`
  if (k === 'document') return `📄 ${name}`
  if (k === 'audio') return `🎵 ${name}`
  if (k === 'video') return `🎬 ${name}`
  return `📎 ${name}`
}
