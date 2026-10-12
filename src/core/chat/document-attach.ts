import type { Attachment } from '../conversation'
import {
  progressiveSlice,
  parseReadingAdvance,
  splitIntoChapters,
  PROGRESSIVE_SLICE_CHARS
} from './document-chunks'
import {
  type DocReadingState,
  emptyDocReadingState,
  markSliceRead,
  buildRollingReadingBlock,
  makeDocReadingKey
} from './document-reading-state'

const TEXT_EXT =
  /\.(txt|md|markdown|json|csv|tsv|log|ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|css|html|xml|yaml|yml|toml|ini|env|sql)$/i
const MAX_CHARS = 48_000
const MAX_FILE_BYTES = 512 * 1024
/** Office / PDF — extracted via main IPC (tools/doc_read.py) */
const OFFICE_EXT =
  /\.(docx|pdf)$/i
const MAX_OFFICE_BYTES = 12 * 1024 * 1024

export function isTextDocumentFile(name: string, mime?: string): boolean {
  if (TEXT_EXT.test(name || '')) return true
  if (mime && (/^text\//i.test(mime) || mime === 'application/json' || mime === 'application/xml'))
    return true
  return false
}

export function isOfficeExtractable(name: string, mime?: string): boolean {
  const n = (name || '').toLowerCase()
  if (OFFICE_EXT.test(n)) return true
  if (mime && /officedocument\.wordprocessingml|application\/pdf/i.test(mime)) return true
  return false
}

export function isUnsupportedOfficeFile(name: string, mime?: string): boolean {
  const n = (name || '').toLowerCase()
  if (/\.(docx|pdf)$/i.test(n)) return false
  if (/\.(doc|xlsx?|pptx?|odt|rtf)$/i.test(n)) return true
  if (
    mime &&
    /msword(?!.*wordprocessingml)|ms-excel|ms-powerpoint|opendocument/i.test(mime)
  )
    return true
  return false
}

export function truncateDocText(text: string, max = MAX_CHARS): string {
  const t = text || ""
  if (t.length <= max) return t
  return t.slice(0, max) + String.fromCharCode(10, 10) + "…[truncado: " + (t.length - max) + " caracteres más]"
}

export function hasTextDocuments(attachments?: Attachment[] | null): boolean {
  return Boolean(attachments?.some((a) => a.textContent && a.textContent.trim()))
}

export type BuildDocumentsResult = {
  block: string
  /** Updated reading states (one per document with text) */
  states: DocReadingState[]
  /** Primary file being read (first doc) */
  primary?: DocReadingState
}

/**
 * Build document system block with progressive slice + optional rolling summary.
 * Pass priorStates (by file key) so «sigue» advances instead of always restarting at chapter 0.
 */
export function buildDocumentsBlock(
  attachments: Attachment[] | undefined,
  opts?: {
    userMessage?: string
    chapterIndex?: number
    convId?: string
    priorStates?: DocReadingState[]
    /** Extra docs recovered from conversation history (sigue without re-upload) */
    recoveredDocs?: Array<{ name: string; text: string }>
  }
): string {
  return buildDocumentsWithState(attachments, opts).block
}

export function buildDocumentsWithState(
  attachments: Attachment[] | undefined,
  opts?: {
    userMessage?: string
    chapterIndex?: number
    convId?: string
    priorStates?: DocReadingState[]
    recoveredDocs?: Array<{ name: string; text: string }>
  }
): BuildDocumentsResult {
  const docs: Array<{ name: string; mimeType?: string; text: string }> = []
  if (attachments?.length) {
    for (const a of attachments) {
      const t = (a.textContent || '').trim()
      if (t) docs.push({ name: a.name || 'sin-nombre', mimeType: a.mimeType, text: a.textContent || t })
    }
  }
  if (!docs.length && opts?.recoveredDocs?.length) {
    for (const r of opts.recoveredDocs) {
      if ((r.text || '').trim()) docs.push({ name: r.name, text: r.text })
    }
  }
  if (!docs.length) return { block: '', states: [] }

  const convId = opts?.convId || 'session'
  const priorMap = new Map<string, DocReadingState>()
  for (const s of opts?.priorStates || []) {
    if (s?.key) priorMap.set(s.key, s)
    // also index by filename for soft match
    if (s?.fileName) priorMap.set(convId + '::name::' + s.fileName.toLowerCase(), s)
  }

  const parts: string[] = []
  const hints: string[] = []
  const rollingBits: string[] = []
  const nextStates: DocReadingState[] = []

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    const full = d.text
    const chapters = splitIntoChapters(full)
    const key = makeDocReadingKey(convId, d.name, full.length)
    let state =
      priorMap.get(key) ||
      priorMap.get(convId + '::name::' + d.name.toLowerCase()) ||
      emptyDocReadingState(convId, d.name, full.length, chapters.length)

    // Refresh chapter count if structure changed
    state = { ...state, chapterCount: chapters.length, totalChars: full.length, key }

    // state.chapterIndex = next chapter to present (cursor after last completed slice)
    let idx = opts?.chapterIndex ?? state.chapterIndex ?? 0
    if (opts?.userMessage) {
      const adv = parseReadingAdvance(opts.userMessage, Math.max(0, idx - 1), chapters.length)
      if (adv != null) idx = adv
    }
    // First upload with no prior progress: start at 0
    if (!state.readTitles.length && !state.rollingSummary) idx = opts?.chapterIndex ?? 0
    idx = Math.max(0, Math.min(chapters.length - 1, idx))

    const slice = progressiveSlice(full, { chapterIndex: idx, maxChars: PROGRESSIVE_SLICE_CHARS })
    const titles =
      slice.titles?.length ? slice.titles : slice.chapterTitle ? [slice.chapterTitle] : []

    // Next cursor = after last chapter of this slice
    const nextCursor = Math.min(chapters.length - 1, slice.lastChapterIndex + 1)
    const next = markSliceRead(state, {
      chapterIndex: nextCursor,
      lastChapterIndex: slice.lastChapterIndex,
      titles,
      sliceBody: slice.body
    })
    nextStates.push(next)

    // Prefer previous state's rolling (before this slice) for context
    if (state.rollingSummary.trim() || state.readTitles.length) {
      rollingBits.push(buildRollingReadingBlock(state))
    }

    hints.push(slice.hint)
    parts.push(
      '--- Documento ' +
        (i + 1) +
        ': ' +
        (d.name || 'sin-nombre') +
        ' (' +
        (d.mimeType || 'text') +
        ') · ' +
        slice.chapterTitle +
        ' ---' +
        String.fromCharCode(10) +
        slice.body +
        String.fromCharCode(10) +
        '---'
    )
  }

  const rules =
    '[MODO_DOCUMENTO] El usuario compartió texto de archivo(s). Responde SOBRE ese contenido:' +
    String.fromCharCode(10) +
    '- Si pide opinión/reseña: reseña LARGA y estructurada (objetivo ~900–1800 palabras o el máximo de tokens). Secciones con títulos: Impresión general, Momentos clave, Personajes, Qué funciona / qué flojea, Cierre. Varios párrafos por sección.' +
    String.fromCharCode(10) +
    '- Cita o parafrasea detalles concretos del extracto (nombres, lugares, diálogos). Nada de «me encantó» sin el porqué. Personalidad OK; el análisis ocupa la mayor parte.' +
    String.fromCharCode(10) +
    '- No cortes a mitad de idea: cierra la sección en curso. Si te quedas sin tokens, termina la frase con claridad.' +
    String.fromCharCode(10) +
    '- Si el extracto es parcial (lectura progresiva), dilo en una línea y comenta SOLO lo presente; ofrece «sigue» o capítulo N al final.' +
    String.fromCharCode(10) +
    '- No inventes capítulos o escenas que no aparezcan en el extracto ni en el resumen de progreso.'

  const block =
    rules +
    String.fromCharCode(10, 10) +
    (rollingBits.length
      ? rollingBits.join(String.fromCharCode(10, 10)) + String.fromCharCode(10, 10)
      : '') +
    '[LECTURA_PROGRESIVA] ' +
    hints.join(' | ') +
    String.fromCharCode(10, 10) +
    '[DOCUMENTOS_ADJUNTOS] Fuente de verdad; cita el nombre del archivo si aplica.' +
    String.fromCharCode(10, 10) +
    parts.join(String.fromCharCode(10, 10))

  return {
    block,
    states: nextStates,
    primary: nextStates[0]
  }
}

export function documentAnalysisMaxTokens(base: number): number {
  const b = Number(base) || 2048
  // Opiniones / reseñas de documento necesitan más aire que un chat corto
  return Math.min(4096, Math.max(b, 2800))
}

export { MAX_FILE_BYTES, MAX_OFFICE_BYTES, TEXT_EXT, OFFICE_EXT, MAX_CHARS }
export { progressiveSlice, parseReadingAdvance, splitIntoChapters } from './document-chunks'
export type { DocReadingState } from './document-reading-state'
