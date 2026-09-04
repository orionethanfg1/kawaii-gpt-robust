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
