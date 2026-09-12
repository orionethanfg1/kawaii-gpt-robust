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
  stream?: boolean
  signal?: AbortSignal
}

export type ChatChunk = { content?: string; done?: boolean }
export type ChatResult = { content: string; model?: string }

export type HealthResult = { ok: boolean; latencyMs?: number; error?: string }

export interface ChatProvider {
  id: string
  displayName: string
  healthCheck(): Promise<HealthResult>
  chat(request: ChatRequest): Promise<ChatResult>
  chatStream(request: ChatRequest, onChunk: (c: ChatChunk) => void): Promise<void>
}
