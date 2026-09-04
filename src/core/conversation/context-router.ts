/**
 * Context router (A1):
 * - Estimate payload size
 * - Choose budget by model context window
 * - Prefer local summarization when available
 * - Suggest wide-context models when the prompt is large
 * - Drive silent shrink retries on CONTEXT_OVERFLOW
 */

import type { ChatMessage } from '@core/providers'
import {
  type ContextBudget,
  defaultBudget,
  shrinkBudget,
  packContext,
  type PackedContext
} from './context-window'

/** Rough tokens ≈ chars / 4 (Spanish/English mix) */
export function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4))
}

export function estimateMessagesChars(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + (m.content?.length ?? 0) + 24, 0)
}

/**
 * Known / assumed context windows (tokens). Conservative for free tiers.
 * Used only to size budgets — not as hard API limits.
 */
export const MODEL_CONTEXT_TOKENS: Record<string, number> = {
  // Local defaults (many GGUF are 4k–8k; leave headroom)
  local: 8192,
  ollama: 8192,
  // Groq
  'llama-3.1-8b-instant': 8192,
  'llama-3.3-70b-versatile': 128_000,
  'gemma2-9b-it': 8192,
  // OpenRouter free router / common
  'openrouter/free': 32_768,
  'meta-llama/llama-3.2-3b-instruct:free': 8192,
  'google/gemini-2.0-flash-exp:free': 1_000_000,
  'google/gemma-2-9b-it:free': 8192,
  // Gemini API
  'gemini-2.0-flash': 1_000_000,
  'gemini-1.5-flash': 1_000_000,
  // OpenAI-ish
  'gpt-4o-mini': 128_000
}

/** Prefer these when the packed prompt is large */
export const WIDE_CONTEXT_MODELS: Record<string, string> = {
  openrouter: 'openrouter/free',
  gemini: 'gemini-2.0-flash',
  groq: 'llama-3.1-8b-instant', // no true free wide on groq; keep safe
  openai: 'gpt-4o-mini',
  local: 'local'
}

export function contextTokensForModel(modelId: string, kind: 'local' | 'cloud'): number {
  const id = (modelId || '').trim().toLowerCase()
  if (!id) return kind === 'local' ? 8192 : 32_768
  if (MODEL_CONTEXT_TOKENS[id]) return MODEL_CONTEXT_TOKENS[id]
  // fuzzy
  if (id.includes('gemini')) return 1_000_000
  if (id.includes('gpt-4o')) return 128_000
  if (id.includes('70b')) return 32_768
  if (id.includes('openrouter/free')) return 32_768
  return kind === 'local' ? 8192 : 32_768
}

/**
 * Budget in chars for a model, leaving room for the completion.
 */
export function budgetForModel(
  modelId: string,
  kind: 'local' | 'cloud',
  completionReserveTokens = 1024
): ContextBudget {
  const windowTok = contextTokensForModel(modelId, kind)
  const usableTok = Math.max(1024, windowTok - completionReserveTokens)
  // Cap local aggressively; cloud can be larger but not insane for free APIs
  const maxCharsCap = kind === 'local' ? 14_000 : 96_000
  const maxChars = Math.min(maxCharsCap, usableTok * 4)
  const keepRecent =
    kind === 'local' ? (maxChars < 8000 ? 6 : 8) : maxChars > 40_000 ? 20 : 14
  return { maxChars, keepRecentMessages: keepRecent }
}

export type ContextPlan = {
  estimatedChars: number
  estimatedTokens: number
  modelId: string
  kind: 'local' | 'cloud'
  budget: ContextBudget
  /** Prompt is large relative to model window */
  isTight: boolean
  /** Recommend switching to a wider-context model id (same provider if possible) */
  suggestWideModelId?: string
  /** Should force a fresh summary before send */
  forceSummary: boolean
  note: string
}

export function planContext(input: {
  systemMessages: ChatMessage[]
  history: ChatMessage[]
  userContent: string
  modelId: string
  kind: 'local' | 'cloud'
  providerId?: string
}): ContextPlan {
  const draft: ChatMessage[] = [
    ...input.systemMessages,
    ...input.history,
    { role: 'user', content: input.userContent }
  ]
  const estimatedChars = estimateMessagesChars(draft)
  const estimatedTokens = estimateTokensFromChars(estimatedChars)
  const budget = budgetForModel(input.modelId, input.kind)
  const windowTok = contextTokensForModel(input.modelId, input.kind)
  // Tight if we use >55% of window before packing
  const isTight = estimatedTokens > windowTok * 0.55 || estimatedChars > budget.maxChars * 0.85
  const forceSummary =
    input.history.length > budget.keepRecentMessages + 2 || isTight

  let suggestWideModelId: string | undefined
  if (isTight && input.kind === 'cloud' && input.providerId) {
    const wide = WIDE_CONTEXT_MODELS[input.providerId]
    if (wide && wide !== input.modelId) {
      const wideTok = contextTokensForModel(wide, 'cloud')
      if (wideTok > windowTok) suggestWideModelId = wide
    }
    // Cross-provider hint: gemini/openrouter free when still tight
    if (!suggestWideModelId && estimatedTokens > 12_000) {
      if (input.providerId !== 'gemini') suggestWideModelId = WIDE_CONTEXT_MODELS.gemini
      else suggestWideModelId = WIDE_CONTEXT_MODELS.openrouter
    }
  }

  const note = isTight
    ? `Contexto ajustado (~${estimatedTokens} tok est. / ventana ${windowTok}). Se compactará${suggestWideModelId ? ` y se preferirá modelo amplio (${suggestWideModelId})` : ''}.`
    : `Contexto holgado (~${estimatedTokens} tok est.).`

  return {
    estimatedChars,
    estimatedTokens,
    modelId: input.modelId,
    kind: input.kind,
    budget,
    isTight,
    suggestWideModelId,
    forceSummary,
    note
  }
}

/** Pack with plan budget; optional extra shrink passes already in orchestrator */
export function packWithPlan(
  systemMessages: ChatMessage[],
  history: ChatMessage[],
  userContent: string,
  plan: ContextPlan,
  summary?: string
): PackedContext {
  return packContext(
    systemMessages,
    history,
    { role: 'user', content: userContent },
    plan.budget,
    summary
  )
}

/** Multi-step shrink for overflow recovery */
export function aggressiveShrink(budget: ContextBudget, pass: number): ContextBudget {
  let b = budget
  for (let i = 0; i < pass; i++) b = shrinkBudget(b)
  return b
}

export function defaultBudgetSafe(kind: 'local' | 'cloud'): ContextBudget {
  return defaultBudget(kind)
}
