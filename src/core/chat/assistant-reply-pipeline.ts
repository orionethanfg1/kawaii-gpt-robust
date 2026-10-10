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
import { collapseRepeatedOpeners, cutAtSecondRestart } from './collapse-openers'
import { stripHarnessMarkup } from '../agent'

export type ReplyPipelineOpts = {
  characterName?: string
  /** Cap sentences for short user prompts (prefer undefined — B1 avoids hard caps) */
  maxSentences?: number
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
  t = collapseLoopAssistantText(t, opts?.characterName, opts?.maxSentences)
  t = collapseRepeatedOpeners(t)
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
  return {
    raw: r,
    display: processAssistantReplyForDisplay(r, opts),
    memorySource: processAssistantReplyForMemory(r),
    finishReason,
    limited: isLengthLimited(finishReason)
  }
}
