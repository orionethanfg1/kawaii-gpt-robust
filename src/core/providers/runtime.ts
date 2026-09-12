import type { ChatCompletionRequest, ChatCompletionResult, ChatProvider } from './types'

export interface LocalRuntimeAdapter extends ChatProvider {
  runtime: 'ollama' | 'llama.cpp' | 'openai-compatible'
  pull?: (model: string, signal?: AbortSignal) => Promise<{ ok: boolean; error?: string }>
  stop?: () => Promise<void>
}

export function asLocalRuntime(provider: ChatProvider, runtime: LocalRuntimeAdapter['runtime']): LocalRuntimeAdapter {
  return Object.assign(provider, { runtime })
}

export type RuntimeHealth = Awaited<ReturnType<ChatProvider['healthCheck']>>
export type RuntimeRequest = ChatCompletionRequest
export type RuntimeResponse = ChatCompletionResult
