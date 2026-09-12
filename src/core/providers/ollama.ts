import type { ChatProvider, ChatRequest, ChatResult, ChatChunk, HealthResult } from './types'
import { AppError, classifyProviderError } from '../errors'

export class OllamaProvider implements ChatProvider {
  readonly id = 'ollama'
  readonly displayName = 'Ollama'
  private baseUrl: string
  private timeoutMs: number

  constructor(opts?: { baseUrl?: string; timeoutMs?: number }) {
    this.baseUrl = (opts?.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')
    this.timeoutMs = opts?.timeoutMs ?? 180_000
  }

  async healthCheck(): Promise<HealthResult> {
    const t0 = Date.now()
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000)
      })
      return { ok: res.ok, latencyMs: Date.now() - t0, error: res.ok ? undefined : `HTTP ${res.status}` }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
          options: {
            temperature: request.temperature,
            num_predict: request.maxTokens
          }
        }),
        signal: request.signal ?? AbortSignal.timeout(this.timeoutMs)
      })
      const text = await res.text()
      if (!res.ok) throw classifyProviderError(text || `HTTP ${res.status}`, this.id)
      const json = JSON.parse(text) as { message?: { content?: string }; model?: string }
      return { content: json.message?.content || '', model: json.model || request.model }
    } catch (e) {
      if (e instanceof AppError) throw e
      throw classifyProviderError(e instanceof Error ? e.message : String(e), this.id)
    }
  }

  async chatStream(request: ChatRequest, onChunk: (c: ChatChunk) => void): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
          options: {
            temperature: request.temperature,
            num_predict: request.maxTokens
          }
        }),
        signal: request.signal ?? AbortSignal.timeout(this.timeoutMs)
      })
      if (!res.ok) {
        const text = await res.text()
        throw classifyProviderError(text || `HTTP ${res.status}`, this.id)
      }
      if (!res.body) {
        const r = await this.chat(request)
        if (r.content) onChunk({ content: r.content })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const json = JSON.parse(trimmed) as {
              message?: { content?: string }
              done?: boolean
            }
            if (json.message?.content) onChunk({ content: json.message.content })
            if (json.done) onChunk({ done: true })
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e) {
      if (e instanceof AppError) throw e
      throw classifyProviderError(e instanceof Error ? e.message : String(e), this.id)
    }
  }
}
