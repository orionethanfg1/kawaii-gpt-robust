/**
 * Sampling profiles: chat (snappy) vs harness/tools (more deliberate).
 * Tuned for Qwen3.x / general instruct; callers may override.
 */

import type { ChatTask } from '../routing/task-route'

export type SamplingProfileId = 'chat' | 'creative' | 'code' | 'harness' | 'summary'

export type SamplingProfile = {
  id: SamplingProfileId
  temperature: number
  topP?: number
  topK?: number
  /** Soft max tokens hint (orchestrator may still clamp) */
  maxTokensHint?: number
  /**
   * When the runtime supports it (LM Studio custom / Qwen thinking):
   * prefer disabling heavy chain-of-thought for snappy chat.
   */
  preferThinkingOff?: boolean
}

const PROFILES: Record<SamplingProfileId, SamplingProfile> = {
  chat: {
    id: 'chat',
    temperature: 0.7,
    topP: 0.8,
    topK: 20,
    maxTokensHint: 1024,
    preferThinkingOff: true
  },
  creative: {
    id: 'creative',
    temperature: 0.9,
    topP: 0.95,
    topK: 40,
    maxTokensHint: 1536,
    preferThinkingOff: true
  },
  code: {
    id: 'code',
    temperature: 0.2,
    topP: 0.95,
    topK: 20,
    maxTokensHint: 2048,
    preferThinkingOff: true
  },
  harness: {
    id: 'harness',
    temperature: 0.55,
    topP: 0.95,
    topK: 20,
    maxTokensHint: 1536,
    preferThinkingOff: false
  },
  summary: {
    id: 'summary',
    temperature: 0.4,
    topP: 0.85,
    topK: 20,
    maxTokensHint: 512,
    preferThinkingOff: true
  }
}

export function profileForTask(task: ChatTask | string): SamplingProfile {
  switch (task) {
    case 'code':
      return PROFILES.code
    case 'tools':
      return PROFILES.harness
    case 'summary':
      return PROFILES.summary
    case 'vision':
      return PROFILES.chat
    case 'chat':
    default:
      return PROFILES.chat
  }
}

/** Heuristic from free-form prompt when task is unknown */
export function profileForPrompt(prompt: string): SamplingProfile {
  const t = prompt || ''
  if (
    /\b(c[oó]digo|typescript|javascript|python|refactor|bug|stack trace)\b/i.test(t) ||
    /```/.test(t)
  ) {
    return PROFILES.code
  }
  if (
    /\b(arranca|inicia|diagn[oó]stic|forge|ollama|estado de la app|lista (los )?modelos)\b/i.test(
      t
    )
  ) {
    return PROFILES.harness
  }
  if (/\b(historia|cuento|poema|roleplay|inventa)\b/i.test(t)) {
    return PROFILES.creative
  }
  if (/\b(resum(e|ir|en)|tl;?dr|en pocas palabras)\b/i.test(t)) {
    return PROFILES.summary
  }
  return PROFILES.chat
}

export function getSamplingProfile(id: SamplingProfileId): SamplingProfile {
  return PROFILES[id]
}
