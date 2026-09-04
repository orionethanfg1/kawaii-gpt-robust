/**
 * Shared provider contracts. Core never imports Electron or React.
 */

export type ProviderKind = 'ollama' | 'openai-compatible' | 'legacy'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
  signal?: AbortSignal
}

export interface ChatCompletionChunk {
  content: string
  done: boolean
  model?: string
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
}

export interface ChatCompletionResult {
  content: string
  model: string
  usage?: ChatCompletionChunk['usage']
  finishReason?: string
}

export interface ModelInfo {
  id: string
  name: string
  sizeBytes?: number
  family?: string
  parameterSize?: string
  quantization?: string
  isLocal: boolean
}

export interface ProviderHealth {
  ok: boolean
  latencyMs?: number
  error?: string
  modelsCount?: number
}

export interface ChatProvider {
  readonly id: string
  readonly kind: ProviderKind
  readonly displayName: string

  healthCheck(signal?: AbortSignal): Promise<ProviderHealth>
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResult>
  chatStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void
  ): Promise<ChatCompletionResult>
}

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  baseUrl: string
  apiKey?: string
  defaultModel?: string
  timeoutMs?: number
}
