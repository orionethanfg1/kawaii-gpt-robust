/**
 * B1 — Single owner of post-process for finished assistant bubbles.
 *
 * Layers (kept separate on purpose):
 *   raw          — provider output (before cleanup)
 *   display      — what the user sees (dedupe loops, strip thinking)
 *   memorySource — milder cleanup so distinct preferences survive extraction
 */

import { stripThinkingLeak } from './strip-thinking'
import { collapseLoopAssistantText } from './collapse-repeat'
import { collapseRepeatedOpeners, cutAtSecondRestart, collapseAyNameOpeners, dedupeAyOpenersAcrossTurns, dedupeLeadingSentenceAcrossTurns } from './collapse-openers'
import { stripHarnessMarkup } from '../agent'

export type ReplyPipelineOpts = {
  characterName?: string
  /** Preferred user name (¡Ay, Nahum!) */
  userName?: string
  /** Cap sentences for short user prompts (prefer undefined — B1 avoids hard caps) */
  maxSentences?: number
  /** Previous assistant message (for opener dedupe across turns) */
  previousAssistant?: string
  /** Recent assistant texts newest-first (CV1 opener variety) */
  recentAssistants?: string[]
}

export type FinalizedReply = {
  raw: string
  display: string
  memorySource: string
  /** Provider finish reason when known */
  finishReason?: string | null
  /** True when provider signaled length/max_tokens stop */
  limited?: boolean
}

function isLengthLimited(reason?: string | null): boolean {
  if (!reason) return false
  const r = reason.toLowerCase()
  return (
    r === 'length' ||
    r === 'max_tokens' ||
    r.includes('length') ||
    r.includes('max_token')
  )
}

/**
 * Normalize a finished assistant reply for display.
 */

/** If provider hit max tokens mid-sentence, end gently (no robot meta). */
export function softCompleteIfTruncated(text: string, limited?: boolean): string {
  let t = String(text || '').trimEnd()
  if (t.length < 20) return t
  if (/[.!?…)"»]$/.test(t)) return t
  // Detect hanging tail even when finish_reason is missing (stream cut)
  const hangWord =
    /\s(?:Es|Y|Pero|Aunque|Por|La|El|Los|Las|Un|Una|Me|Te|Se|como|que|de|en|con|sin|para|porque|cuando|donde|si|al|del)$/i.test(
      t
    )
  const midWord = /[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}$/.test(t) && !/\s/.test(t.slice(-12)) && t.length > 80
  if (limited || hangWord || midWord) {
    return t.replace(/\s+$/, '') + '…'
  }
  return t
}

/** Long single-paragraph replies → light paragraph breaks for readability. */
export function paragraphifyLongReply(text: string, minLen = 360): string {
  let t = String(text || '')
  if (t.length < minLen) return t
  const br = String.fromCharCode(10)
  let newlineCount = 0
  for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) newlineCount++
  if (newlineCount >= 3) return t
  // sentence boundary → paragraph when dense (Spanish + Latin caps)
  t = t.replace(
    /([.!?…])\s+(?=[A-ZÁÉÍÓÚÜÑ¿¡«"])/g,
    (full, p1: string, offset: number) => {
      const before = t.slice(Math.max(0, offset - 160), offset)
      if (before.length < 50) return p1 + ' '
      return p1 + br + br
    }
  )
  while (t.indexOf(br + br + br) >= 0) t = t.split(br + br + br).join(br + br)
  return t.trim()
}

export function processAssistantReplyForDisplay(
  raw: string,
  opts?: ReplyPipelineOpts
): string {
  let t = String(raw || '')
  try {
    t = stripHarnessMarkup(t)
  } catch {
    /* optional */
  }
  t = stripThinkingLeak(t)
  t = collapseRepeatedOpeners(t)
  t = dedupeAyOpenersAcrossTurns(t, {
    characterName: opts?.characterName,
    userName: opts?.userName,
    previousAssistant: opts?.previousAssistant,
    recentAssistants: opts?.recentAssistants
  })
  t = dedupeLeadingSentenceAcrossTurns(t, opts?.previousAssistant)
  t = collapseLoopAssistantText(t, opts?.characterName, opts?.maxSentences)
  t = collapseRepeatedOpeners(t)
  t = collapseAyNameOpeners(t, opts?.characterName)
  t = paragraphifyLongReply(t)
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * B1 — Milder cleanup for memory extraction.
 * Strip thinking/harness + Gracias restart loops only.
 * Do not collapse distinct "Me encanta A" / "Me encanta B".
 */
export function processAssistantReplyForMemory(raw: string): string {
  let t = String(raw || '')
  try {
    t = stripHarnessMarkup(t)
  } catch {
    /* optional */
  }
  t = stripThinkingLeak(t)
  // Only hard cut demonstrable Gracias restarts; leave preference lists intact
  try {
    t = cutAtSecondRestart(t)
  } catch {
    /* keep */
  }
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

/** Structured finalize — single entry for display + memory + provider meta. */
export function finalizeAssistantReply(
  raw: string,
  opts?: ReplyPipelineOpts & { finishReason?: string | null }
): FinalizedReply {
  const r = String(raw || '')
  const finishReason = opts?.finishReason ?? null
  const limited = isLengthLimited(finishReason)
  let display = processAssistantReplyForDisplay(r, opts)
  const hang =
    limited ||
    (display.length > 200 &&
      /\s(?:Es|Y|Pero|Aunque|como|que|de|en|por|con|sin)$/i.test(display.trim()))
  display = softCompleteIfTruncated(display, hang)
  return {
    raw: r,
    display,
    memorySource: processAssistantReplyForMemory(r),
    finishReason,
    limited
  }
}
