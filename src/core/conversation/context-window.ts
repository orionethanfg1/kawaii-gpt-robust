/**
 * Sliding context window + lightweight rolling summary.
 * Prevents CONTEXT_OVERFLOW / token limit errors while keeping long chats usable.
 */

import type { ChatMessage } from '@core/providers'

export interface ContextBudget {
  /** Approximate max characters for the whole prompt payload (chars ≈ tokens * 4) */
  maxChars: number
  /** Always keep the last N messages fully */
  keepRecentMessages: number
}

export interface PackedContext {
  messages: ChatMessage[]
  truncated: boolean
  droppedCount: number
  summaryInjected: boolean
}

/** Rough char budget by provider kind */
export function defaultBudget(kind: 'local' | 'cloud'): ContextBudget {
  // Conservative: leave room for response generation
  if (kind === 'local') {
    return { maxChars: 12_000, keepRecentMessages: 8 }
  }
  return { maxChars: 48_000, keepRecentMessages: 16 }
}

function approxLen(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + (m.content?.length ?? 0) + 20, 0)
}

/**
 * Build a short rolling summary of older turns (lossy, but free of extra model calls).
 */
export function buildHeuristicSummary(older: ChatMessage[], maxChars = 1200): string {
  const lines: string[] = []
  for (const m of older) {
    if (m.role === 'system') continue
    const role = m.role === 'user' ? 'Usuario' : 'Asistente'
    const snippet = m.content.replace(/\s+/g, ' ').trim().slice(0, 160)
    if (!snippet) continue
    lines.push(`- ${role}: ${snippet}${m.content.length > 160 ? '…' : ''}`)
  }
  let text = lines.join('\n')
  if (text.length > maxChars) {
    text = text.slice(text.length - maxChars)
    const cut = text.indexOf('\n')
    if (cut > 0) text = text.slice(cut + 1)
  }
  return text
}

/**
 * Pack history into a safe window:
 * system prompts first, optional summary of dropped turns, then recent messages.
 */
export function packContext(
  systemMessages: ChatMessage[],
  history: ChatMessage[],
  userMessage: ChatMessage,
  budget: ContextBudget,
  /** Precomputed rolling summary (model or heuristic). Falls back to heuristic if missing. */
  externalSummary?: string
): PackedContext {
  const recent = history.slice(-budget.keepRecentMessages)
  const older = history.slice(0, Math.max(0, history.length - budget.keepRecentMessages))

  let messages: ChatMessage[] = [...systemMessages, ...recent, userMessage]
  let truncated = false
  let droppedCount = older.length
  let summaryInjected = false

  if (older.length > 0) {
    const summary = (externalSummary && externalSummary.trim()) || buildHeuristicSummary(older)
    if (summary) {
      messages = [
        ...systemMessages,
        {
          role: 'system',
          content:
            'Resumen de turnos anteriores de esta conversación (para continuidad; puede ser incompleto):\n' +
            summary
        },
        ...recent,
        userMessage
      ]
      summaryInjected = true
    }
  }

  // If still too large, drop oldest recent messages (keep system + user)
  while (approxLen(messages) > budget.maxChars && messages.length > systemMessages.length + 2) {
    // Find first non-system after system block
    const idx = messages.findIndex(
      (m, i) => i >= systemMessages.length && m.role !== 'system' && m !== userMessage
    )
    if (idx < 0) break
    messages.splice(idx, 1)
    truncated = true
    droppedCount += 1
  }

  // Last resort: hard-trim user message content (should be rare)
  const total = approxLen(messages)
  if (total > budget.maxChars) {
    const overflow = total - budget.maxChars
    const last = messages[messages.length - 1]
    if (last?.role === 'user' && last.content.length > overflow + 200) {
      last.content =
        last.content.slice(0, last.content.length - overflow - 80) +
        '\n\n[…mensaje recortado por límite de contexto]'
      truncated = true
    }
  }

  return { messages, truncated, droppedCount, summaryInjected }
}

/** Tighter budget for recovery after CONTEXT_OVERFLOW */
export function shrinkBudget(budget: ContextBudget): ContextBudget {
  return {
    maxChars: Math.max(3000, Math.floor(budget.maxChars * 0.55)),
    keepRecentMessages: Math.max(2, Math.floor(budget.keepRecentMessages / 2))
  }
}
