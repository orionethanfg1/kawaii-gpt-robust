import type { ChatMessage } from '../providers'

export type Attachment = {
  id?: string
  type?: string
  name?: string
  url?: string
  dataUrl?: string
  mimeType?: string
}

export type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  isStreaming?: boolean
  attachments?: Attachment[]
  meta?: Record<string, unknown>
}

export type Conversation = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
  rollingSummary?: string
  summaryCoveredCount?: number
  summarySource?: 'model' | 'heuristic'
}

export type ContextBudget = {
  maxMessages: number
  maxChars: number
  keepRecentMessages: number
  maxTokensHint?: number
  maxSystemChars?: number
}

export type ContextPlan = {
  budget: ContextBudget
  shouldSummarize: boolean
  isTight: boolean
  forceSummary: boolean
  note?: string
  reason?: string
}

export function createConversationId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createMessageId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function smartConversationTitle(
  input: string | Array<{ role?: string; content?: string }>,
  fallback = 'Nueva conversación'
): string {
  let t = ''
  if (typeof input === 'string') t = input
  else {
    const user = (input || []).filter((m) => m.role === 'user').map((m) => m.content || '')
    t = user[0] || ''
  }
  t = (t || '').replace(/\s+/g, ' ').trim()
  if (!t) return fallback
  const cleaned = t.replace(/^[#>*\-\s]+/, '').slice(0, 48)
  if (cleaned.length < 3) return fallback
  return cleaned + (t.length > 48 ? '…' : '')
}

export function budgetForModel(model: string, kind: 'local' | 'cloud' = 'cloud'): ContextBudget {
  const m = (model || '').toLowerCase()
  if (kind === 'local') {
    if (/14b|32b|70b/.test(m)) {
      return {
        maxMessages: 40,
        maxChars: 24_000,
        keepRecentMessages: 12,
        maxTokensHint: 4096,
        maxSystemChars: 6_000
      }
    }
    return {
      maxMessages: 24,
      maxChars: 12_000,
      keepRecentMessages: 10,
      maxTokensHint: 2048,
      maxSystemChars: 4_000
    }
  }
  if (/gpt-4o|claude|gemini-2/.test(m)) {
    return {
      maxMessages: 60,
      maxChars: 48_000,
      keepRecentMessages: 16,
      maxTokensHint: 8192,
      maxSystemChars: 10_000
    }
  }
  return {
    maxMessages: 40,
    maxChars: 20_000,
    keepRecentMessages: 12,
    maxTokensHint: 4096,
    maxSystemChars: 6_000
  }
}

/**
 * Accepts either (model, kind) or a single kind string for background jobs.
 */
export function defaultBudget(
  modelOrKind?: string,
  kind: 'local' | 'cloud' = 'cloud'
): ContextBudget {
  if (modelOrKind === 'local' || modelOrKind === 'cloud') {
    return budgetForModel('', modelOrKind)
  }
  return budgetForModel(modelOrKind || '', kind)
}

export function planContext(input: {
  systemMessages?: ChatMessage[]
  history?: ChatMessage[]
  userContent?: string
  modelId?: string
  kind?: 'local' | 'cloud'
  providerId?: string
  /** Legacy simple form */
  messageCount?: number
  budget?: ContextBudget
}): ContextPlan {
  const kind = input.kind === 'local' ? 'local' : 'cloud'
  const base =
    input.budget ||
    budgetForModel(input.modelId || '', kind)

  // Always clone so callers never see undefined fields
  const budget: ContextBudget = {
    maxMessages: base.maxMessages ?? 32,
    maxChars: base.maxChars ?? 16_000,
    keepRecentMessages: base.keepRecentMessages ?? 10,
    maxTokensHint: base.maxTokensHint ?? 2048,
    maxSystemChars: base.maxSystemChars ?? 5_000
  }

  const history = input.history || []
  const messageCount = input.messageCount ?? history.length
  const historyChars = history.reduce((n, m) => n + (m.content?.length || 0), 0)
  const systemChars = (input.systemMessages || []).reduce(
    (n, m) => n + (m.content?.length || 0),
    0
  )
  const userLen = (input.userContent || '').length

  const overMessages = messageCount > budget.maxMessages
  const overChars = historyChars + systemChars + userLen > budget.maxChars
  const systemTight = systemChars > (budget.maxSystemChars || 5_000)
  const isTight = overChars || systemTight || messageCount > budget.maxMessages * 0.85
  const forceSummary = overMessages || historyChars > budget.maxChars * 0.7

  let note = ''
  if (forceSummary) note = 'historial largo → conviene resumen'
  else if (isTight) note = 'ventana de contexto ajustada'
  else note = 'contexto holgado'

  return {
    budget,
    shouldSummarize: forceSummary,
    isTight,
    forceSummary,
    note,
    reason: note
  }
}

export function shouldSummarize(
  historyLen: number,
  keepRecent: number,
  thresholdExtra = 10
): boolean {
  const keep = typeof keepRecent === 'number' && !Number.isNaN(keepRecent) ? keepRecent : 10
  return historyLen > keep + thresholdExtra
}

export function aggressiveShrink(budget: ContextBudget, attempt: number): ContextBudget {
  const b = budget || defaultBudget()
  const factor = Math.max(0.35, 1 - attempt * 0.2)
  return {
    maxMessages: Math.max(6, Math.floor((b.maxMessages || 32) * factor)),
    maxChars: Math.max(2_000, Math.floor((b.maxChars || 16_000) * factor)),
    keepRecentMessages: Math.max(4, Math.floor((b.keepRecentMessages || 10) * factor)),
    maxTokensHint: b.maxTokensHint,
    maxSystemChars: Math.max(1_500, Math.floor((b.maxSystemChars || 5_000) * factor))
  }
}

/**
 * packContext(system, history, userMsg, budget, summary?)
 * Matches chatOrchestrator call site.
 */
export function packContext(
  systemMessages: ChatMessage[],
  history: ChatMessage[],
  userMessage: ChatMessage | { role: string; content: string },
  budget?: ContextBudget,
  summary?: string
): { messages: ChatMessage[]; truncated: boolean; summaryInjected: boolean } {
  const b: ContextBudget = {
    maxMessages: budget?.maxMessages ?? 32,
    maxChars: budget?.maxChars ?? 16_000,
    keepRecentMessages: budget?.keepRecentMessages ?? 10,
    maxTokensHint: budget?.maxTokensHint,
    maxSystemChars: budget?.maxSystemChars ?? 5_000
  }

  const systems: ChatMessage[] = (systemMessages || []).map((m) => ({
    role: m.role,
    content: m.content
  }))

  // Trim oversized system blocks from the end of long system msgs
  let sysChars = systems.reduce((n, m) => n + m.content.length, 0)
  if (sysChars > (b.maxSystemChars || 5_000)) {
    for (let i = systems.length - 1; i >= 0 && sysChars > (b.maxSystemChars || 5_000); i--) {
      if (systems[i].content.length > 800) {
        const cut = Math.floor(systems[i].content.length * 0.6)
        systems[i] = {
          ...systems[i],
          content: systems[i].content.slice(0, cut) + '\n…[sistema recortado]'
        }
        sysChars = systems.reduce((n, m) => n + m.content.length, 0)
      }
    }
  }

  let summaryInjected = false
  if (summary && summary.trim()) {
    systems.push({
      role: 'system',
      content: `[Resumen previo de la conversación]\n${summary.trim().slice(0, 2_000)}`
    })
    summaryInjected = true
  }

  const keep = b.keepRecentMessages
  const recent = (history || []).slice(-keep)
  let chars = systems.reduce((n, m) => n + m.content.length, 0)
  const userContent = userMessage?.content || ''
  chars += userContent.length

  const out: ChatMessage[] = []
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i]
    if (chars + (m.content?.length || 0) > b.maxChars && out.length >= 4) break
    out.unshift({ role: m.role, content: m.content })
    chars += m.content?.length || 0
  }

  const truncated = out.length < (history || []).length
  const user: ChatMessage = {
    role: (userMessage.role as ChatMessage['role']) || 'user',
    content: userContent
  }

  return {
    messages: [...systems, ...out, user],
    truncated,
    summaryInjected
  }
}

