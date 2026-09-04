/**
 * Idle / background rolling summary.
 * Prefer local Ollama; optional cloud (opt-in) if local unavailable.
 */

import {
  OllamaProvider,
  OpenAICompatibleProvider,
  type ChatMessage,
  type ChatProvider
} from '@core/providers'
import {
  summarizeConversation,
  shouldSummarize,
  defaultBudget
} from '@core/conversation'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { orderCloudEndpoints } from '@core/models/cloud-rotation'

export interface BackgroundSummaryOptions {
  idleMs?: number
  scanIntervalMs?: number
  maxConcurrent?: number
}

interface RuntimeConfig {
  idleMs: number
  scanIntervalMs: number
  maxConcurrent: number
}

const config: RuntimeConfig = {
  idleMs: 20_000,
  scanIntervalMs: 25_000,
  maxConcurrent: 1
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false
let inFlight = 0
const lastAttempt = new Map<string, number>()
const FAIL_COOLDOWN_MS = 60_000

let streamBusy = false

export function setBackgroundSummaryBusy(busy: boolean) {
  streamBusy = busy
}

async function loadProviderKeys(): Promise<Record<string, string>> {
  try {
    const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
    const legacy = (await window.kawaii?.getCloudApiKey?.()) ?? ''
    if (legacy && !keys.openrouter) keys.openrouter = legacy
    return keys
  } catch {
    return {}
  }
}

async function pickProvider(settings: {
  localModel: string
  localBaseUrl: string
  localTimeoutMs: number
  cloudTimeoutMs: number
  cloudSlots: { id: string; name: string; baseUrl: string; model: string; enabled: boolean; priority: number }[]
  cloudBaseUrl: string
  backgroundSummaryAllowCloud: boolean
}): Promise<{ provider: ChatProvider; model: string; via: 'local' | 'cloud' } | null> {
  const localModel = settings.localModel?.trim()
  if (localModel) {
    const local = new OllamaProvider({
      baseUrl: settings.localBaseUrl,
      timeoutMs: Math.min(settings.localTimeoutMs, 30_000)
    })
    try {
      const h = await local.healthCheck()
      if (h.ok) return { provider: local, model: localModel, via: 'local' }
    } catch {
      // fall through
    }
  }

  if (!settings.backgroundSummaryAllowCloud) return null

  const keys = await loadProviderKeys()
  const ordered = orderCloudEndpoints(
    settings.cloudSlots ?? [],
    keys,
    settings.cloudBaseUrl
  )
  if (ordered.length === 0) return null

  const ep = ordered[0]
  const provider = new OpenAICompatibleProvider({
    id: ep.id,
    displayName: ep.name,
    baseUrl: ep.baseUrl,
    apiKey: ep.apiKey,
    timeoutMs: Math.min(settings.cloudTimeoutMs, 60_000)
  })
  try {
    const h = await provider.healthCheck()
    if (!h.ok) return null
  } catch {
    return null
  }
  return { provider, model: ep.model, via: 'cloud' }
}

async function summarizeOne(convId: string): Promise<void> {
  const conv = useChatStore.getState().conversations.find((c) => c.id === convId)
  if (!conv) return

  const settings = useSettingsStore.getState().settings
  const budget = defaultBudget(
    settings.providerMode === 'cloud' ? 'cloud' : 'local'
  )
  const history = conv.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.content && !m.isStreaming)

  if (!shouldSummarize(history.length, budget.keepRecentMessages, 6)) return

  const covered = conv.summaryCoveredCount ?? 0
  const olderCount = Math.max(0, history.length - budget.keepRecentMessages)
  if (olderCount <= covered) return
  if (Date.now() - conv.updatedAt < config.idleMs) return

  const pick = await pickProvider(settings)
  if (!pick) return

  const older = history.slice(0, history.length - budget.keepRecentMessages)
  const chatMsgs: ChatMessage[] = older.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content
  }))

  try {
    const result = await summarizeConversation({
      preferFast: true,
      timeoutMs: 25_000,
      provider: pick.provider,
      model: pick.model,
      older: chatMsgs,
      previousSummary: conv.rollingSummary,
      maxSummaryChars: 1500
    })
    if (result.summary) {
      const still = useChatStore.getState().conversations.find((c) => c.id === convId)
      if (still) {
        useChatStore
          .getState()
          .setRollingSummary(convId, result.summary, olderCount, result.source)
      }
    }
  } catch {
    lastAttempt.set(convId, Date.now())
  }
}

async function scan(): Promise<void> {
  if (streamBusy || inFlight >= config.maxConcurrent) return

  const settings = useSettingsStore.getState().settings
  if (settings.backgroundSummaryEnabled === false) return
  // Local-only chat: heuristic context packing is enough — don't burn Ollama on summaries
  if (settings.providerMode === 'local') return

  const hasLocal = Boolean(settings.localModel?.trim())
  const allowCloud = settings.backgroundSummaryAllowCloud === true
  if (!hasLocal && !allowCloud) return

  const { conversations, activeId } = useChatStore.getState()
  const now = Date.now()

  const candidates = [...conversations].sort((a, b) => {
    if (a.id === activeId) return -1
    if (b.id === activeId) return 1
    return b.messages.length - a.messages.length
  })

  for (const conv of candidates) {
    if (inFlight >= config.maxConcurrent) break
    if (conv.messages.some((m) => m.isStreaming)) continue

    const last = lastAttempt.get(conv.id) ?? 0
    if (now - last < FAIL_COOLDOWN_MS) continue

    const budget = defaultBudget(
      settings.providerMode === 'cloud' ? 'cloud' : 'local'
    )
    const histLen = conv.messages.filter(
      (m) => (m.role === 'user' || m.role === 'assistant') && m.content
    ).length
    if (!shouldSummarize(histLen, budget.keepRecentMessages, 10)) continue
    const covered = conv.summaryCoveredCount ?? 0
    const olderCount = Math.max(0, histLen - budget.keepRecentMessages)
    if (olderCount <= covered) continue
    if (now - conv.updatedAt < config.idleMs) continue

    inFlight++
    lastAttempt.set(conv.id, now)
    try {
      await summarizeOne(conv.id)
    } finally {
      inFlight--
    }
    break
  }
}

export function startBackgroundSummary(
  options: BackgroundSummaryOptions = {}
): () => void {
  if (options.idleMs != null) config.idleMs = options.idleMs
  if (options.scanIntervalMs != null) config.scanIntervalMs = options.scanIntervalMs
  if (options.maxConcurrent != null) config.maxConcurrent = options.maxConcurrent

  if (timer) return stopBackgroundSummary

  running = true
  timer = setInterval(() => {
    if (!running) return
    void scan()
  }, config.scanIntervalMs)

  setTimeout(() => {
    if (running) void scan()
  }, Math.min(config.idleMs, 5000))

  return stopBackgroundSummary
}

export function stopBackgroundSummary(): void {
  running = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
