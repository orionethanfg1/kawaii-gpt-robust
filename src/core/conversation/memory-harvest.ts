/**
 * E0 — Harvest durable signals from open chat transcripts into semantic memory.
 * Deterministic (no LLM). Safe to run on boot / idle; does not invent facts.
 */
import {
  extractAssistantPreferredNames,
  mergeAssistantMemory,
  type AssistantMemory
} from './assistant-memory'
import { extractUserFactsFromMessage, mergeUserMemory, type UserMemory } from './user-memory'

export type HarvestMessage = {
  role: string
  content?: string
  meta?: { kind?: string }
}

export type HarvestConversation = {
  id: string
  title?: string
  messages?: HarvestMessage[]
}

export type HarvestResult = {
  preferredNames: string[]
  rejectedNames: string[]
  /** Short notes for growth when new nicknames appear */
  growthHints: string[]
  sources: { name: string; conversationId: string }[]
  scannedMessages: number
  scannedConversations: number
}

const SKIP_META = new Set([
  'app-continue',
  'app-doc-continue',
  'app-agent',
  'app-instruction',
  'system-diag'
])

function isHarvestable(m: HarvestMessage): boolean {
  if (!m?.content || typeof m.content !== 'string') return false
  if (m.content.length < 4) return false
  const kind = m.meta?.kind
  if (kind && SKIP_META.has(kind)) return false
  // Skip leaked APP prompts
  if (/^\s*\[APP\]/i.test(m.content)) return false
  return true
}

/**
 * Scan conversations for assistant preferred names and related signals.
 * Only uses explicit linguistic patterns — no free-form invention.
 */
export function harvestFromConversations(
  conversations: HarvestConversation[],
  opts?: { maxMessagesPerConv?: number; maxConvs?: number }
): HarvestResult {
  const maxPer = Math.max(20, opts?.maxMessagesPerConv ?? 400)
  const maxConvs = Math.max(1, opts?.maxConvs ?? 40)
  const preferred: string[] = []
  const rejected: string[] = []
  const sources: { name: string; conversationId: string }[] = []
  const growthHints: string[] = []
  let scannedMessages = 0
  let scannedConversations = 0

  const seen = new Set<string>()
  const addName = (name: string, convId: string, asRejected = false) => {
    const key = name.toLowerCase().trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    if (asRejected) rejected.push(name)
    else {
      preferred.push(name)
      sources.push({ name, conversationId: convId })
    }
  }

  const list = (conversations || []).slice(0, maxConvs)
  for (const conv of list) {
    const msgs = (conv.messages || []).filter(isHarvestable).slice(-maxPer)
    if (!msgs.length) continue
    scannedConversations++
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]
      scannedMessages++
      const role = String(m.role || '').toLowerCase()
      const text = String(m.content || '')
      const prevUser =
        role === 'assistant'
          ? [...msgs.slice(0, i)].reverse().find((x) => String(x.role).toLowerCase() === 'user')
          : undefined
      const userText =
        role === 'user' ? text : prevUser ? String(prevUser.content || '') : ''
      const assistantText = role === 'assistant' ? text : ''

      const extracted = extractAssistantPreferredNames(assistantText, userText)
      for (const n of extracted.preferredNames || []) addName(n, conv.id || 'unknown', false)
      for (const n of extracted.rejectedNames || []) addName(n, conv.id || 'unknown', true)

      // Also harvest from user-only turns (me encanta llamarte…)
      if (role === 'user') {
        const only = extractAssistantPreferredNames('', text)
        for (const n of only.preferredNames || []) addName(n, conv.id || 'unknown', false)
      }
    }
  }

  if (preferred.length) {
    growthHints.push(
      `Apodos recuperados de chats: ${preferred.slice(0, 4).join(', ')} (forman parte de vuestra historia).`
    )
  }

  return {
    preferredNames: preferred.slice(0, 8),
    rejectedNames: rejected.slice(0, 6),
    growthHints: growthHints.slice(0, 3),
    sources,
    scannedMessages,
    scannedConversations
  }
}

/**
 * Merge harvest into assistant memory. Returns next memory + whether anything changed.
 */
export function applyHarvestToAssistantMemory(
  prev: AssistantMemory | null | undefined,
  harvest: HarvestResult
): { next: AssistantMemory; changed: boolean; addedNames: string[] } {
  const before = new Set((prev?.preferredNames || []).map((s) => s.toLowerCase()))
  const addedNames = harvest.preferredNames.filter((n) => !before.has(n.toLowerCase()))
  const patch: Partial<AssistantMemory> = {}
  if (harvest.preferredNames.length) patch.preferredNames = harvest.preferredNames
  if (harvest.rejectedNames.length) patch.rejectedNames = harvest.rejectedNames
  if (addedNames.length && harvest.growthHints.length) {
    patch.growthNotes = harvest.growthHints
  }
  const next = mergeAssistantMemory(prev, patch)
  const changed =
    addedNames.length > 0 ||
    (harvest.rejectedNames || []).some(
      (n) => !(prev?.rejectedNames || []).map((x) => x.toLowerCase()).includes(n.toLowerCase())
    )
  return { next, changed, addedNames }
}

/**
 * Light user-fact harvest from the same transcripts (explicit patterns only).
 */
export function harvestUserFactsFromConversations(
  conversations: HarvestConversation[],
  opts?: { maxMessagesPerConv?: number; maxConvs?: number }
): Partial<UserMemory> {
  const maxPer = Math.max(20, opts?.maxMessagesPerConv ?? 200)
  const maxConvs = Math.max(1, opts?.maxConvs ?? 20)
  let acc: UserMemory | null = null
  for (const conv of (conversations || []).slice(0, maxConvs)) {
    const msgs = (conv.messages || []).filter(isHarvestable).slice(-maxPer)
    for (const m of msgs) {
      if (String(m.role).toLowerCase() !== 'user') continue
      const facts = extractUserFactsFromMessage(String(m.content || ''))
      if (!facts || (!facts.preferredName && !facts.likes?.length && !facts.facts?.length)) continue
      acc = mergeUserMemory(acc, facts as never)
    }
  }
  return (acc || {}) as Partial<UserMemory>
}
