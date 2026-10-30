/**
 * Document ingest as a lightweight ETL pipeline (local-first, no vector DB required).
 *
 * Industry RAG stages mapped to Kawaii:
 *   Extract  → parse attachment text (already done in document-attach)
 *   Transform → MAP heuristic per chapter + optional REDUCE LLM once (canonical index)
 *   Load     → DOC_READ facts + rollingSummary / canonicalIndex for later retrieval
 *
 * We do NOT embed all chunks (VRAM). Hierarchical summary index pattern:
 * one canonical index per document, seek+reread only when needed.
 */

import type { DocReadingState } from './document-reading-state'

export type DocIngestPhase =
  | 'idle'
  | 'extract'
  | 'map'
  | 'reduce'
  | 'seed' // LLM canonical index (once)
  | 'load'
  | 'ready'
  | 'error'

export type DocIngestJob = {
  key: string
  convId: string
  fileName: string
  phase: DocIngestPhase
  /** 0–100 visual progress */
  progress: number
  detail: string
  updatedAt: number
  error?: string
}

/** Derive phase from reading state (for UI without a separate job row). */
export function phaseFromDocState(
  state: DocReadingState & {
    ingestComplete?: boolean
    mode?: string
    canonicalIndex?: string
    seedAt?: number
  }
): DocIngestJob {
  const fileName = state.fileName || 'documento'
  const key = state.key
  const convId = state.convId
  const base = { key, convId, fileName, updatedAt: state.updatedAt || Date.now() }

  if (state.canonicalIndex && state.canonicalIndex.trim().length > 40) {
    return {
      ...base,
      phase: 'ready',
      progress: 100,
      detail: 'Índice canónico listo · lecturas posteriores usan memoria'
    }
  }

  if (state.ingestComplete || state.mode === 'read_and_remember') {
    if ((state.rollingSummary || '').length > 80) {
      return {
        ...base,
        phase: 'seed',
        progress: 85,
        detail: 'Ingesta MAP lista · generando índice natural (1× LLM)…'
      }
    }
    return {
      ...base,
      phase: 'map',
      progress: 60,
      detail: 'MAP por capítulos (heurística)…'
    }
  }

  const total = Math.max(1, state.chapterCount || 1)
  const idx = Math.min(state.chapterIndex || 0, total)
  const pct = Math.round((idx / total) * 70)
  // Chapters done: never stuck on REDUCE in UI — heuristic summary is enough until seed finishes
  if (idx >= total) {
    if ((state.rollingSummary || '').trim().length > 40) {
      return {
        ...base,
        phase: 'ready',
        progress: 100,
        detail: 'Lectura completa · resumen disponible (índice LLM opcional)'
      }
    }
    return {
      ...base,
      phase: 'reduce',
      progress: 80,
      detail: 'REDUCE · compactando resumen rodante…'
    }
  }
  return {
    ...base,
    phase: 'map',
    progress: Math.max(5, pct),
    detail: `MAP tramo ${idx + 1}/${total}` + (state.readTitles?.length ? ` · ${state.readTitles.slice(-1)[0]}` : '')
  }
}

/** System block for later turns: prefer canonical index over raw book. */
export function buildCanonicalIndexBlock(
  state: DocReadingState & { canonicalIndex?: string; ingestComplete?: boolean }
): string {
  const idx = (state.canonicalIndex || '').trim()
  if (!idx) return ''
  return (
    `[DOC_INDEX canónico · ${state.fileName || 'documento'}]\n` +
    'Usa este índice en lecturas posteriores. No re-inyectes el libro entero. ' +
    'Si el usuario pide un capítulo ausente aquí, pide relectura puntual.\n' +
    idx.slice(0, 2200)
  )
}

export function shouldRunCanonicalSeed(
  state: DocReadingState & {
    ingestComplete?: boolean
    canonicalIndex?: string
    mode?: string
  }
): boolean {
  if ((state.canonicalIndex || '').trim().length > 40) return false
  if (state.ingestComplete) return true
  if (state.mode === 'read_and_remember' && (state.rollingSummary || '').length > 120) return true
  if (state.chapterIndex >= (state.chapterCount || 1) && (state.rollingSummary || '').length > 120) {
    return true
  }
  return false
}
