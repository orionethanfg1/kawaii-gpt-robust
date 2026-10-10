import type { ChatProvider, ChatRequest, ChatResult, ChatChunk, HealthResult } from './types'
import { localHttp } from './local-http'
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
    const local = /127\.0\.0\.1|localhost|::1/i.test(this.baseUrl)
    this.timeoutMs = opts.timeoutMs ?? (local ? 300_000 : 90_000)
  }

  private isLocalHost(): boolean {
    try {
      const host = new URL(
        this.baseUrl.startsWith('http') ? this.baseUrl : `http://${this.baseUrl}`
      ).hostname.toLowerCase()
      return host === '127.0.0.1' || host === 'localhost' || host === '::1'
    } catch {
      return /127\.0\.0\.1|localhost/i.test(this.baseUrl)
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (this.apiKey && this.apiKey !== 'not-needed') {
      h.Authorization = `Bearer ${this.apiKey}`
    } else if (this.isLocalHost()) {
      // LM Studio accepts this; required when "Require Authentication" uses default token
      h.Authorization = 'Bearer lm-studio'
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
      const res = await localHttp(this.url('/models'), {
        headers: this.headers(),
        timeoutMs: 8_000
      })
      if (res.ok) return { ok: true, latencyMs: Date.now() - t0 }
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
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: req.temperature ?? 0.7,
      stream
    }
    const mt = Number(req.maxTokens)
    if (Number.isFinite(mt) && mt > 0) body.max_tokens = Math.floor(mt)
    if (typeof req.topP === 'number') body.top_p = req.topP
    if (typeof req.topK === 'number') body.top_k = req.topK
    // LM Studio / some OpenAI-compat servers ignore unknown fields safely
    if (req.preferThinkingOff === true) {
      body.enable_thinking = false
      body.thinking = false
      body.reasoning_effort = 'none'
      body.chat_template_kwargs = { enable_thinking: false }
    }
    // Reduce loop-y replies on local 7–14B models
    if (/127\.0\.0\.1|localhost|::1/i.test(this.baseUrl)) {
      if (body.frequency_penalty === undefined) body.frequency_penalty = 0.45
      if (body.presence_penalty === undefined) body.presence_penalty = 0.25
    }
    return body
  }

  /** Normalize local/cloud completion payloads (Qwen thinking, LM Studio quirks). */
  private extractMessageContent(json: {
    choices?: Array<{
      message?: {
        content?: string | null
        reasoning?: string
        reasoning_content?: string
      }
      text?: string
    }>
  }): string {
    const choice = json.choices?.[0]
    const msg = choice?.message
    let content = String(msg?.content ?? choice?.text ?? '').trim()
    // Do NOT promote reasoning_* to visible reply — that is the "thinking" leak
    if (/<\/?think/i.test(content)) {
      const after = content.split(/<\/think>/i).pop() || ''
      content = after.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || content
    }
    // English CoT leaked as content (Qwen3 when server ignores enable_thinking)
    if (
      /^(Okay,|Alright,|First, I|Hmm,|Wait, the|The user asked|As \w+, I need)/i.test(
        content.slice(0, 80)
      )
    ) {
      try {
        // Inline minimal strip to avoid circular imports in main bundle
        const parts = content.split(/\n{2,}/)
        const kept = parts.filter(
          (p) =>
            !/^(Okay,|Alright,|First,|Hmm,|Wait,|The user |As \w+, I|Let me |I need to )/i.test(
              p.trim()
            )
        )
        if (kept.length) content = kept.join('\n\n').trim()
        else content = ''
      } catch {
        /* keep */
      }
    }
    return content
  }

  async chat(request: ChatRequest): Promise<ChatResult> {

    try {
      const res = await localHttp(this.url('/chat/completions'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.body(request, false)),
        timeoutMs: this.timeoutMs
      })
      const text = await res.text()
      if (!res.ok) {
        const detail = res.error || text || `HTTP ${res.status}`
        throw classifyProviderError(detail, this.id)
      }
      let json: {
        choices?: Array<{
          message?: {
            content?: string | null
            reasoning?: string
            reasoning_content?: string
          }
          text?: string
        }>
        model?: string
        error?: { message?: string }
      }
      try {
        json = JSON.parse(text) as typeof json
      } catch {
        throw classifyProviderError(
          text.slice(0, 200) || 'Respuesta local no es JSON válido',
          this.id
        )
      }
      if (json.error?.message) {
        throw classifyProviderError(json.error.message, this.id)
      }
      const content = this.extractMessageContent(json)
      const finishReason =
        (json.choices?.[0] as { finish_reason?: string } | undefined)?.finish_reason ?? null
      return { content, model: json.model || request.model, finishReason }
    } catch (e) {
      if (e instanceof AppError) throw e
      throw classifyProviderError(e instanceof Error ? e.message : String(e), this.id)
    }
  }

  async chatStream(request: ChatRequest, onChunk: (c: ChatChunk) => void): Promise<void> {
    // Electron renderer → localhost CORS: proxy via main (non-stream). Cloud uses normal fetch.
    if (typeof window !== 'undefined' && window.kawaii?.localFetch && this.isLocalHost()) {
      // Prefer thinking off on local to avoid empty content-only-reasoning replies
      const req = {
        ...request,
        preferThinkingOff: request.preferThinkingOff !== false
      }
      const r = await this.chat(req)
      if (r.content && r.content.trim()) {
        onChunk({ content: r.content, finishReason: r.finishReason, done: true })
        return
      }
      // Empty body with HTTP 200 — surface a clear error (not silent success)
      throw new AppError({
        code: 'PROVIDER_UNAVAILABLE',
        message:
          'El servidor local respondió vacío. Carga el modelo en LM Studio/Ollama y desactiva «thinking» si el chat queda en blanco.',
        provider: this.id,
        retryable: true
      })
    }
    const ctrl = new AbortController()
    // Idle timeout: abort only if no network/token activity for timeoutMs
    let lastActivity = Date.now()
    const idleWatch = setInterval(() => {
      if (Date.now() - lastActivity > this.timeoutMs) ctrl.abort()
    }, 1000)
    let signal: AbortSignal = ctrl.signal
    try {
      if (request.signal) {
        if (typeof AbortSignal.any === 'function') {
          signal = AbortSignal.any([request.signal, ctrl.signal])
        } else {
          request.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
          signal = ctrl.signal
        }
      }
    } catch {
      signal = ctrl.signal
    }
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
        const result = await this.chat({ ...request, stream: false })
        if (result.content) onChunk({ content: result.content })
        onChunk({ done: true })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const emitDelta = (json: {
        choices?: Array<{
          delta?: { content?: string | null; text?: string }
          text?: string
        }>
      }) => {
        const d = json.choices?.[0]?.delta
        const piece =
          (d && (d.content || d.text)) || json.choices?.[0]?.text || ''
        if (piece) {
          lastActivity = Date.now()
          onChunk({ content: String(piece) })
        }
      }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        lastActivity = Date.now()
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
              choices?: Array<{
                delta?: { content?: string | null; text?: string }
                finish_reason?: string | null
                text?: string
              }>
            }
            emitDelta(json)
            const fr = json.choices?.[0]?.finish_reason
            if (fr) onChunk({ finishReason: fr })
          } catch {
            /* ignore partial */
          }
        }
      }
      if (buffer.trim().startsWith('data:')) {
        const data = buffer.trim().slice(5).trim()
        if (data && data !== '[DONE]') {
          try {
            emitDelta(JSON.parse(data) as Parameters<typeof emitDelta>[0])
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e) {
      if (e instanceof AppError) throw e
      throw classifyProviderError(e instanceof Error ? e.message : String(e), this.id)
    } finally {
      clearInterval(idleWatch)
    }
  }
}
