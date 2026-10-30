/**
 * Context eviction policy (docs + images)
 * ----------------------------------------
 * Active context = only what the *current turn* needs.
 * Long documents and past image pixels live on disk / memory layers and are
 * re-hydrated on demand (continuar lectura, seek, "qué decía el cap. X").
 *
 * Does not replace progressive reading or read-and-remember — it gates when
 * their *full text* enters the system prompt.
 */

import type { ChatMessage } from '../providers/types'
import type { DocReadingState } from './document-reading-state'

export type ContextTurnKind = 'vision' | 'doc_active' | 'doc_memory' | 'general'

export type ClassifyContextTurnInput = {
  userText?: string
  /** Image dataUrl on *this* turn */
  hasImageThisTurn?: boolean
  /** User (re)attached a document this turn or pressed Continuar lectura */
  hasDocThisTurn?: boolean
  /** meta.kind from app continue chip */
  metaKind?: string
  /** There is DocReadingState for this conversation */
  hasDocReadingState?: boolean
}

const DOC_CONTINUE_RE =
  /\b(sigue|contin[uú]a|continuar(\s+leyendo)?|siguiente(\s+cap[ií]tulo)?|next\s+chapter|leer\s+m[aá]s|continua\s+la\s+lectura)\b/i

const DOC_SEEK_RE =
  /\b(cap[ií]tulo\s+\d+|cap\.?\s*\d+|en\s+el\s+cap|qu[eé]\s+(dec[ií]a|pas[oó]|ocurri[oó])|d[oó]nde\s+(te\s+)?quedaste|hasta\s+d[oó]nde|progreso\s+(de\s+)?lectura|has\s+le[ií]do|del\s+libro|de\s+la\s+novela|el\s+libro|rese[nñ]a\s+del\s+libro)\b/i

const DOC_OPINION_RE =
  /\b(opini[oó]n\s+(del|sobre)\s+(libro|cap)|qu[eé]\s+te\s+pareci[oó]\s+(el|la)\s+(libro|cap)|resumen\s+del\s+(libro|cap))\b/i

/**
 * Decide how heavy the prompt may be this turn.
 */
export function classifyContextTurn(input: ClassifyContextTurnInput): ContextTurnKind {
  const text = String(input.userText || '')
  const meta = String(input.metaKind || '')

  if (input.hasImageThisTurn) return 'vision'

  if (
    meta === 'app-doc-continue' ||
    input.hasDocThisTurn ||
    DOC_CONTINUE_RE.test(text) ||
    DOC_SEEK_RE.test(text) ||
    DOC_OPINION_RE.test(text)
  ) {
    return 'doc_active'
  }

  // Having a book in the library does NOT mean every chat turn is about it.
  // doc_memory only when the user clearly refers to prior reading.
  if (
    input.hasDocReadingState &&
    (DOC_SEEK_RE.test(text) || DOC_OPINION_RE.test(text) || DOC_CONTINUE_RE.test(text))
  ) {
    return 'doc_memory'
  }

  return 'general'
}

/** True when light doc memory / index may enter the system prompt. */
export function shouldInjectDocMemory(kind: ContextTurnKind): boolean {
  return kind === 'doc_active' || kind === 'doc_memory'
}

/** True when full document slices should be injected into system. */
export function shouldInjectFullDocument(kind: ContextTurnKind): boolean {
  return kind === 'doc_active'
}

/**
 * Compact memory block: progress + rolling summary — no chapter body.
 */
