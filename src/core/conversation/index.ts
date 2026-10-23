import type { ChatMessage } from '../providers'

export type Attachment = {
  id?: string
  type?: string
  name?: string
  url?: string
  dataUrl?: string
  /** Plain text extracted from .txt/.md/.json/… for the model */
  textContent?: string
  mimeType?: string
  sizeBytes?: number
  filePath?: string
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
  /** Hide title/preview in sidebar; export may require app PIN */
  isPrivate?: boolean
  /** Spill index: full body may live under userData/chats/{id}.json */
  meta?: {
    diskSpill?: boolean
    diskSpillTotal?: number
    [key: string]: unknown
  }
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

/**
 * Derive a short topic label from the first user message(s).
 * Not a raw truncation of what the user typed.
 */
export function smartConversationTitle(
  input: string | Array<{ role?: string; content?: string }>,
  fallback = 'Nueva conversación'
): string {
  let raw = ''
  if (typeof input === 'string') raw = input
  else {
    const user = (input || []).filter((m) => m.role === 'user').map((m) => m.content || '')
    raw = user.find((x) => (x || '').trim().length >= 3) || user[0] || ''
  }
  raw = (raw || '').replace(/\s+/g, ' ').trim()
  if (!raw) return fallback

  // Strip system-ish prefixes / continue chips
  let t = raw
    .replace(/^\[.*?\]\s*/g, '')
    .replace(/^Continuando la respuesta[.…\s]*/i, '')
    .trim()

  // Drop pure greetings
  t = t.replace(/^(hola|hey|hi|hello|buenas?|qué tal|que tal)([\s,!.…💙💜💕✨]+)/i, '').trim()
  if (t.length < 3) t = raw

  // Vocatives / filler at ends and middle
  t = t
    .replace(
      /\b(linda|lindo|mi vida|cariño|amor|por favor|please|bebé|bebe|guapa|guapo)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()

  // Intent → short topic
  const lower = t.toLowerCase()
  let topic = ''

  const book =
    t.match(
      /\b(?:revisar|lee|leer|opini[oó]n|rese[nñ]a|repasa)\b.{0,40}\b(?:mi\s+)?(?:libro|novela|documento|pdf|docx|texto)\b/i
    ) ||
    t.match(/\b(?:libro|novela|documento)\b.{0,30}\b(?:revis|lee|opini|rese)/i)
  if (book) {
    topic = 'Revisión del libro'
  } else if (/\b(busca|buscar|b[uú]squeda|en la web|internet|google)\b/i.test(lower)) {
    const q = t
      .replace(/^.*\b(?:busca|buscar|búsqueda|busqueda)\b(?:\s+en\s+(?:la\s+)?(?:web|internet))?\s*/i, '')
      .replace(/[?!.,]+$/g, '')
      .trim()
    topic = q.length >= 3 ? 'Búsqueda: ' + q.slice(0, 28) : 'Búsqueda web'
  } else if (/\b(imagen|foto|dibuja|genera(?:r)?\s+(?:una\s+)?imagen|haz(?:me)?\s+una\s+foto)\b/i.test(lower)) {
    topic = 'Imagen'
  } else if (/\b(c[oó]digo|programa|script|bug|error|refactor|typescript|python|javascript)\b/i.test(lower)) {
    topic = 'Código'
  } else if (/\b(m[uú]sica|canc[ií][oó]n|melody|compon)\b/i.test(lower)) {
    topic = 'Música'
  } else if (/\b(recu[eé]rdame|agenda|alarma|aviso)\b/i.test(lower)) {
    topic = 'Recordatorio'
  } else if (/\b(traduc[ei]|translate)\b/i.test(lower)) {
    topic = 'Traducción'
  } else {
    // Generic: strip request verbs and keep the object phrase
    let core = t
      .replace(
        /^(?:puedes|podr[ií]as|me\s+puedes|quiero\s+que|necesito\s+que|haz(?:me)?|ayuda(?:me)?(?:\s+a)?|dime|expl[ií]came|cu[eé]ntame)\s+/i,
        ''
      )
      .replace(/^(?:a\s+)?(?:revisar|leer|hacer|generar|escribir|analizar|explicar)\s+/i, '')
      .replace(/[?!¡¿]+/g, '')
      .trim()
    if (core.length < 3) core = t.replace(/[?!¡¿]+/g, '').trim()
    // Title case first letter
    core = core.charAt(0).toUpperCase() + core.slice(1)
    topic = core
  }

  topic = topic.replace(/\s+/g, ' ').trim().slice(0, 40)
  if (topic.length < 3) return fallback
  // Avoid looking like the full first message (if almost identical and very long)
  if (topic.length > 36) topic = topic.slice(0, 36).trim() + '…'
  return topic
}

/** Heuristic title suggestions (no LLM) for the rename menu. */
export function suggestConversationTitlesHeuristic(
  messages: Array<{ role?: string; content?: string }>,
  currentTitle?: string
): string[] {
  const users = (messages || [])
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content || '').trim())
    .filter((x) => x.length >= 3)
  const primary = smartConversationTitle(messages)
  const out: string[] = []
  const push = (s: string) => {
    const x = s.replace(/\s+/g, ' ').trim().slice(0, 40)
    if (x.length < 3) return
    if (currentTitle && x.toLowerCase() === currentTitle.toLowerCase()) return
    if (out.some((o) => o.toLowerCase() === x.toLowerCase())) return
    out.push(x)
  }
  push(primary)
  if (users[0]) {
    const u0 = users[0]
    if (/libro|novela|docx|pdf/i.test(u0)) push('Libro y lectura')
    if (/c[oó]digo|bug|script/i.test(u0)) push('Ayuda de código')
    if (/imagen|foto/i.test(u0)) push('Generación de imagen')
  }
  if (users[1]) {
    const second = smartConversationTitle(users[1])
    if (second !== primary) push(second)
  }
  // Topic from keywords
  const blob = users.slice(0, 4).join(' ')
  const kw = blob.match(
    /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{3,}(?:\s+[A-ZÁÉÍÓÚÑ]?[a-záéíóúñ]{2,}){0,3})\b/
  )
  if (kw?.[1] && kw[1].length >= 4) push(kw[1].slice(0, 36))
  return out.slice(0, 3)
}

