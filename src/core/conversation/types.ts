export interface Attachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  dataUrl?: string
}

export interface RouteMeta {
  target?: string
  reason?: string
  switchedAt?: number
  failover?: boolean
  contextPacked?: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  isStreaming?: boolean
  attachments?: Attachment[]
  meta?: {
    model?: string
    provider?: string
    route?: string
    reason?: string
    tokens?: number
    latencyMs?: number
    switchedAt?: number
    failover?: boolean
    contextPacked?: boolean
    summarySource?: 'model' | 'heuristic'
    /** Image generation meta (Phase 2+) */
    imageProvider?: string
    imageModel?: string
    imageWidth?: number
    imageHeight?: number
    imageSeed?: number
    imageFilePath?: string
    /** Full prompt used for last image (revision memory) */
    imagePrompt?: string
    /** Assistant bubble is an error (enables Resend) */
    isError?: boolean
    errorCode?: string
  }
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
  model?: string
  /** Rolling summary of older turns (model or heuristic) */
  rollingSummary?: string
  /** Number of messages already folded into rollingSummary */
  summaryCoveredCount?: number
  summarySource?: 'model' | 'heuristic'
  /** When rollingSummary was last written */
  summaryUpdatedAt?: number
}

export function createMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createConversationId(): string {
  return `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function titleFromContent(content: string, max = 48): string {
  return smartConversationTitle([{ role: 'user', content }], max)
}

/**
 * Heuristic title from the first user (+ optional assistant) turns.
 * Strips greetings/noise and prefers the meaningful topic.
 */
export function smartConversationTitle(
  turns: Array<{ role: string; content: string }>,
  max = 42
): string {
  const userTexts = turns
    .filter((t) => t.role === 'user')
    .map((t) => t.content.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (userTexts.length === 0) return 'Nueva conversación'

  let text = userTexts[0]
  // Drop pure greetings
  const greetingOnly =
    /^(hola|hi|hello|hey|buenas|buen d[ií]a|qu[eé] tal|how are you)[\s!?.]*$/i
  if (greetingOnly.test(text) && userTexts[1]) {
    text = userTexts[1]
  }
  // Strip command prefixes
  text = text
    .replace(/^\/(image|img|music|song|video)\s+/i, '')
    .replace(/^(por favor|please|oye|eh)\s+/i, '')
    .trim()

  // Prefer question core
  const q = text.match(/[¿?]([^¿?]{8,})/)
  if (q) text = q[1].trim()

  // Collapse filler
  text = text.replace(/\s+/g, ' ').trim()
  if (!text) text = userTexts[0]
  if (text.length <= max) return text
  // Break at word boundary
  const slice = text.slice(0, max - 1)
  const sp = slice.lastIndexOf(' ')
  return (sp > 12 ? slice.slice(0, sp) : slice) + '…'
}

