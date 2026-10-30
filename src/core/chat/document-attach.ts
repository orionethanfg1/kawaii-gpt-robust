import type { Attachment } from '../conversation'
import {
  progressiveSlice,
  parseReadingAdvance,
  splitIntoChapters,
  PROGRESSIVE_SLICE_CHARS,
  effectiveProgressiveSliceChars
} from './document-chunks'
import {
  type DocReadingState,
  emptyDocReadingState,
  makeSourceFingerprint,
  documentSourceChanged,
  markSliceRead,
  buildRollingReadingBlock,
  makeDocReadingKey
} from './document-reading-state'

import {
  shouldPreferReadAndRemember,
  ingestDocumentOffline,
  detectDocSeekIntent,
  seekAndRereadPassage,
  buildReadAndRememberOpinionBlock,
  buildDocSeekInjectBlock,
  type DocReadingStateRemember
} from './document-read-remember'

const TEXT_EXT =
  /\.(txt|md|markdown|json|csv|tsv|log|ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|css|html|xml|yaml|yml|toml|ini|env|sql)$/i
const MAX_CHARS = 2_000_000
const MAX_FILE_BYTES = 4 * 1024 * 1024
/** Office / PDF — extracted via main IPC (tools/doc_read.py) */
const OFFICE_EXT =
  /\.(docx|pdf)$/i
const MAX_OFFICE_BYTES = 40 * 1024 * 1024

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

/**
 * D1 — If textContent was thinned for quota but filePath exists, reload full text from disk.
 * Safe no-op outside Electron / without IPC.
 */
function looksLikeReadableDocText(s: string): boolean {
  const t = String(s || '')
  if (t.length < 40) return false
  // Reject obvious binary / ZIP (docx) garbage
  if (t.charCodeAt(0) === 0 || t.startsWith('PK') || t.slice(0,4).includes('PK') || /\u0000/.test(t.slice(0, 200))) return false
  const sample = t.slice(0, 800)
  const printable = (sample.match(/[\x09\x0a\x0d\x20-\x7e\u00a0-\u024f\u1e00-\u1eff]/g) || []).length
  return printable / Math.max(sample.length, 1) > 0.85
}

/** Candidate paths for a thinned attachment (original + .extract.txt in app-context). */
function candidateTextPaths(filePath: string, fileName?: string): string[] {
  const path = String(filePath || '').trim()
  const name = String(fileName || '').trim()
  const out: string[] = []
  if (path) out.push(path)
  // same dir: foo.docx → foo.extract.txt
  if (path && /\.(docx|pdf|odt)$/i.test(path)) {
    out.push(path.replace(/\.[^.]+$/i, '') + '.extract.txt')
  }
  if (name && /\.(docx|pdf|odt)$/i.test(name)) {
    const base = name.replace(/\.[^.]+$/i, '') + '.extract.txt'
    // common app-context sibling when original is under user-uploads
    if (path.includes('user-uploads')) {
      out.push(path.replace(/user-uploads/i, 'app-context').replace(/[^\\/]+$/, base))
    }
    if (path.includes('chat-attachments')) {
      out.push(path.replace(/chat-attachments/i, 'app-context').replace(/[^\\/]+$/, base))
    }
  }
  return [...new Set(out.filter(Boolean))]
}

export async function hydrateAttachmentTextsFromDisk(
  attachments: Attachment[] | undefined | null
): Promise<Attachment[]> {
  if (!attachments?.length) return attachments || []
  const kawaii =
    typeof window !== 'undefined'
      ? (
          window as unknown as {
            kawaii?: {
              filesReadTextPath?: (
                p: string
              ) => Promise<{ ok?: boolean; text?: string; totalChars?: number }>
              filesEnsureDocExtract?: (p: {
                sourcePath?: string
                extractPath?: string
                name?: string
              }) => Promise<{
                ok?: boolean
                text?: string
                totalChars?: number
                extractPath?: string
                repaired?: boolean
              }>
            }
          }
        ).kawaii
      : undefined
  const read = kawaii?.filesReadTextPath
  const ensure = kawaii?.filesEnsureDocExtract
  if (typeof read !== 'function' && typeof ensure !== 'function') return attachments

  const out: Attachment[] = []
  for (const a of attachments) {
    if (!a) {
      out.push(a)
      continue
    }
    const path = (a.filePath || '').trim()
    const text = (a.textContent || '').trim()
    const name = a.name || ''
    // Always try repair: find original office by name, rewrite .extract.txt if longer
    if (typeof ensure === 'function' && (path || name)) {
      try {
        const extractPath = /\.extract\.txt$/i.test(path)
          ? path
          : path && !/\.(docx|pdf)$/i.test(path)
            ? path
            : undefined
        const sourcePath = /\.(docx|pdf)$/i.test(path) ? path : undefined
        const er = await ensure({
          sourcePath,
          extractPath,
          name: name || path
        })
        if (er?.ok && er.extractPath && typeof read === 'function') {
          const rr = await read(er.extractPath)
          const full =
            rr?.ok && rr.text && rr.text.length > 0
              ? rr.text
              : er.text || text
          if (full.trim().length >= text.length) {
            out.push({
              ...a,
              textContent: full.trim(),
              filePath: er.extractPath
            })
            continue
          }
        } else if (er?.ok && er.text && er.text.trim().length > text.length) {
          out.push({
            ...a,
            textContent: er.text.trim(),
            filePath: er.extractPath || path || a.filePath
          })
          continue
        }
      } catch {
        /* fall through */
      }
    }
    if (typeof read !== 'function') {
      out.push(a)
      continue
    }
    try {
      let best = text
      for (const cand of candidateTextPaths(path, a.name)) {
        try {
          const r = await read(cand)
          if (r?.ok && r.text && looksLikeReadableDocText(r.text) && r.text.trim().length > best.length) {
            best = r.text.trim()
          }
        } catch {
          /* try next */
        }
      }
      if (best.length > text.length) {
        out.push({ ...a, textContent: best })
      } else {
        out.push(a)
      }
    } catch {
      out.push(a)
    }
  }
  return out
}

