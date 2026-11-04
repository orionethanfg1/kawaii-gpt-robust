/**
 * Recover conversations from disk + localStorage backups.
 */

import type { Conversation, Message } from '@core/conversation'
import {
  loadConversationFromDisk,
  mergeConversationMessages,
  noteFullConversationsForSpill,
  scheduleSpillLatestFull,
  spillConversationToDisk
} from './chatDiskSpill'

export type ChatRecoveryReport = {
  ok: boolean
  diskFiles: number
  lsSnapshots: number
  merged: number
  restored: number
  skipped: number
  details: string[]
}

function scoreConv(c: Conversation): number {
  const msgs = c.messages || []
  let s = msgs.length * 1000
  for (const m of msgs) {
    s += typeof m.content === 'string' ? Math.min(m.content.length, 500) : 0
  }
  s += c.updatedAt || 0
  return s
}

function collectFromLocalStorage(): Conversation[] {
  const out: Conversation[] = []
  try {
    if (typeof localStorage === 'undefined') return out
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (!/kawaii.*chat/i.test(k) && k !== 'kawaii-chats-v1') continue
      try {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        const parsed = JSON.parse(raw) as {
          state?: { conversations?: Conversation[] }
          conversations?: Conversation[]
        }
        const cons = parsed?.state?.conversations || parsed?.conversations
        if (Array.isArray(cons)) {
          for (const c of cons) {
            if (c?.id && Array.isArray(c.messages)) out.push(c)
          }
        }
      } catch {
        /* skip key */
      }
    }
  } catch {
    /* */
  }
  return out
}

function applyMerge(
  byId: Map<string, Conversation>,
  incoming: Conversation,
  source: string,
  stats: { merged: number; restored: number; skipped: number; details: string[] }
): boolean {
  if (!incoming?.id || !Array.isArray(incoming.messages)) {
    stats.skipped++
    return false
  }
  if (incoming.messages.length === 0) {
    stats.skipped++
    stats.details.push(`${source}: «${incoming.title || incoming.id}» vacío`)
    return false
  }
  const local = byId.get(incoming.id)
  if (!local) {
    byId.set(incoming.id, incoming)
    stats.restored++
    stats.details.push(
      `${source}: restaurado «${incoming.title || incoming.id}» (${incoming.messages.length} msgs)`
    )
    return true
  }
  const merged = mergeConversationMessages(local, incoming)
  const before = scoreConv(local)
  const after = scoreConv(merged)
  if (
    (merged.messages?.length || 0) > (local.messages?.length || 0) ||
    after > before + 50
  ) {
    byId.set(local.id, merged)
    stats.merged++
    stats.details.push(
      `${source}: fusionado «${merged.title || local.id}»: ${local.messages?.length || 0} → ${merged.messages.length} msgs`
    )
    return true
  }
  stats.skipped++
  stats.details.push(
    `${source}: «${local.title || local.id}» sin cambio (local ${local.messages?.length || 0} · fuente ${incoming.messages.length})`
  )
  return false
}

/**
 * Deep recovery: userData/chats + all localStorage chat keys.
 */
