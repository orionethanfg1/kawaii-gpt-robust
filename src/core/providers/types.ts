export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type ChatMessage = {
  role: ChatRole
  content: string
  name?: string
}

export type ChatRequest = {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  /** Soft hint for runtimes that support disabling chain-of-thought */
  preferThinkingOff?: boolean
  stream?: boolean
  signal?: AbortSignal
}

export type ChatChunk = {
  content?: string
  done?: boolean
  /** OpenAI-style finish_reason when present on the terminal chunk */
  finishReason?: string | null
}
export type ChatResult = {
  content: string
  model?: string
  /** stop | length | content_filter | … */
  finishReason?: string | null
}

export type HealthResult = { ok: boolean; latencyMs?: number; error?: string }

export interface ChatProvider {
  id: string
  displayName: string
  healthCheck(): Promise<HealthResult>
  chat(request: ChatRequest): Promise<ChatResult>
  chatStream(request: ChatRequest, onChunk: (c: ChatChunk) => void): Promise<void>
}
