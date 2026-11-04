/**
 * Pure helpers for chat disk spill (no Electron).
 */

import type { Conversation } from '../conversation'

export const CHAT_SPILL_TAIL = 40
export const CHAT_SPILL_THRESHOLD = 50

export function shouldSpillConversation(c: Conversation): boolean {
  return (c.messages?.length || 0) > CHAT_SPILL_THRESHOLD
}

export function thinConversationForLocalStorage(c: Conversation): Conversation {
  const msgs = c.messages || []
  if (msgs.length <= CHAT_SPILL_TAIL) return c
  return {
    ...c,
    messages: msgs.slice(msgs.length - CHAT_SPILL_TAIL),
    meta: {
      ...(c.meta || {}),
      diskSpill: true,
      diskSpillTotal: msgs.length
    }
  }
}