/** Collect document-like attachments from chat history (for «continuar lectura» without re-upload). */
export function collectDocAttachmentsFromMessages(
  messages: Array<{ attachments?: Attachment[] | null }> | undefined | null
): Attachment[] {
  if (!messages?.length) return []
  const byKey = new Map<string, Attachment>()
  for (let i = messages.length - 1; i >= 0; i--) {
    const atts = messages[i].attachments
    if (!atts?.length) continue
    for (const a of atts) {
      if (!a) continue
      if (a.mimeType?.startsWith('image/') || a.mimeType?.startsWith('audio/')) continue
      const key = (a.filePath || a.name || a.id || '').toLowerCase()
      if (!key) continue
      if (!byKey.has(key)) byKey.set(key, a)
    }
  }
  return [...byKey.values()]
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
    const srcFp = makeSourceFingerprint(full.length, 0)
    let state =
      priorMap.get(key) ||
      priorMap.get(convId + '::name::' + d.name.toLowerCase()) ||
      emptyDocReadingState(convId, d.name, full.length, chapters.length, {
        fingerprint: srcFp
      })

    // Delta: same name but body length fingerprint changed → re-ingest (new extract)
    if (
      state.sourceFingerprint &&
      documentSourceChanged(state, full.length, 0) &&
      state.totalChars !== full.length
    ) {
      state = emptyDocReadingState(convId, d.name, full.length, chapters.length, {
        fingerprint: srcFp
      })
    } else if (!state.sourceFingerprint) {
      state = { ...state, sourceFingerprint: srcFp }
    }

    // Soft name match when totalChars changed (partial extract → full hydrate)
    if ((!state.readTitles?.length && !state.streamOffset) || state.totalChars !== full.length) {
      const byName = priorMap.get(convId + '::name::' + d.name.toLowerCase())
      if (
        byName &&
        byName.fileName &&
        d.name &&
        byName.fileName.toLowerCase() === d.name.toLowerCase() &&
        ((byName.readTitles?.length || 0) > 0 || (byName.streamOffset || 0) > 0)
      ) {
        state = {
          ...byName,
          key,
          totalChars: full.length,
          chapterCount: chapters.length
        }
      }
    }

    // Refresh chapter count if structure changed
    state = { ...state, chapterCount: chapters.length, totalChars: full.length, key }

    // ——— Modo «Leer y recordar»: ingesta silenciosa + una opinión; seek puntual ———
    {
      const priorRem = state as DocReadingStateRemember
      const mode = shouldPreferReadAndRemember({
        totalChars: full.length,
        userMessage: opts?.userMessage,
        existing: priorRem
      })
      if (mode === 'read_and_remember') {
        let rem: DocReadingStateRemember =
          priorRem.mode === 'read_and_remember'
            ? { ...priorRem }
            : { ...priorRem, mode: 'read_and_remember' }
        const seek = detectDocSeekIntent(opts?.userMessage || '')
        if (!rem.ingestComplete || !(rem.chapterMemories && rem.chapterMemories.length)) {
          rem = ingestDocumentOffline(full, {
            convId,
            fileName: d.name,
            prior: rem
          })
        }
        if (seek.seek) {
          const found = seekAndRereadPassage({
            fullText: full,
            state: rem,
            chapterNum: seek.chapterNum,
            query: seek.query
          })
          nextStates.push(found.state)
          if (found.found) {
            parts.push(
              buildDocSeekInjectBlock({
                fileName: d.name,
                title: found.title,
                chapterIndex: found.chapterIndex,
                body: found.body,
                state: found.state
              })
            )
            hints.push('Relectura puntual: ' + (found.title || 'tramo') + ' (' + found.reason + ')')
          } else {
            nextStates.push(rem)
            parts.push(
              buildReadAndRememberOpinionBlock({ state: rem, fileName: d.name }) +
                String.fromCharCode(10) +
                '[SEEK] No se localizó un tramo concreto; responde desde el índice y el resumen sin inventar capítulos.'
            )
            hints.push('Seek sin match · índice en memoria')
          }
          if (rem.rollingSummary?.trim()) rollingBits.push(buildRollingReadingBlock(rem))
          continue
        }
        nextStates.push(rem)
        parts.push(buildReadAndRememberOpinionBlock({ state: rem, fileName: d.name }))
        if (rem.rollingSummary?.trim()) rollingBits.push(buildRollingReadingBlock(rem))
        hints.push(
          rem.ingestComplete
            ? 'Leer y recordar · ' + rem.chapterCount + ' tramos indexados'
            : 'Leer y recordar · progreso ' + rem.chapterIndex + '/' + rem.chapterCount
        )
        continue
      }
    }

    // state.chapterIndex = next chapter to present (cursor after last completed slice)
    let idx = opts?.chapterIndex ?? state.chapterIndex ?? 0
    if (opts?.userMessage) {
      const adv = parseReadingAdvance(opts.userMessage, idx, chapters.length)
      if (adv != null) idx = adv
      const um = opts.userMessage || ''
      if (/\b(sigue|continua|contin[uú]a|siguiente|next chapter)\b/i.test(um) && state.readTitles.length) {
        const lastTitle = state.readTitles[state.readTitles.length - 1] || ''
        const lastHit = chapters.findIndex(
          (c) => c.title && lastTitle && c.title.indexOf(lastTitle.slice(0, 24)) >= 0
        )
        if (lastHit >= 0 && idx <= lastHit) {
          idx = Math.min(chapters.length - 1, lastHit + 1)
        }
      }
    }
    // First upload with no prior progress: start at 0
    if (!state.readTitles.length && !state.rollingSummary && !(opts?.userMessage||'').trim()) idx = opts?.chapterIndex ?? 0
    // If cursor is past the end, keep it there (complete) — do not clamp back to last chapter
    if (idx >= chapters.length) {
      idx = chapters.length
    } else {
      idx = Math.max(0, Math.min(chapters.length - 1, idx))
    }

    // Already finished the book: don't re-inject the last chapter
    if (idx >= chapters.length && state.readTitles.length) {
      const doneState = {
        ...state,
        chapterIndex: chapters.length,
        chapterCount: chapters.length,
        updatedAt: Date.now()
      }
      nextStates.push(doneState)
      rollingBits.push(buildRollingReadingBlock(doneState))
      hints.push('Documento ya leído por completo (' + chapters.length + ' tramos).')
      parts.push(
        '--- Documento ' +
          (i + 1) +
          ': ' +
          (d.name || 'sin-nombre') +
          ' · LECTURA COMPLETA (' +
          chapters.length +
          ' tramos) ---' +
          String.fromCharCode(10) +
          'No hay tramo nuevo. Usa el resumen de progreso y responde con opinión global o espera petición de capítulo concreto.' +
          String.fromCharCode(10) +
          '---'
      )
      continue
    }

    const umsg = (opts?.userMessage || '').trim()
    // APP/auto-continue prompts mention «siguiente capítulo» — do NOT shrink the slice
    const isAppDocInstr =
      /^\[APP\]/i.test(umsg) ||
      /continuar la lectura del documento|Continuación automática de lectura/i.test(umsg)
    const oneChapter =
      !isAppDocInstr &&
      /\b(siguiente(\s+el)?(\s+capitulo|\s+cap[ií]tulo)|capítulo\s+\d+|capitulo\s+\d+)\b/i.test(
        umsg
      ) &&
      !/\binicio\b/i.test(umsg)
    // Absolute stream offset: always advance through long chapters (Cap. 10 stuck fix)
    let streamOff = Number(state.streamOffset || 0)
    if (!Number.isFinite(streamOff) || streamOff < 0) streamOff = 0
    // If chapter cursor jumped ahead of offset, sync offset to chapter start
    if (idx < chapters.length && streamOff < (chapters[idx]?.start || 0)) {
      streamOff = chapters[idx].start
    }
    // APP continue / sigue: if offset hasn't moved, force from current chapter start + already-read within ch
    const slice = progressiveSlice(full, {
      chapterIndex: idx,
      streamOffset: streamOff,
      maxChars: oneChapter
        ? Math.min(
            effectiveProgressiveSliceChars(),
            Math.max(4000, Math.min((chapters[idx]?.text || '').length + 200, effectiveProgressiveSliceChars()))
          )
        : effectiveProgressiveSliceChars()
    })
    const titles =
      slice.titles?.length ? slice.titles : slice.chapterTitle ? [slice.chapterTitle] : []

    // Next cursor = after last chapter of this slice (may equal chapters.length → complete)
    // BUGFIX: never clamp to length-1 or the reader sticks on the last chapter forever
    let nextOff = Math.min(
      full.length,
      Number(slice.nextStreamOffset != null ? slice.nextStreamOffset : streamOff + (slice.body || '').length)
    )
    // Always advance at least the injected body (or 1k) so Continuar never re-sends the same window
    const minAdvance = Math.max((slice.body || '').length, Math.min(4000, effectiveProgressiveSliceChars()))
    if (nextOff <= streamOff && streamOff < full.length) {
      nextOff = Math.min(full.length, streamOff + minAdvance)
    }
    if ((slice.body || '').length > 0 && nextOff <= streamOff) {
      nextOff = Math.min(full.length, streamOff + (slice.body || '').length)
    }
    // Chapter cursor: if still inside same long chapter, keep index; else next after last
    let nextCursor = Math.min(chapters.length, slice.lastChapterIndex + 1)
    if (nextOff < full.length && nextOff < (chapters[slice.lastChapterIndex]?.end || full.length)) {
      nextCursor = slice.lastChapterIndex
    }
    // Near end of extract → treat as complete (truncated docx used to leave a zombie button)
    if (full.length > 0 && nextOff >= full.length * 0.98) {
      nextOff = full.length
      nextCursor = chapters.length
    }
    if (nextOff >= full.length) nextCursor = chapters.length

    const next = markSliceRead(state, {
      chapterIndex: nextCursor,
      lastChapterIndex: slice.lastChapterIndex,
      titles,
      sliceBody: slice.body,
      streamOffset: nextOff
    })
    nextStates.push(next)

    // Prefer previous state's rolling (before this slice) for context
    if (state.rollingSummary.trim() || state.readTitles.length) {
      rollingBits.push(buildRollingReadingBlock(state))
    }

    hints.push(slice.hint)
    const pct = full.length
      ? Math.min(100, Math.round((nextOff / full.length) * 100))
      : 0
    parts.push(
      '--- Documento ' +
        (i + 1) +
        ': ' +
        (d.name || 'sin-nombre') +
        ' (' +
        (d.mimeType || 'text') +
        ') · tramo ' +
        String(idx + 1) +
        '-' +
        String(slice.lastChapterIndex + 1) +
        '/' +
        String(chapters.length) +
        ' · ' +
        (slice.titles.length ? slice.titles.join(' | ') : slice.chapterTitle) +
        ' · avance ' +
        String(streamOff) +
        '-' +
        String(nextOff) +
        '/' +
        String(full.length) +
        ' chars (' +
        String(pct) +
        '%) ---' +
        String.fromCharCode(10) +
        'INSTRUCCIÓN: este extracto es NUEVO respecto al tramo anterior (offset ' +
        String(streamOff) +
        '). Comenta lo que aparece AQUÍ; si el título sigue siendo el mismo capítulo, di que avanzaste DENTRO de ese capítulo, no que re-leíste el inicio.' +
        String.fromCharCode(10) +
        slice.body +
        String.fromCharCode(10) +
        '---'
    )
  }

  const rules =
    '[MODO_DOCUMENTO] El usuario compartió texto de archivo(s). Responde SOBRE ese contenido AHORA:' +
    String.fromCharCode(10) +
    '- PRIORIDAD: da ya una opinión/análisis del tramo leído (lo que está en [DOCUMENTOS_ADJUNTOS]). No digas solo «quiero leerlo» o «cuéntame» si el texto ya está aquí.' +
    String.fromCharCode(10) +
    '- Longitud: evita respuestas cortas. Objetivo ~600–1500 palabras o el máximo de tokens disponible. Varios párrafos.' +
    String.fromCharCode(10) +
    '- Estructura en texto plano SIN markdown (# ## ### ni **negritas** de título): (1) Qué leíste y hasta dónde, (2) Impresión y tono, (3) Detalles concretos, (4) Qué engancha o flojea, (5) Cierre + «sigue» si queda libro.' +
    String.fromCharCode(10) +
    '- Cita o parafrasea del extracto. Personalidad OK; el análisis es la mayor parte. Prohibido encabezados Markdown.' +
    String.fromCharCode(10) +
    '- Si el extracto es parcial, una línea de aviso y comenta SOLO lo presente. No inventes capítulos ausentes del extracto ni del resumen de progreso.' +
    String.fromCharCode(10) +
    '- No cortes a mitad de idea: cierra la sección en curso.'

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
