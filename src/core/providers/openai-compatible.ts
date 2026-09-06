import {
  ChatProvider,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatCompletionChunk,
  ModelInfo,
  ProviderHealth
} from './types'
import { AppError, classifyProviderError } from '../errors'

export interface OpenAICompatibleOptions {
  id?: string
  displayName?: string
  baseUrl: string
  apiKey?: string
  timeoutMs?: number
}

export class OpenAICompatibleProvider implements ChatProvider {
  readonly id: string
  readonly kind = 'openai-compatible' as const
  readonly displayName: string

  private baseUrl: string
  private apiKey?: string
  private timeoutMs: number

  constructor(options: OpenAICompatibleOptions) {
    this.id = options.id ?? 'openai-compatible'
    this.displayName = options.displayName ?? 'OpenAI Compatible'
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.timeoutMs = options.timeoutMs ?? 90_000
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (this.apiKey) {
      h['Authorization'] = `Bearer ${this.apiKey}`
    }
    return h
  }

  private async fetchWithTimeout(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort)

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...this.headers(),
          ...(init.headers ?? {})
        }
      })
      return res
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AppError({
          code: 'PROVIDER_TIMEOUT',
          message: `Request timed out after ${this.timeoutMs}ms`,
          provider: this.id,
          retryable: true
        })
      }
      throw classifyProviderError(String(err), this.id)
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async healthCheck(signal?: AbortSignal): Promise<ProviderHealth> {
    const start = Date.now()
    try {
      const res = await this.fetchWithTimeout('/models', { method: 'GET' }, signal)
      if (!res.ok) {
        return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` }
      }
      const data = (await res.json()) as { data?: unknown[] }
      return {
        ok: true,
        latencyMs: Date.now() - start,
        modelsCount: Array.isArray(data.data) ? data.data.length : 0
      }
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await this.fetchWithTimeout('/models', { method: 'GET' }, signal)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw classifyProviderError(text || `HTTP ${res.status}`, this.id)
    }
    const data = (await res.json()) as {
      data?: Array<{ id: string; owned_by?: string }>
    }

    const localHint = /127\.0\.0\.1|localhost/i.test(this.baseUrl)
    return (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      family: m.owned_by,
      isLocal: localHint || this.id === 'local-openai'
    }))
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const res = await this.fetchWithTimeout(
      '/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: false
        })
      },
      request.signal
    )

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw classifyProviderError(text || `HTTP ${res.status}`, this.id)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
      model?: string
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
      }
    }

    const choice = data.choices?.[0]
    return {
      content: choice?.message?.content ?? '',
      model: data.model ?? request.model,
      finishReason: choice?.finish_reason,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens
      }
    }
  }

  async chatStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void
  ): Promise<ChatCompletionResult> {
    const res = await this.fetchWithTimeout(
      '/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: true
        })
      },
      request.signal
    )

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw classifyProviderError(text || `HTTP ${res.status}`, this.id)
    }

    if (!res.body) {
      throw new AppError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Empty stream body',
        provider: this.id,
        retryable: true
      })
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let buffer = ''
    let model = request.model

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(String.fromCharCode(10))
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') {
            if (trimmed === 'data: [DONE]') {
              onChunk({ content: '', done: true, model })
            }
            continue
          }
          if (!trimmed.startsWith('data: ')) continue

          try {
            const parsed = JSON.parse(trimmed.slice(6)) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
              model?: string
            }
            if (parsed.model) model = parsed.model
            const piece = parsed.choices?.[0]?.delta?.content ?? ''
            if (piece) {
              fullContent += piece
              onChunk({ content: piece, done: false, model })
            }
            if (parsed.choices?.[0]?.finish_reason) {
              onChunk({ content: '', done: true, model })
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return {
      content: fullContent,
      model
    }
  }
}