export function buildEvictedDocMemoryBlock(
  states: DocReadingState[] | null | undefined,
  opts?: { maxSummaryChars?: number }
): string {
  const list = (states || []).filter(Boolean)
  if (!list.length) return ''

  const maxSum = opts?.maxSummaryChars ?? 900
  const lines: string[] = [
    '[MEMORIA_DOCUMENTO — sin texto completo; re-leer solo si el usuario pide un tramo o «continuar lectura»]',
  ]

  for (const st of list.slice(0, 4)) {
    const name = st.fileName || 'documento'
    const done =
      st.ingestComplete ||
      (st.chapterCount > 0 && st.chapterIndex >= st.chapterCount)
    const progress =
      st.chapterCount > 0
        ? `progreso ~${Math.min(st.chapterCount, Math.max(0, st.chapterIndex))}/${st.chapterCount}`
        : st.streamOffset
          ? `offset ${st.streamOffset}`
          : 'en curso'
    lines.push(`• «${name}» · ${done ? 'lectura indexada' : progress}`)
    if (st.readTitles?.length) {
      lines.push(`  Títulos recientes: ${st.readTitles.slice(-8).join(' · ')}`)
    }
    if (st.chapterVisitCounts && Object.keys(st.chapterVisitCounts).length) {
      const top = Object.entries(st.chapterVisitCounts)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 4)
        .map(([k, v]) => `cap ${k}×${v}`)
        .join(', ')
      if (top) lines.push(`  Relecturas: ${top}`)
    }
    const sum = (st.rollingSummary || '').trim()
    if (sum) {
      lines.push(`  Recuerdo: ${sum.slice(0, maxSum)}${sum.length > maxSum ? '…' : ''}`)
    }
  }

  lines.push(
    'Si el usuario cambia de tema (foto, charla, otra tarea), no arrastres capítulos enteros. ' +
      'Si pregunta por un pasaje concreto o pide continuar, la app reinyectará el tramo.'
  )
  return lines.join('\n')
}

const HEAVY_DOC_RE =
  /\[DOCUMENTOS_ADJUNTOS\]|\[LECTURA_PROGRESIVA\]|\[MODO_DOCUMENTO\]|\[MODO_LEER_Y_RECORDAR\]|\[DOCUMENTO_TRAMO\]|\[EXTRACTO_/i

/** Drop full-document system blobs; keep persona, memory, vision, etc. */
export function stripHeavyDocSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  return (messages || []).filter((m) => {
    const c = m.content
    if (typeof c !== 'string') return true
    return !HEAVY_DOC_RE.test(c)
  })
}

/**
 * History hygiene: never re-send large data-URLs from prior multimodal turns.
 * Keeps text parts; replaces image parts with a short placeholder.
 */
export function stripImagePayloadsFromMessages(messages: ChatMessage[]): ChatMessage[] {
  return (messages || []).map((m) => {
    const c = m.content
    // Drop Ollama-style images[] on history
    const base: ChatMessage = { role: m.role, content: m.content }
    if (m.name) base.name = m.name

    if (Array.isArray(c)) {
      base.content = c.map((part) => {
        if (part && typeof part === 'object' && (part as { type?: string }).type === 'image_url') {
          return {
            type: 'text' as const,
            text: '[Imagen de un turno anterior omitida del contexto activo.]'
          }
        }
        return part
      })
      return base
    }

    if ((m as { images?: string[] }).images?.length) {
      const text =
        typeof c === 'string' && c.trim()
          ? c
          : '[Imagen anterior en el chat — no está en el contexto activo; adjúntala de nuevo si quieres que la vuelva a ver.]'
      base.content = text
      return base
    }
    return base
  })
}

/** Tighter pack budget when vision or when we only need doc memory. */
export function budgetForContextTurn(
  kind: ContextTurnKind,
  base: {
    maxChars?: number
    keepRecentMessages?: number
    maxSystemChars?: number
    maxMessages?: number
    maxTokensHint?: number
  }
): typeof base {
  if (kind === 'vision') {
    return {
      ...base,
      maxChars: Math.min(base.maxChars ?? 16_000, 12_000),
      keepRecentMessages: Math.min(base.keepRecentMessages ?? 10, 6),
      maxSystemChars: Math.min(base.maxSystemChars ?? 5_000, 5_500),
    }
  }
  if (kind === 'doc_memory' || kind === 'general') {
    return {
      ...base,
      maxChars: Math.min(base.maxChars ?? 16_000, 14_000),
      keepRecentMessages: Math.min(base.keepRecentMessages ?? 10, 12),
      maxSystemChars: Math.min(base.maxSystemChars ?? 8_000, 7_000),
    }
  }
  // doc_active — allow larger system for progressive slice
  return {
    ...base,
    maxSystemChars: Math.max(base.maxSystemChars ?? 5_000, 24_000),
    maxChars: Math.max(base.maxChars ?? 16_000, 36_000),
  }
}
