/**
 * Spill full conversation bodies to userData/chats/{id}.json.
 * localStorage keeps a working copy; disk is the safety net — never write a
 * thinned tail to disk as if it were the full chat.
 */

import type { Conversation, Message } from '@core/conversation'
import {
  shouldSpillConversation,
  thinConversationForLocalStorage
} from '@core/chat/chat-disk-index'

export {
  shouldSpillConversation,
  thinConversationForLocalStorage
} from '@core/chat/chat-disk-index'

/** Last full in-memory snapshot (updated from the store before persist). */
let latestFullConversations: Conversation[] = []

export function noteFullConversationsForSpill(conversations: Conversation[]): void {
  latestFullConversations = conversations.map((c) => ({
    ...c,
    messages: [...(c.messages || [])]
  }))
}

export async function spillConversationToDisk(c: Conversation): Promise<boolean> {
  const save = window.kawaii?.filesSaveChatBody
  if (typeof save !== 'function') return false
  try {
    const payload = {
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messages: c.messages,
      meta: c.meta,
      rollingSummary: c.rollingSummary,
      summaryCoveredCount: c.summaryCoveredCount
    }
    const r = await save({
      conversationId: c.id,
      json: JSON.stringify(payload)
    })
    return Boolean(r?.ok)
  } catch {
    return false
  }
}

export async function loadConversationFromDisk(
  conversationId: string
): Promise<Conversation | null> {
  const read = window.kawaii?.filesReadChatBody
  if (typeof read !== 'function') return null
  try {
    const r = await read(conversationId)
    if (!r?.ok || !r.json) return null
    const parsed = JSON.parse(r.json) as Conversation
    if (!parsed?.id || !Array.isArray(parsed.messages)) return null
    return parsed
  } catch {
    return null
  }
}

/** Merge by message id; keep richest set sorted by createdAt. */
export function mergeConversationMessages(
  a: Conversation,
  b: Conversation
): Conversation {
  const map = new Map<string, Message>()
  for (const m of [...(a.messages || []), ...(b.messages || [])]) {
    if (!m?.id) continue
    const prev = map.get(m.id)
    if (!prev) {
      map.set(m.id, m)
      continue
    }
    // Prefer longer content / more attachments
    const score = (x: Message) =>
      (typeof x.content === 'string' ? x.content.length : 0) +
      (x.attachments?.length || 0) * 100
    map.set(m.id, score(m) >= score(prev) ? m : prev)
  }
  const messages = [...map.values()].sort(
    (x, y) => (x.createdAt || 0) - (y.createdAt || 0)
  )
  return {
    ...a,
    ...b,
    id: a.id || b.id,
    title: a.title || b.title,
    messages,
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
    meta: {
      ...(b.meta || {}),
      ...(a.meta || {}),
      diskSpill: true,
      diskSpillTotal: messages.length
    }
  }
}

export function scheduleSpillConversations(conversations: Conversation[]): void {
  // Prefer full snapshot if we have one with more messages
  const byId = new Map(latestFullConversations.map((c) => [c.id, c]))
  for (const c of conversations) {
    const full = byId.get(c.id)
    const use =
      full && (full.messages?.length || 0) >= (c.messages?.length || 0) ? full : c
    if ((use.messages?.length || 0) < 8) continue
    void spillConversationToDisk(use).catch(() => null)
  }
}

/** Spill every noted full conversation (call on pause / before reload). */
export function scheduleSpillLatestFull(): void {
  for (const c of latestFullConversations) {
    if ((c.messages?.length || 0) < 8) continue
    void spillConversationToDisk(c).catch(() => null)
  }
}

export async function hydrateConversationIfNeeded(
  c: Conversation | null | undefined
): Promise<Conversation | null> {
  if (!c) return null
  const full = await loadConversationFromDisk(c.id)
  if (!full) return c
  if ((full.messages?.length || 0) === 0) return c
  // Always merge — recovers history if LS was emergency-trimmed
  const merged = mergeConversationMessages(c, full)
  if ((merged.messages?.length || 0) > (c.messages?.length || 0)) {
    return merged
  }
  return c
}
