import type { ChatProvider, ChatRequest, ChatResult, ChatChunk, HealthResult } from './types'
import { AppError, classifyProviderError } from '../errors'
import { localHttp } from './local-http'
import { splitThinkingFromParts } from '../chat/split-thinking'

export class OllamaProvider implements ChatProvider {
  readonly id = 'ollama'
  readonly displayName = 'Ollama'
  private baseUrl: string
  private timeoutMs: number

  constructor(opts?: { baseUrl?: string; timeoutMs?: number }) {
    this.baseUrl = (opts?.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')
    this.timeoutMs = opts?.timeoutMs ?? 180_000
  }

  /** Models currently loaded in VRAM (Ollama loads on demand from /api/tags installs). */
  async listRunning(): Promise<string[]> {
    try {
      const res = await localHttp(`${this.baseUrl}/api/ps`, { timeoutMs: 3_000 })
      if (!res.ok) return []
      const j = (await res.json()) as { models?: Array<{ name?: string; model?: string }> }
      return (j.models || []).map((m) => m.name || m.model || '').filter(Boolean)
    } catch {
      return []
    }
  }

  async healthCheck(): Promise<HealthResult> {
    const t0 = Date.now()
    try {
      const res = await localHttp(`${this.baseUrl}/api/tags`, { timeoutMs: 5_000 })
      return {
        ok: res.ok,
        latencyMs: Date.now() - t0,
        error: res.ok ? undefined : `HTTP ${res.status}`
      }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private async ensureSingleResident(modelId: string): Promise<void> {
    const id = String(modelId || '').trim()
    if (!id) return
    try {
      const { ensureOllamaSingleResident } = await import('../resources/unload-local')
      await ensureOllamaSingleResident(id, this.baseUrl)
    } catch {
      /* best-effort */
    }
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    await this.ensureSingleResident(String(request.model || ''))
    try {
      const res = await localHttp(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map((m) => {
            const base: Record<string, unknown> = { role: m.role, content: m.content }
            // Ollama vision: prefer images[] base64; also flatten text from content parts
            const imgs = (m as { images?: string[] }).images
            if (imgs?.length) base.images = imgs
            if (Array.isArray(m.content)) {
              const texts = m.content
                .filter((p): p is { type: 'text'; text: string } =>
                  !!p && typeof p === 'object' && (p as { type?: string }).type === 'text'
                )
                .map((p) => p.text)
              const urls = m.content.filter(
                (p) =>
                  p &&
                  typeof p === 'object' &&
                  (p as { type?: string }).type === 'image_url'
              )
              if (texts.length) base.content = texts.join('\n')
              if (!imgs?.length && urls.length) {
                const b64: string[] = []
                for (const u of urls) {
                  const url = String(
                    (u as { image_url?: { url?: string } }).image_url?.url || ''
                  )
                  const ix = url.indexOf('base64,')
                  if (ix >= 0) b64.push(url.slice(ix + 7))
                }
                if (b64.length) base.images = b64
              }
            }
            return base
          }),
          stream: false,
          // Ollama docs: think true → message.thinking + message.content separated
          think: request.preferThinkingOff === true ? false : true,
          options: {
            temperature: request.temperature,
            num_predict: request.maxTokens,
            ...(typeof request.topP === 'number' ? { top_p: request.topP } : {}),
            ...(typeof request.topK === 'number' ? { top_k: request.topK } : {})
          }
        }),
        timeoutMs: this.timeoutMs
      })
      const text = await res.text()
      if (!res.ok) throw classifyProviderError(text || `HTTP ${res.status}`, this.id)
      const json = JSON.parse(text) as {
        message?: { content?: string; thinking?: string }
        model?: string
      }
      const split = splitThinkingFromParts({
        content: json.message?.content,
        thinking: json.message?.thinking
      })
      return {
        content: split.content,
        thinking: split.thinking || undefined,
        model: json.model || request.model
      }
    } catch (e) {
      if (e instanceof AppError) throw e
      throw classifyProviderError(e instanceof Error ? e.message : String(e), this.id)
    }
  }

  async chatStream(request: ChatRequest, onChunk: (c: ChatChunk) => void): Promise<void> {
    await this.ensureSingleResident(String(request.model || ''))
    // Localhost via IPC cannot stream bytes yet — use non-stream and emit once.
    // (Avoids CORS from renderer; still works for Ollama/LM Studio.)
    try {
      if (typeof window !== 'undefined' && window.kawaii?.localFetch) {
        const r = await this.chat(request)
        if (r.thinking) onChunk({ thinking: r.thinking })
        if (r.content) onChunk({ content: r.content })
        return
      }
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map((m) => {
            const base: Record<string, unknown> = { role: m.role, content: m.content }
            // Ollama vision: prefer images[] base64; also flatten text from content parts
            const imgs = (m as { images?: string[] }).images
            if (imgs?.length) base.images = imgs
            if (Array.isArray(m.content)) {
              const texts = m.content
                .filter((p): p is { type: 'text'; text: string } =>
                  !!p && typeof p === 'object' && (p as { type?: string }).type === 'text'
                )
                .map((p) => p.text)
              const urls = m.content.filter(
                (p) =>
                  p &&
                  typeof p === 'object' &&
                  (p as { type?: string }).type === 'image_url'
              )
              if (texts.length) base.content = texts.join('\n')
              if (!imgs?.length && urls.length) {
                const b64: string[] = []
                for (const u of urls) {
                  const url = String(
                    (u as { image_url?: { url?: string } }).image_url?.url || ''
                  )
                  const ix = url.indexOf('base64,')
                  if (ix >= 0) b64.push(url.slice(ix + 7))
                }
                if (b64.length) base.images = b64
              }
            }
            return base
          }),
          stream: true,
          think: request.preferThinkingOff === true ? false : true,
          options: {
            temperature: request.temperature,
            num_predict: request.maxTokens,
            ...(typeof request.topP === 'number' ? { top_p: request.topP } : {}),
            ...(typeof request.topK === 'number' ? { top_k: request.topK } : {})
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
        if (r.thinking) onChunk({ thinking: r.thinking })
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
          } catch {
            /* skip partial */
          }
        }
      }
    } catch (e) {
      if (e instanceof AppError) throw e
      throw classifyProviderError(e instanceof Error ? e.message : String(e), this.id)
    }
  }
}
