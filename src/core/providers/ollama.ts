import {
  ChatProvider,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatCompletionChunk,
  ModelInfo,
  ProviderHealth
} from './types'
import { AppError, classifyProviderError } from '../errors'

export interface OllamaProviderOptions {
  baseUrl?: string
  timeoutMs?: number
}

export class OllamaProvider implements ChatProvider {
  readonly id = 'ollama'
  readonly kind = 'ollama' as const
  readonly displayName = 'Ollama (Local)'

  private baseUrl: string
  private timeoutMs: number

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? 120_000
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
          'Content-Type': 'application/json',
          ...(init.headers ?? {})
        }
      })
      return res
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AppError({
          code: 'PROVIDER_TIMEOUT',
          message: `Ollama request timed out after ${this.timeoutMs}ms`,
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
      const res = await this.fetchWithTimeout('/api/tags', { method: 'GET' }, signal)
      if (!res.ok) {
        return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` }
      }
      const data = (await res.json()) as { models?: unknown[] }
      return {
        ok: true,
        latencyMs: Date.now() - start,
        modelsCount: data.models?.length ?? 0
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
    const res = await this.fetchWithTimeout('/api/tags', { method: 'GET' }, signal)
    if (!res.ok) {
      throw classifyProviderError(`Failed to list models: HTTP ${res.status}`, this.id)
    }
    const data = (await res.json()) as {
      models?: Array<{
        name: string
        size?: number
        details?: { family?: string; parameter_size?: string; quantization_level?: string }
      }>
    }

    return (data.models ?? []).map((m) => ({
      id: m.name,
      name: m.name,
      sizeBytes: m.size,
      family: m.details?.family,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
      isLocal: true
    }))
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const res = await this.fetchWithTimeout(
      '/api/chat',
      {
        method: 'POST',
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: false,
          options: {
            temperature: request.temperature,
            num_predict: request.maxTokens
          }
        })
      },
      request.signal
    )

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw classifyProviderError(text || `HTTP ${res.status}`, this.id)
    }

    const data = (await res.json()) as {
      message?: { content?: string }
      model?: string
      eval_count?: number
      prompt_eval_count?: number
    }

    return {
      content: data.message?.content ?? '',
      model: data.model ?? request.model,
      usage: {
        promptTokens: data.prompt_eval_count,
        completionTokens: data.eval_count,
        totalTokens:
          (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0) || undefined
      }
    }
  }

  async chatStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void
  ): Promise<ChatCompletionResult> {
    const res = await this.fetchWithTimeout(
      '/api/chat',
      {
        method: 'POST',
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: true,
          options: {
            temperature: request.temperature,
            num_predict: request.maxTokens
          }
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
        message: 'Ollama returned empty body for stream',
        provider: this.id,
        retryable: true
      })
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(String.fromCharCode(10))
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const parsed = JSON.parse(trimmed) as {
              message?: { content?: string }
              done?: boolean
              model?: string
            }
            const piece = parsed.message?.content ?? ''
            if (piece) {
              fullContent += piece
              onChunk({ content: piece, done: false, model: parsed.model })
            }
            if (parsed.done) {
              onChunk({ content: '', done: true, model: parsed.model })
            }
          } catch {
            // ignore malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return {
      content: fullContent,
      model: request.model
    }
  }
}