export async function summarizeConversation(opts: {
  messages?: ChatMessage[]
  older?: ChatMessage[]
  previousSummary?: string
  provider: {
    id: string
    chat: (r: {
      model: string
      messages: ChatMessage[]
      maxTokens?: number
      temperature?: number
      signal?: AbortSignal
    }) => Promise<{ content: string }>
  }
  model: string
  signal?: AbortSignal
  maxSummaryChars?: number
  preferFast?: boolean
  timeoutMs?: number
}): Promise<{ summary: string; source: 'model' | 'heuristic' }> {
  const older = opts.older || opts.messages || []
  const maxChars = opts.maxSummaryChars ?? 1200
  try {
    const sample = older
      .slice(-20)
      .map((m) => `${m.role}: ${(m.content || '').slice(0, 350)}`)
      .join('\n')
    const prev = opts.previousSummary
      ? `Resumen anterior:\n${opts.previousSummary.slice(0, 600)}\n\n`
      : ''
    const result = await opts.provider.chat({
      model: opts.model,
      messages: [
        {
          role: 'system',
          content:
            'Resume en español (viñetas cortas) hechos, preferencias y hilos abiertos. Sin relleno ni meta-comentarios.'
        },
        {
          role: 'user',
          content: `${prev}Conversación a resumir:\n${sample}`
        }
      ],
      maxTokens: opts.preferFast ? 256 : 400,
      temperature: 0.3,
      signal: opts.signal
    })
    if (result.content?.trim()) {
      return { summary: result.content.trim().slice(0, maxChars), source: 'model' }
    }
  } catch {
    /* heuristic */
  }
  const heuristic = older
    .filter((m) => m.role === 'user')
    .slice(-6)
    .map((m) => `- ${(m.content || '').slice(0, 120)}`)
    .join('\n')
  return { summary: (heuristic || '(sin resumen)').slice(0, maxChars), source: 'heuristic' }
}

export * from './initiative'
