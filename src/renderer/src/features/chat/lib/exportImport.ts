/**
 * Export / import conversations as JSON (full) or Markdown (readable).
 */

import type { Conversation, Message } from '@core/conversation'
import { createConversationId, createMessageId } from '@core/conversation'

export const EXPORT_FORMAT_VERSION = 1

export interface ChatExportPayload {
  format: 'kawaii-gpt-robust-chats'
  version: number
  exportedAt: string
  conversations: Conversation[]
}

export function toExportPayload(conversations: Conversation[]): ChatExportPayload {
  return {
    format: 'kawaii-gpt-robust-chats',
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    conversations: conversations.map((c) => ({
      ...c,
      messages: c.messages.map((m) => ({
        ...m,
        isStreaming: false
      }))
    }))
  }
}

export function conversationsToJson(conversations: Conversation[]): string {
  return JSON.stringify(toExportPayload(conversations), null, 2)
}

export function conversationToMarkdown(conv: Conversation): string {
  const lines: string[] = [
    `# ${conv.title}`,
    '',
    `> id: \`${conv.id}\` · actualizado: ${new Date(conv.updatedAt).toISOString()}`,
    ''
  ]
  for (const m of conv.messages) {
    if (m.role === 'system') continue
    const who = m.role === 'user' ? '**Usuario**' : '**Asistente**'
    lines.push(`### ${who}`)
    lines.push('')
    lines.push(m.content || '')
    const imgs = (m.attachments ?? []).filter((a) => a.mimeType?.startsWith('image/'))
    if (imgs.length > 0) {
      lines.push('')
      lines.push(`_(${imgs.length} imagen(es) adjunta(s) en el export JSON)_`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function conversationsToMarkdownBundle(conversations: Conversation[]): string {
  const parts = [
    '# KawaiiGPT Robust — export',
    '',
    `Exportado: ${new Date().toISOString()}`,
    '',
    '---',
    ''
  ]
  for (const c of conversations) {
    parts.push(conversationToMarkdown(c))
    parts.push('---')
    parts.push('')
  }
  return parts.join('\n')
}

export interface ParseImportResult {
  ok: boolean
  conversations: Conversation[]
  error?: string
}

function normalizeMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const role = m.role
  if (role !== 'user' && role !== 'assistant' && role !== 'system') return null
  if (typeof m.content !== 'string') return null
  const attachmentsRaw = Array.isArray(m.attachments) ? m.attachments : []
  const attachments = attachmentsRaw
    .map((a) => {
      if (!a || typeof a !== 'object') return null
      const att = a as Record<string, unknown>
      if (typeof att.id !== 'string' || typeof att.name !== 'string') return null
      return {
        id: att.id,
        name: att.name,
        mimeType: typeof att.mimeType === 'string' ? att.mimeType : 'application/octet-stream',
        sizeBytes: typeof att.sizeBytes === 'number' ? att.sizeBytes : 0,
        dataUrl: typeof att.dataUrl === 'string' ? att.dataUrl : undefined
      }
    })
    .filter((a): a is NonNullable<typeof a> => a != null)

  return {
    id: typeof m.id === 'string' ? m.id : createMessageId(),
    role,
    content: m.content,
    createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
    isStreaming: false,
    attachments: attachments.length > 0 ? attachments : undefined,
    meta: typeof m.meta === 'object' && m.meta ? (m.meta as Message['meta']) : undefined
  }
}

function normalizeConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  const messagesIn = Array.isArray(c.messages) ? c.messages : []
  const messages = messagesIn
    .map(normalizeMessage)
    .filter((m): m is Message => m != null)
  const now = Date.now()
  return {
    id: typeof c.id === 'string' ? c.id : createConversationId(),
    title:
      typeof c.title === 'string' && c.title.trim()
        ? c.title
        : 'Conversación importada',
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : now,
    updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : now,
    messages,
    model: typeof c.model === 'string' ? c.model : undefined,
    rollingSummary: typeof c.rollingSummary === 'string' ? c.rollingSummary : undefined,
    summaryCoveredCount:
      typeof c.summaryCoveredCount === 'number' ? c.summaryCoveredCount : undefined,
    summarySource:
      c.summarySource === 'model' || c.summarySource === 'heuristic'
        ? c.summarySource
        : undefined,
    summaryUpdatedAt:
      typeof c.summaryUpdatedAt === 'number' ? c.summaryUpdatedAt : undefined
  }
}

/** Parse JSON export (or a bare array of conversations). */
export function parseImportJson(text: string): ParseImportResult {
  try {
    const data = JSON.parse(text) as unknown
    let list: unknown[] = []
    if (Array.isArray(data)) {
      list = data
    } else if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>
      if (obj.format === 'kawaii-gpt-robust-chats' && Array.isArray(obj.conversations)) {
        list = obj.conversations
      } else if (Array.isArray(obj.conversations)) {
        list = obj.conversations
      } else {
        return { ok: false, conversations: [], error: 'JSON no reconocido como export de chats' }
      }
    } else {
      return { ok: false, conversations: [], error: 'JSON inválido' }
    }

    const conversations = list
      .map(normalizeConversation)
      .filter((c): c is Conversation => c != null)

    if (conversations.length === 0) {
      return { ok: false, conversations: [], error: 'No hay conversaciones válidas en el archivo' }
    }
    return { ok: true, conversations }
  } catch (err) {
    return {
      ok: false,
      conversations: [],
      error: err instanceof Error ? err.message : 'No se pudo leer el JSON'
    }
  }
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function stampFilename(prefix: string, ext: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`
}


/** Import Markdown (ours or simple User/Assistant exports). */
export function parseImportMarkdown(text: string): ParseImportResult {
  const raw = (text || '').trim()
  if (!raw) return { ok: false, conversations: [], error: 'Archivo vacío' }

  // Split multi-chat bundle on --- under H1 sections if multiple # titles
  const chunks: string[] = []
  if (/^#\s+.+/m.test(raw) && raw.includes('\n# ')) {
    const parts = raw.split(/\n(?=#\s+)/)
    chunks.push(...parts.filter((p) => p.trim()))
  } else {
    chunks.push(raw)
  }

  const conversations: Conversation[] = []
  for (const chunk of chunks) {
    const titleMatch = chunk.match(/^#\s+(.+)$/m)
    const title = (titleMatch?.[1] || 'Conversación importada').trim().slice(0, 80)
    const messages: Message[] = []
    // Patterns: ### **Usuario**, ### User, **User**:, Usuario:, Human:, Assistant:
    const lines = chunk.split(/\n/)
    let role: 'user' | 'assistant' | null = null
    let buf: string[] = []
    const flush = () => {
      const content = buf.join('\n').trim()
      if (role && content) {
        messages.push({
          id: createMessageId(),
          role,
          content,
          createdAt: Date.now(),
          isStreaming: false
        })
      }
      buf = []
    }
    for (const line of lines) {
      const h = line.match(
        /^#{1,3}\s*\*?\*?(Usuario|User|Human|Asistente|Assistant|ChatGPT|System)\*?\*?\s*$/i
      )
      const inline = line.match(
        /^\*?\*?(Usuario|User|Human|Asistente|Assistant|ChatGPT)\*?\*?\s*[:：]\s*(.*)$/i
      )
      if (h) {
        flush()
        const who = h[1].toLowerCase()
        role = /user|usuario|human/.test(who) ? 'user' : 'assistant'
        continue
      }
      if (inline) {
        flush()
        const who = inline[1].toLowerCase()
        role = /user|usuario|human/.test(who) ? 'user' : 'assistant'
        if (inline[2]) buf.push(inline[2])
        continue
      }
      if (role) buf.push(line)
    }
    flush()
    if (messages.length === 0) continue
    const now = Date.now()
    conversations.push({
      id: createConversationId(),
      title,
      createdAt: now,
      updatedAt: now,
      messages
    })
  }
  if (!conversations.length) {
    return {
      ok: false,
      conversations: [],
      error: 'No se detectaron mensajes en el Markdown (usa encabezados Usuario/Asistente)'
    }
  }
  return { ok: true, conversations }
}

/** Auto-detect JSON or Markdown import. */
export function parseImportAny(text: string, fileName?: string): ParseImportResult {
  const name = (fileName || '').toLowerCase()
  const trimmed = (text || '').trim()
  if (!trimmed) return { ok: false, conversations: [], error: 'Archivo vacío' }
  if (name.endsWith('.md') || name.endsWith('.markdown') || /^#\s+/m.test(trimmed)) {
    const md = parseImportMarkdown(trimmed)
    if (md.ok) return md
  }
  // Try JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const j = parseImportJson(trimmed)
    if (j.ok) return j
    // ChatGPT export: { title, mapping: { id: { message: { author, content } } } }
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>
      if (data && typeof data === 'object' && data.mapping && typeof data.mapping === 'object') {
        const title =
          typeof data.title === 'string' && data.title.trim()
            ? data.title.trim()
            : 'ChatGPT import'
        const mapping = data.mapping as Record<
          string,
          { message?: { author?: { role?: string }; content?: { parts?: unknown[] } } }
        >
        const messages: Message[] = []
        for (const node of Object.values(mapping)) {
          const msg = node?.message
          if (!msg) continue
          const roleRaw = msg.author?.role
          if (roleRaw !== 'user' && roleRaw !== 'assistant') continue
          const parts = msg.content?.parts
          const content = Array.isArray(parts)
            ? parts.filter((p) => typeof p === 'string').join('\n')
            : ''
          if (!content.trim()) continue
          messages.push({
            id: createMessageId(),
            role: roleRaw,
            content: content.trim(),
            createdAt: Date.now(),
            isStreaming: false
          })
        }
        if (messages.length) {
          const now = Date.now()
          return {
            ok: true,
            conversations: [
              {
                id: createConversationId(),
                title,
                createdAt: now,
                updatedAt: now,
                messages
              }
            ]
          }
        }
      }
    } catch {
      /* fallthrough */
    }
    return j
  }
  return parseImportMarkdown(trimmed)
}