/** C-14B — tighter window for local mid-size models so they stay coherent */
export function budgetForLocalCompanion(opts?: {
  ramGB?: number
  modelId?: string
}): ContextBudget {
  const id = String(opts?.modelId || '').toLowerCase()
  const is14 = /14b|12b|13b|15b/.test(id)
  const isSmall = /7b|8b|9b|3b|1b|moondream/.test(id)
  if (isSmall) {
    return { maxMessages: 20, maxChars: 10_000, keepRecentMessages: 8, maxSystemChars: 3_500 }
  }
  if (is14) {
    return { maxMessages: 28, maxChars: 14_000, keepRecentMessages: 10, maxSystemChars: 4_500 }
  }
  return { maxMessages: 36, maxChars: 18_000, keepRecentMessages: 12, maxSystemChars: 5_500 }
}

export function budgetForModel(model: string, kind: 'local' | 'cloud' = 'cloud'): ContextBudget {
  const m = (model || '').toLowerCase()
  if (kind === 'local') {
    // Convivencia 14B: enough history, not so much that mid-size models loop
    // Large local models (Gemma 26B, 20B, 27B, A4B active params, etc.)
    if (/70b|32b|27b|26b|24b|20b|a4b|gemma-4|gemma4/.test(m)) {
      return {
        maxMessages: 40,
        maxChars: 56_000,
        keepRecentMessages: 14,
        maxTokensHint: 6144,
        maxSystemChars: 32_000
      }
    }
    if (/14b|12b|13b|15b/.test(m)) {
      return budgetForLocalCompanion({ modelId: m })
    }
    if (/7b|8b|9b|3b|1\.|moondream|phi/.test(m)) {
      return {
        maxMessages: 18,
        maxChars: 9_000,
        keepRecentMessages: 7,
        maxTokensHint: 1536,
        maxSystemChars: 3_200
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

  // Document reading needs a larger system budget so progressive slices are not shredded
  const hasDocBlock = systems.some((m) =>
    /\[DOCUMENTOS_ADJUNTOS\]|\[LECTURA_PROGRESIVA\]|\[MODO_DOCUMENTO\]/i.test(m.content || '')
  )
  if (hasDocBlock) {
    b.maxSystemChars = Math.max(b.maxSystemChars || 5_000, 32_000)
    b.maxChars = Math.max(b.maxChars || 16_000, 48_000)
  }

  // Trim oversized system blocks — protect document extract; shrink persona/memory first
  let sysChars = systems.reduce((n, m) => n + m.content.length, 0)
  const isDocMsg = (c: string) =>
    /\[DOCUMENTOS_ADJUNTOS\]|\[LECTURA_PROGRESIVA\]|\[MODO_DOCUMENTO\]/i.test(c)
  if (sysChars > (b.maxSystemChars || 5_000)) {
    // Pass 1: trim non-document systems
    for (let i = systems.length - 1; i >= 0 && sysChars > (b.maxSystemChars || 5_000); i--) {
      if (isDocMsg(systems[i].content)) continue
      if (systems[i].content.length > 800) {
        const cut = Math.min(systems[i].content.length, Math.max(600, Math.floor(systems[i].content.length * 0.55)))
        systems[i] = {
          ...systems[i],
          content: systems[i].content.slice(0, cut) + '\n…[sistema recortado]'
        }
        sysChars = systems.reduce((n, m) => n + m.content.length, 0)
      }
    }
    // Pass 2: only if still over, gently trim document block (keep head = current slice)
    for (let i = systems.length - 1; i >= 0 && sysChars > (b.maxSystemChars || 5_000); i--) {
      if (!isDocMsg(systems[i].content)) continue
      if (systems[i].content.length > 4000) {
        const keep = Math.max(12_000, Math.floor((b.maxSystemChars || 32_000) * 0.85))
        systems[i] = {
          ...systems[i],
          content: systems[i].content.slice(0, keep) + '\n…[extracto recortado por presupuesto]'
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
  return {
    summary: heuristicConversationSummary(older, opts.previousSummary, maxChars),
    source: 'heuristic'
  }
}

/**
 * Fast rolling summary without an extra LLM call.
 * Keeps both user and assistant beats; skips short initiative noise.
 * Preserves prior summary head so long threads don't forget early facts.
 */
export function heuristicConversationSummary(
  older: ChatMessage[],
  previousSummary?: string,
  maxChars = 900
): string {
  const parts: string[] = []
  const prev = (previousSummary || '').trim()
  if (prev) {
    // Prefer structured previous; keep INTIMACY / relationship lines if any
    parts.push(prev.slice(0, Math.min(420, Math.floor(maxChars * 0.45))))
  }
  const recent = (older || []).slice(-18)
  for (const m of recent) {
    const raw = String(m.content || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (raw.length < 12) continue
    // Skip pure visual/wardrobe initiative one-liners
    if (
      /^(Oye…|Acabo de recordar|¿te parece si cambio mi foto)/i.test(raw) &&
      raw.length < 160
    ) {
      continue
    }
    const role = m.role === 'user' ? 'Usuario' : m.role === 'assistant' ? 'Asistente' : m.role
    parts.push(`• ${role}: ${raw.slice(0, 160)}`)
  }
  const joined = parts.join('\n').trim()
  if (!joined) return '(sin resumen aún)'
  return joined.slice(0, maxChars)
}

export * from './initiative'

export * from './user-memory'

export * from './assistant-memory'
export * from './assistant-memory-compact'
export * from './dual-memory'
export * from './memory-backup-gate'

export * from './memory-onboarding'

export * from './relationship-confidence'
export * from './intimacy-stage'
export * from './intimacy-memory'

export * from './birthday'


export {
  budgetFromContextTokens,
  progressiveSliceCharsForBudget,
  fetchModelContextInfo,
  resolveDynamicLocalBudget,
  setLiveDocSliceChars,
  getLiveDocSliceChars
} from './dynamic-context-budget'
export type { ModelContextInfo } from './dynamic-context-budget'
