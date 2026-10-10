/**
 * Post-reply memory collector (assistant individuality).
 * B3: reconcile (add/update/remove) instead of blind merge.
 */

import {
  type AssistantMemory,
  extractAssistantSelfFacts,
  hasAssistantMemorySignal,
  emptyAssistantMemory
} from './assistant-memory'
import { reconcileAssistantMemory } from './assistant-memory-reconcile'
import { compactAssistantMemory } from './assistant-memory-compact'
import { processAssistantReplyForMemory } from '../chat/assistant-reply-pipeline'

export type CollectAssistantMemoryResult = {
  ok: boolean
  changed: boolean
  extracted: ReturnType<typeof extractAssistantSelfFacts>
  memory: AssistantMemory
  reason?: string
  ops?: Array<{ kind: string; field: string; value?: string }>
}

/**
 * Collect self-facts from a finished assistant bubble and reconcile into prev memory.
 * Optional userText enables forget/correct ops («ya no te gusta X»).
 */
export function collectAssistantMemoryFromReply(
  prev: AssistantMemory | null | undefined,
  replyText: string,
  opts?: { userText?: string }
): CollectAssistantMemoryResult {
  const text =
    processAssistantReplyForMemory(String(replyText || '')) || String(replyText || '').trim()
  const extracted = extractAssistantSelfFacts(text)
  const base = prev || emptyAssistantMemory()

  const hasExtract = hasAssistantMemorySignal(extracted)
  const hasForget = Boolean(opts?.userText && opts.userText.length >= 6)

  if (!hasExtract && !hasForget) {
    return {
      ok: true,
      changed: false,
      extracted,
      memory: base,
      reason: 'no-signal'
    }
  }

  const result = reconcileAssistantMemory(base, extracted, { userText: opts?.userText })
  const compacted = compactAssistantMemory(result.memory)
  const opsSummary = result.ops
    .filter((o) => o.kind !== 'noop')
    .map((o) => ({ kind: o.kind, field: String(o.field), value: o.value }))

  const changed =
    result.changed ||
    (compacted.likes || []).join('|') !== (result.memory.likes || []).join('|') ||
    (compacted.relational || []).join('|') !== (result.memory.relational || []).join('|')

  return {
    ok: true,
    changed,
    extracted,
    memory: compacted,
    reason: changed ? (result.changed ? 'reconciled' : 'compacted') : 'duplicate',
    ops: opsSummary
  }
}
