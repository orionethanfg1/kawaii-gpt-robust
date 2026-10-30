/**
 * Post-process of assistant bubbles — stream merge (light) + final pipeline (modular).
 * Heavy cleanup lives in @core/chat/assistant-reply-pipeline.
 */
import {
  processAssistantReplyForDisplay,
  finalizeAssistantReply
} from '@core/chat/assistant-reply-pipeline'
import { stripThinkingLeak, looksLikeStructuredReasoningDump } from '@core/chat/strip-thinking'
import { stripHarnessMarkup } from '@core/agent'
import { collapseRepeatedOpeners } from '@core/chat/collapse-openers'

/**
 * Merge a stream chunk into accumulated text (cumulative vs delta).
 * Critical: never drop short deltas just because the same letters already
 * appeared earlier (« de», « la», « *») — that glued words (míoNahum).
 */
export function mergeStreamToken(prev: string, piece: string): string {
  const p = String(prev || '')
  const t = String(piece || '')
  if (!t) return p
  if (!p) return t
  // Exact / trailing duplicate of this delta only
  if (t === p) return p
  if (p.endsWith(t)) return p
  // Full cumulative snapshot (provider re-sends whole text)
  if (t.startsWith(p)) return t
  if (
    t.length > p.length + 8 &&
    t.startsWith(p.slice(0, Math.min(48, p.length)))
  ) {
    return t
  }
  // Overlap: last N chars of prev are prefix of piece (SSE re-sync)
  const maxOverlap = Math.min(p.length, t.length, 32)
  for (let n = maxOverlap; n >= 4; n--) {
    if (p.endsWith(t.slice(0, n))) {
      return p + t.slice(n)
    }
  }
  return p + t
}

export type FinalizeOpts = {
  characterName?: string
  userTextLen?: number
}

/** Final pass after stream completes — single modular pipeline. */
export function finalizeAssistantText(raw: string, opts?: FinalizeOpts): string {
  try {
    const userLen = opts?.userTextLen ?? 999
    const shortUser = userLen <= 40
    const veryShort = userLen <= 12
    // Repetition is handled by collapse-openers (identical restarts only).
    // Do NOT hard-cap sentences here — that truncates mid-thought (user report).
    return finalizeAssistantReply(raw, {
      characterName: opts?.characterName,
      maxSentences: undefined
    }).display
  } catch (e) {
    console.warn('[chatPostProcess]', e)
    return String(raw || '')
  }
}

/** Light strip while streaming. */
export function stripWhileStreaming(text: string): string {
  try {
    let t = stripHarnessMarkup(String(text || ''))
    if (looksLikeStructuredReasoningDump(t)) {
      return '' // show empty bubble until real answer tokens arrive
    }
    if (/<\/(?:think|thinking|reasoning)>/i.test(t) || looksMostlyCot(t)) {
      t = stripThinkingLeak(t)
    }
    // Only collapse short duplicate openers — never chop long streamed replies (LMS 2k+ tokens)
    if (t.length < 1200) {
      if (
        (/\bMe encanta(?:n)?\b/i.test(t) && (t.match(/\bMe encanta/gi) || []).length >= 2) ||
        (/\bGracias[,\s]/i.test(t) && (t.match(/\bGracias/gi) || []).length >= 2)
      ) {
        t = cutAtSecondRestart(t)
        t = collapseRepeatedOpeners(t)
      }
    }
    return t
  } catch {
    return String(text || '')
  }
}

function looksMostlyCot(t: string): boolean {
  const head = t.trim().slice(0, 120)
  return (
    /^(Okay,|Alright,|First, I|Hmm,|Wait, the|The user asked|As \w+, I need)/i.test(head) ||
    /^\*?\s*(Input|Context\/?State|Constraint Check)\s*:/i.test(head) ||
    /\bConstraint Check\s*\(Instruction\)/i.test(head)
  )
}
