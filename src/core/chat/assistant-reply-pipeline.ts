import { balanceSingleAsterisks } from './normalize-markdown'
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
import { correctSelfGenderSpanish } from '../character/gender-agreement'
import type { GenderMark } from '../character/pronouns'

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
  /** Assistant gender for Spanish self-agreement fix */
  assistantGender?: GenderMark
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

/**
 * Heuristic: reply looks cut mid-thought even without finish_reason=length.
 * e.g. ends with «nuestro propio» / no terminal punctuation on a long bubble.
 */
export function looksIncompleteAssistantTail(text: string): boolean {
  const t = String(text || '').trim()
  if (t.length < 40) return false
  // Clean ending
  if (/[.!?…)"»]$/.test(t)) return false
  // Hanging function words / determiners
  if (
    /\s(?:Es|Y|Pero|Aunque|Por|La|El|Los|Las|Un|Una|Me|Te|Se|como|que|de|en|con|sin|para|porque|cuando|donde|si|al|del|nuestro|nuestra|mi|tu|su|este|esta|ese|esa|unos|unas|los|las)\s*$/i.test(
      t
    )
  ) {
    return true
  }
  // Incomplete fixed phrases often cut by max_tokens
  if (
    /\b(propio|propia|mismos|mismas|mismo|misma|siguiente|pr[oó]ximo|pr[oó]xima|encuentro|momento|beso|cuerpo)\s*$/i.test(
      t
    )
  ) {
    return true
  }
  // Cut mid-word
  if (/[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}$/.test(t) && !/\s/.test(t.slice(-10)) && t.length > 80) {
    return true
  }
  // Long reply with no sentence end in the tail → likely truncated
  if (t.length > 180 && !/[.!?…]/.test(t.slice(-100))) {
    return true
  }
  // ¿… without ?
  if (/¿[^?]*$/.test(t) && !/\?\s*$/.test(t)) return true
  // Ends with long word, no terminal punct
  if (t.length > 120 && /[a-záéíóúñ]{5,}$/i.test(t) && !/[.!?…»")\]]\s*$/.test(t)) {
    return true
  }
  return false
}

/** If provider hit max tokens mid-sentence, end gently (no robot meta). */
export function softCompleteIfTruncated(text: string, limited?: boolean): string {
  let t = String(text || '').trimEnd()
  if (t.length < 20) return t
  if (/[.!?…)"»]$/.test(t)) return t
  if (limited || looksIncompleteAssistantTail(t)) {
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
  if (opts?.assistantGender && opts.assistantGender !== 'neutral') {
    try {
      t = correctSelfGenderSpanish(t, opts.assistantGender)
    } catch {
      /* optional */
    }
  }
  try {
    t = balanceSingleAsterisks(t)
  } catch {
    /* optional */
  }
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
  let limited = isLengthLimited(finishReason)
  let display = processAssistantReplyForDisplay(r, opts)
  if (!limited && looksIncompleteAssistantTail(display)) {
    limited = true
  }
  display = softCompleteIfTruncated(display, limited)
  return {
    raw: r,
    display,
    memorySource: processAssistantReplyForMemory(r),
    finishReason,
    limited
  }
}