export async function recoverChatsFromDisk(opts?: {
  setConversations?: (next: Conversation[]) => void
  getConversations?: () => Conversation[]
}): Promise<ChatRecoveryReport> {
  const details: string[] = []
  const stats = { merged: 0, restored: 0, skipped: 0, details }

  let current: Conversation[] = []
  try {
    if (opts?.getConversations) current = [...opts.getConversations()]
    else {
      const { useChatStore } = await import('@shared/lib/stores/chatStore')
      current = [...(useChatStore.getState().conversations || [])]
    }
  } catch {
    current = []
  }

  const byId = new Map(current.map((c) => [c.id, c]))
  let changed = false

  // 1) Disk primary + rotating snapshots (prefer richest per id)
  let diskFiles = 0
  try {
    const list = await window.kawaii?.filesListChatBodies?.()
    if (list?.ok && list.items?.length) {
      diskFiles = list.items.length
      // Sort: more messages first, then newer
      const sorted = [...list.items].sort((a, b) => {
        const mc = (b.messageCount || 0) - (a.messageCount || 0)
        if (mc !== 0) return mc
        return (b.mtimeMs || 0) - (a.mtimeMs || 0)
      })
      for (const it of sorted) {
        let disk: Conversation | null = null
        if (it.path && window.kawaii?.filesReadChatBodyPath) {
          try {
            const r = await window.kawaii.filesReadChatBodyPath(it.path)
            if (r?.ok && r.json) {
              const parsed = JSON.parse(r.json) as Conversation
              if (parsed?.messages) disk = parsed
            }
          } catch {
            /* */
          }
        }
        if (!disk) disk = await loadConversationFromDisk(it.id)
        if (!disk) {
          stats.skipped++
          details.push(`${it.kind || 'disco'} ${it.id}: no legible`)
          continue
        }
        const src = it.kind === 'snapshot' ? 'snapshot' : 'disco'
        if (applyMerge(byId, { ...disk, id: disk.id || it.id }, src, stats)) {
          changed = true
        }
      }
    } else if (list && !list.ok) {
      details.push('listChatBodies: ' + (list.error || 'error'))
    } else {
      details.push('disco: userData/chats sin archivos')
    }
  } catch (e) {
    details.push('disco: ' + (e instanceof Error ? e.message : String(e)))
  }

  // 2) localStorage snapshots (other keys / partial states)
  const fromLs = collectFromLocalStorage()
  const lsSnapshots = fromLs.length
  for (const c of fromLs) {
    if (applyMerge(byId, c, 'localStorage', stats)) changed = true
  }

  const next = [...byId.values()].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  )

  if (changed) {
    try {
      if (opts?.setConversations) opts.setConversations(next)
      else {
        const { useChatStore } = await import('@shared/lib/stores/chatStore')
        useChatStore.setState({ conversations: next })
      }
      noteFullConversationsForSpill(next)
      scheduleSpillLatestFull()
    } catch (e) {
      details.push('aplicar: ' + (e instanceof Error ? e.message : String(e)))
      return {
        ok: false,
        diskFiles,
        lsSnapshots,
        merged: stats.merged,
        restored: stats.restored,
        skipped: stats.skipped,
        details: details.slice(0, 50)
      }
    }
  }

  if (!changed && diskFiles === 0 && lsSnapshots === 0) {
    details.push(
      'No hay respaldo recuperable: el chat de hoy probablemente no se escribió a disco antes del fallo.'
    )
  }

  return {
    ok: true,
    diskFiles,
    lsSnapshots,
    merged: stats.merged,
    restored: stats.restored,
    skipped: stats.skipped,
    details: details.slice(0, 50)
  }
}

export async function detectChatHistoryGap(): Promise<{
  gap: boolean
  summary: string
}> {
  try {
    const list = await window.kawaii?.filesListChatBodies?.()
    const diskN = list?.items?.length || 0
    const { useChatStore } = await import('@shared/lib/stores/chatStore')
    const local = useChatStore.getState().conversations || []
    const localById = new Map(local.map((c) => [c.id, c.messages?.length || 0]))
    let worse = 0
    let missing = 0
    for (const it of list?.items || []) {
      const d = it.messageCount ?? 0
      const loc = localById.get(it.id)
      if (loc == null && d > 0) missing++
      else if (loc != null && d > loc) worse++
    }
    if (missing + worse > 0) {
      return {
        gap: true,
        summary: `posible pérdida: ${missing} solo en disco, ${worse} con más msgs en disco`
      }
    }
    if (diskN === 0 && local.some((c) => (c.messages?.length || 0) > 5)) {
      return {
        gap: true,
        summary:
          'hay chats largos en memoria sin respaldo en disco — conviene «Respaldar ahora»'
      }
    }
    return {
      gap: false,
      summary: diskN
        ? `${diskN} respaldo(s) en disco`
        : 'sin respaldos en disco aún'
    }
  } catch (e) {
    return {
      gap: false,
      summary: e instanceof Error ? e.message : String(e)
    }
  }
}

export async function forceSpillAllChats(): Promise<number> {
  try {
    const { useChatStore } = await import('@shared/lib/stores/chatStore')
    const cons = useChatStore.getState().conversations || []
    noteFullConversationsForSpill(cons)
    let n = 0
    for (const c of cons) {
      if ((c.messages?.length || 0) < 1) continue
      if (await spillConversationToDisk(c)) n++
    }
    return n
  } catch {
    return 0
  }
}
