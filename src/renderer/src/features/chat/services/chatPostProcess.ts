/**
 * Post-process of assistant bubbles — stream merge (light) + final pipeline (modular).
 * Heavy cleanup lives in @core/chat/assistant-reply-pipeline.
 */
import {
  processAssistantReplyForDisplay,
  finalizeAssistantReply
} from '@core/chat/assistant-reply-pipeline'
import { stripThinkingLeak } from '@core/chat/strip-thinking'
import { stripHarnessMarkup } from '@core/agent'
import { collapseRepeatedOpeners } from '@core/chat/collapse-openers'

/** Merge a stream chunk into accumulated text (cumulative vs delta). */
export function mergeStreamToken(prev: string, piece: string): string {
  const p = String(prev || '')
  const t = String(piece || '')
  if (!t) return p
  if (!p) return t
  if (t === p || p.endsWith(t)) return p
  if (t.startsWith(p)) return t
  if (t.length >= p.length && t.includes(p.slice(0, Math.min(64, p.length)))) return t
  if (p.includes(t) && t.length < 80) return p

  let next = p + t
  // Light: glued "Me encanta" restarts mid-stream
  const openHits = next.match(/\bMe encanta(?:n)?\b/gi)
  if (openHits && openHits.length >= 3 && next.length > 120) {
    next = collapseRepeatedOpeners(next)
  }
  // Mid-stream: second "Hola" restart
  const holaHits = next.match(/¡?\s*Hola(?:\s+de\s+nuevo)?\b/gi)
  if (holaHits && holaHits.length >= 2 && next.length > 80) {
    const re = /¡?\s*Hola(?:\s+de\s+nuevo)?\b/gi
    re.exec(next)
    const second = re.exec(next)
    if (second && second.index > 20) {
      next = next.slice(0, second.index).trim()
    }
  }
  return next
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
    if (/<\/(?:think|thinking|reasoning)>/i.test(t) || looksMostlyCot(t)) {
      t = stripThinkingLeak(t)
    }
    if (
      (/\bMe encanta(?:n)?\b/i.test(t) && (t.match(/\bMe encanta/gi) || []).length >= 2) ||
      (/\bGracias[,\s]/i.test(t) && (t.match(/\bGracias/gi) || []).length >= 2)
    ) {
      t = cutAtSecondRestart(t)
      t = collapseRepeatedOpeners(t)
    }
    return t
  } catch {
    return String(text || '')
  }
}

function looksMostlyCot(t: string): boolean {
  return /^(Okay,|Alright,|First, I|Hmm,|Wait, the|The user asked|As \w+, I need)/i.test(
    t.trim().slice(0, 80)
  )
}
