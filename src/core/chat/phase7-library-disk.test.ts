/**
 * Phase 7 — library awareness + disk spill helpers (pure).
 */

import {
  buildLibraryAwarenessBlock,
  mergeLibraryCatalog
} from './library-awareness'
import {
  shouldSpillConversation,
  thinConversationForLocalStorage
} from './chat-disk-index'
import type { Conversation } from '../conversation'

export type Phase7Check = { id: string; ok: boolean; detail: string }

export function runPhase7PureChecks(): Phase7Check[] {
  const out: Phase7Check[] = []

  const block = buildLibraryAwarenessBlock(
    [
      { name: 'libro.txt', kind: 'user', size: 12000 },
      { name: 'retrato.png', kind: 'images', isImage: true, size: 800000 }
    ],
    { maxItems: 10 }
  )
  out.push({
    id: 'phase7-library-block',
    ok:
      block.includes('BIBLIOTECA_LOCAL') &&
      block.includes('libro.txt') &&
      block.includes('retrato.png'),
    detail: block.slice(0, 120)
  })

  const merged = mergeLibraryCatalog(
    [{ name: 'A.txt', kind: 'user' }],
    [{ name: 'A.txt', kind: 'context' }, { name: 'B.md', kind: 'user' }]
  )
  out.push({
    id: 'phase7-library-dedupe',
    ok: merged.length === 2,
    detail: `n=${merged.length}`
  })

  const msgs = Array.from({ length: 60 }, (_, i) => ({
    id: `m${i}`,
    role: 'user' as const,
    content: `msg ${i}`,
    createdAt: i
  }))
  const c: Conversation = {
    id: 'c1',
    title: 't',
    createdAt: 1,
    updatedAt: 2,
    messages: msgs
  }
  out.push({
    id: 'phase7-should-spill',
    ok: shouldSpillConversation(c) === true,
    detail: `len=${c.messages.length}`
  })

  const thin = thinConversationForLocalStorage(c)
  out.push({
    id: 'phase7-thin-tail',
    ok:
      (thin.messages?.length || 0) === 40 &&
      thin.meta?.diskSpill === true &&
      thin.meta?.diskSpillTotal === 60,
    detail: `tail=${thin.messages?.length} total=${thin.meta?.diskSpillTotal}`
  })

  return out
}
