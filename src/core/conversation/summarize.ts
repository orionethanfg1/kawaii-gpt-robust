/**
 * Model-backed conversation summarization with heuristic fallback.
 * Optimized for local models: short transcript, low tokens, hard timeout.
 */

import type { ChatMessage, ChatProvider } from '@core/providers'
import { buildHeuristicSummary } from './context-window'

export interface SummarizeOptions {
  provider: ChatProvider
  model: string
  older: ChatMessage[]
  previousSummary?: string
  signal?: AbortSignal
  maxSummaryChars?: number
  temperature?: number
  /** Prefer speed over model quality (local 8B etc.) */
  preferFast?: boolean
  /** Hard wall-clock budget for the model call (ms) */
  timeoutMs?: number
}

export interface SummarizeResult {
  summary: string
  source: 'model' | 'heuristic'
  coveredCount: number
}

const SUMMARY_SYSTEM = `Comprime la conversación en pocas viñetas densas (máx 8).
Solo hechos, nombres, preferencias y estado. Español. No inventes. No respondas al usuario.`

function formatTranscript(older: ChatMessage[], maxChars = 3500): string {
  const lines: string[] = []
  for (const m of older) {
    if (m.role === 'system') continue
    const role = m.role === 'user' ? 'U' : 'A'
    const body = m.content.replace(/\s+/g, ' ').trim()
    if (!body) continue
    lines.push(`${role}: ${body.slice(0, 400)}`)
  }
  let text = lines.join('\n')
  if (text.length > maxChars) {
    text = text.slice(text.length - maxChars)
    const cut = text.indexOf('\n')
    if (cut > 0 && cut < 120) text = text.slice(cut + 1)
  }
  return text
}

export async function summarizeConversation(
  options: SummarizeOptions
): Promise<SummarizeResult> {
  const maxSummaryChars = options.maxSummaryChars ?? (options.preferFast ? 700 : 1200)
  const coveredCount = options.older.filter((m) => m.role !== 'system').length
  const prev = options.previousSummary?.trim() || ''

  if (coveredCount === 0) {
    return { summary: prev, source: 'heuristic', coveredCount: 0 }
  }

  // Fast path: small history → heuristic only (no local LLM wait)
  if (options.preferFast !== false && coveredCount <= 10 && prev.length > 40) {
    const heuristic = buildHeuristicSummary(options.older, maxSummaryChars)
    const combined = `${prev}\n---\n${heuristic}`.slice(0, maxSummaryChars)
    return { summary: combined, source: 'heuristic', coveredCount }
  }

  if (options.preferFast !== false && coveredCount <= 6) {
    return {
      summary: buildHeuristicSummary(options.older, maxSummaryChars) || prev,
      source: 'heuristic',
      coveredCount
    }
  }

  const transcript = formatTranscript(options.older, options.preferFast ? 2800 : 5000)
  const timeoutMs = options.timeoutMs ?? (options.preferFast !== false ? 22_000 : 45_000)

  try {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onAbort)
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const result = await options.provider.chat({
        model: options.model,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM },
          {
            role: 'user',
            content:
              (prev ? `Resumen previo:\n${prev.slice(0, 500)}\n\n` : '') +
              `Conversación a comprimir:\n${transcript}\n\nResumen:`
          }
        ],
        temperature: options.temperature ?? 0.2,
        maxTokens: options.preferFast !== false ? 280 : 450,
        signal: controller.signal
      })

      let summary = (result.content || '').trim()
      summary = summary.replace(/^```[\s\S]*?\n/, '').replace(/```$/, '').trim()
      if (summary.length > maxSummaryChars) {
        summary = summary.slice(0, maxSummaryChars - 1) + '…'
      }
      if (summary.length >= 20) {
        return { summary, source: 'model', coveredCount }
      }
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  } catch {
    // timeout / fail → heuristic
  }

  const heuristic = buildHeuristicSummary(options.older, maxSummaryChars)
  const combined = prev
    ? `${prev}\n---\n${heuristic}`.slice(0, maxSummaryChars)
    : heuristic

  return { summary: combined, source: 'heuristic', coveredCount }
}

export function shouldSummarize(
  historyLength: number,
  keepRecent: number,
  minOlder = 8
): boolean {
  return historyLength - keepRecent >= minOlder
}
