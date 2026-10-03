
import type { Attachment } from '../conversation'

const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|log|ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|css|html|xml|yaml|yml|toml|ini|env|sql)$/i
const MAX_CHARS = 48_000
const MAX_FILE_BYTES = 512 * 1024

export function isTextDocumentFile(name: string, mime?: string): boolean {
  if (TEXT_EXT.test(name || '')) return true
  if (mime && (/^text\//i.test(mime) || mime === 'application/json' || mime === 'application/xml'))
    return true
  return false
}

/** Office/PDF binaries — not parsed yet (need dedicated extractors). */
export function isUnsupportedOfficeFile(name: string, mime?: string): boolean {
  const n = (name || '').toLowerCase()
  if (/\.(docx?|xlsx?|pptx?|pdf|odt|rtf)$/i.test(n)) return true
  if (
    mime &&
    /officedocument|msword|ms-excel|ms-powerpoint|application\/pdf/i.test(mime)
  )
    return true
  return false
}

export function truncateDocText(text: string, max = MAX_CHARS): string {
  const t = text || ''
  if (t.length <= max) return t
  return t.slice(0, max) + `\n\n…[truncado: ${t.length - max} caracteres más]`
}

export function buildDocumentsBlock(attachments: Attachment[] | undefined): string {
  if (!attachments?.length) return ''
  const docs = attachments.filter((a) => a.textContent && a.textContent.trim())
  if (!docs.length) return ''
  const parts = docs.map((d, i) => {
    const body = truncateDocText(d.textContent || '')
    return `--- Documento ${i + 1}: ${d.name || 'sin-nombre'} (${d.mimeType || 'text'}) ---\n${body}\n---`
  })
  return (
    '[DOCUMENTOS_ADJUNTOS] El usuario adjuntó archivo(s) de texto. Úsalos como fuente de verdad para responder; cita el nombre del archivo si aplica.\n\n' +
    parts.join('\n\n')
  )
}

export { MAX_FILE_BYTES, TEXT_EXT }
