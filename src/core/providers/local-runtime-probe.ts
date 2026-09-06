/**
 * Probe local OpenAI-compatible servers (LM Studio, llama.cpp, vLLM, etc.)
 * and pick a working chat backend without user configuration when possible.
 */

import { OpenAICompatibleProvider } from './openai-compatible'
import { OllamaProvider } from './ollama'
import type { ChatProvider } from './types'
import { asLocalRuntime, type LocalRuntimeAdapter } from './runtime'

/** Common local OpenAI-compatible ports (Windows / desktop apps) */
export const LOCAL_OPENAI_CANDIDATES: Array<{ baseUrl: string; label: string }> = [
  { baseUrl: 'http://127.0.0.1:1234/v1', label: 'LM Studio' },
  { baseUrl: 'http://localhost:1234/v1', label: 'LM Studio' },
  { baseUrl: 'http://127.0.0.1:1235/v1', label: 'LM Studio (alt)' },
  { baseUrl: 'http://127.0.0.1:4891/v1', label: 'LM Studio / GPT4All' },
  { baseUrl: 'http://127.0.0.1:8080/v1', label: 'llama.cpp server' },
  { baseUrl: 'http://127.0.0.1:8080', label: 'llama.cpp (no /v1)' },
  { baseUrl: 'http://127.0.0.1:5000/v1', label: 'Local AI / text-gen' },
  { baseUrl: 'http://127.0.0.1:11434/v1', label: 'Ollama OpenAI shim' }
]

export type LocalRuntimeKind = 'ollama' | 'openai-compatible'

export interface ResolvedLocalRuntime {
  provider: LocalRuntimeAdapter
  kind: LocalRuntimeKind
  baseUrl: string
  label: string
  defaultModel?: string
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
    ])
  } catch {
    return null
  }
}

/** Quick health + first model id for OpenAI-compatible endpoint */
export async function probeOpenAICompatible(
  baseUrl: string,
  label: string,
  signal?: AbortSignal
): Promise<ResolvedLocalRuntime | null> {
  // Health uses withTimeout below; provider must keep a long chat timeout
  // (previously 4s caused every local reply to die as "Tiempo de espera agotado")
  const provider = new OpenAICompatibleProvider({
    id: 'local-openai',
    displayName: label,
    baseUrl,
    apiKey: 'not-needed',
    timeoutMs: 300_000
  })
  const health = await withTimeout(provider.healthCheck(signal), 3500)
  if (!health?.ok) return null
  let defaultModel: string | undefined
  try {
    const models = await withTimeout(provider.listModels(signal), 3500)
    defaultModel = models?.[0]?.id
  } catch {
    /* ignore */
  }
  return {
    provider: asLocalRuntime(provider, 'openai-compatible'),
    kind: 'openai-compatible',
    baseUrl,
    label,
    defaultModel
  }
}

export async function probeOllama(
  baseUrl: string,
  signal?: AbortSignal
): Promise<ResolvedLocalRuntime | null> {
  const provider = new OllamaProvider({ baseUrl, timeoutMs: 300_000 })
  const health = await withTimeout(provider.healthCheck(signal), 4000)
  if (!health?.ok) return null
  return {
    provider: asLocalRuntime(provider, 'ollama'),
    kind: 'ollama',
    baseUrl,
    label: 'Ollama',
    defaultModel: undefined
  }
}

/**
 * Auto-resolve local runtime.
 * Order: explicit OpenAI URL → Ollama → scan common OpenAI-compatible ports.
 */
export async function resolveLocalRuntime(opts: {
  preference?: 'auto' | 'ollama' | 'openai-compatible'
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
  signal?: AbortSignal
}): Promise<ResolvedLocalRuntime | null> {
  const pref = opts.preference || 'auto'
  const ollamaUrl = opts.ollamaBaseUrl || 'http://127.0.0.1:11434'

  if (pref === 'openai-compatible' || pref === 'auto') {
    if (opts.openAIBaseUrl) {
      const hit = await probeOpenAICompatible(
        opts.openAIBaseUrl,
        'Local OpenAI-compatible',
        opts.signal
      )
      if (hit) return hit
    }
  }

  if (pref === 'ollama' || pref === 'auto') {
    const o = await probeOllama(ollamaUrl, opts.signal)
    if (o) return o
  }

  if (pref === 'openai-compatible' || pref === 'auto') {
    for (const c of LOCAL_OPENAI_CANDIDATES) {
      if (opts.openAIBaseUrl && c.baseUrl === opts.openAIBaseUrl) continue
      const hit = await probeOpenAICompatible(c.baseUrl, c.label, opts.signal)
      if (hit) return hit
    }
  }

  // Last chance: Ollama even if preference was openai-only
  if (pref === 'openai-compatible') {
    return probeOllama(ollamaUrl, opts.signal)
  }

  return null
}

export function asChatProvider(r: ResolvedLocalRuntime): ChatProvider {
  return r.provider
}
