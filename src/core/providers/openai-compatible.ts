import type { ChatProvider, ChatRequest, ChatResult, ChatChunk, HealthResult } from './types'
import { AppError, classifyProviderError } from '../errors'

export type OpenAICompatibleOptions = {
  id: string
  displayName: string
  baseUrl: string
  apiKey?: string
  timeoutMs?: number
}

export class OpenAICompatibleProvider implements ChatProvider {
  readonly id: string
  readonly displayName: string
  private baseUrl: string
  private apiKey: string
  private timeoutMs: number

  constructor(opts: OpenAICompatibleOptions) {
    this.id = opts.id
    this.displayName = opts.displayName
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.apiKey = opts.apiKey || ''
    this.timeoutMs = opts.timeoutMs ?? 90_000
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (this.apiKey && this.apiKey !== 'not-needed') {
      h.Authorization = `Bearer ${this.apiKey}`
    }
    return h
  }

  private url(path: string): string {
    const root = this.baseUrl.endsWith('/v1') ? this.baseUrl : `${this.baseUrl}`
    if (path.startsWith('/')) return `${root}${path}`
    return `${root}/${path}`
  }

  async healthCheck(): Promise<HealthResult> {
    const t0 = Date.now()
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8_000)
      const res = await fetch(this.url('/models'), {
        headers: this.headers(),
        signal: ctrl.signal
      }).finally(() => clearTimeout(timer))
      if (res.ok) return { ok: true, latencyMs: Date.now() - t0 }
      // some servers lack /models — try minimal probe
      if (res.status === 404) return { ok: true, latencyMs: Date.now() - t0 }
      return { ok: false, latencyMs: Date.now() - t0, error: `HTTP ${res.status}` }
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        error: e instanceof Error ? e.message : String(e)
      }
    }
  }

  private body(req: ChatRequest, stream: boolean) {
    return {
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens,
      stream
    }
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    const signal = request.signal
      ? AbortSignal.any([request.signal, ctrl.signal])
      : ctrl.signal
    try {
      const res = await fetch(this.url('/chat/completions'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.body(request, false)),
        signal
      })
      const text = await res.text()
      if (!res.ok) {
        throw classifyProviderError(text || `HTTP ${res.status}`, this.id)
      }
      const json = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>
        model?: string
      }
      const content = json.choices?.[0]?.message?.content || ''
      return { content, model: json.model || request.model }
    } catch (e) {
      if (e instanceof AppError) throw e
      throw classifyProviderError(e instanceof Error ? e.message : String(e), this.id)
    } finally {
      clearTimeout(timer)
    }
  }

  async chatStream(request: ChatRequest, onChunk: (c: ChatChunk) => void): Promise<void> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    const signal = request.signal
      ? AbortSignal.any([request.signal, ctrl.signal])
      : ctrl.signal
    try {
      const res = await fetch(this.url('/chat/completions'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.body(request, true)),
        signal
      })
      if (!res.ok) {
        const text = await res.text()
        throw classifyProviderError(text || `HTTP ${res.status}`, this.id)
      }
      if (!res.body) {
        // fallback non-stream
        const result = await this.chat({ ...request, stream: false })
        if (result.content) onChunk({ content: result.content })
        onChunk({ done: true })
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
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') {
            onChunk({ done: true })
            continue
          }
          try {
            const json = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>
            }
            const piece = json.choices?.[0]?.delta?.content
            if (piece) onChunk({ content: piece })
          } catch {
            /* ignore partial */
          }
        }
      }
    } catch (e) {
      if (e instanceof AppError) throw e
      throw classifyProviderError(e instanceof Error ? e.message : String(e), this.id)
    } finally {
      clearTimeout(timer)
    }
  }
}
