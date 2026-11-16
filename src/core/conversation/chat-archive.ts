/**
 * Archive / compact a conversation for memory instead of hard-delete.
 * Pure helpers — no Zustand. Store/UI decide when to call.
 */

export type ChatArchiveEntry = {
  id: string
  title: string
  archivedAt: number
  messageCount: number
  /** Compact text for memory / retrieval */
  summary: string
  /** Optional episode-style bullets */
  bullets: string[]
}

export type ArchiveMessage = {
  role?: string
  content?: string
  createdAt?: number
}

export type ArchiveConversation = {
  id: string
  title?: string
  messages?: ArchiveMessage[]
  updatedAt?: number
}

const MAX_SUMMARY = 1200
const MAX_BULLETS = 8
const MAX_LINE = 160

/** Build a compact archive entry from a conversation (no side effects). */
export function buildChatArchiveEntry(conv: ArchiveConversation): ChatArchiveEntry {
  const msgs = Array.isArray(conv.messages) ? conv.messages : []
  const lines: string[] = []
  for (const m of msgs) {
    const role = m.role === 'assistant' ? 'Niamh' : m.role === 'user' ? 'Usuario' : m.role || '?'
    const body = String(m.content || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_LINE)
    if (!body) continue
    // Skip pure app instructions
    if (/^\[APP\]/i.test(body)) continue
    lines.push(`${role}: ${body}`)
  }
  const bullets = lines.slice(-MAX_BULLETS)
  let summary = bullets.join('\n')
  if (summary.length > MAX_SUMMARY) summary = summary.slice(0, MAX_SUMMARY) + '…'
  if (!summary) summary = `(Conversación «${conv.title || 'sin título'}» sin texto útil)`
  return {
    id: conv.id || `arch-${Date.now()}`,
    title: (conv.title || 'Conversación').trim() || 'Conversación',
    archivedAt: Date.now(),
    messageCount: msgs.length,
    summary,
    bullets
  }
}

/** Format archive as a userMemory fact line (stable prefix for dedupe). */
export function archiveEntryToMemoryFact(entry: ChatArchiveEntry): string {
  return `CHAT_ARCHIVO «${entry.title}» (${entry.messageCount} msgs, ${new Date(entry.archivedAt).toISOString().slice(0, 10)}): ${entry.summary.replace(/\n/g, ' · ').slice(0, 500)}`
}
