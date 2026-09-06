/**
 * OpenAI official Responses API (POST /v1/responses).
 * This is what platform.openai.com onboarding uses (gpt-5.6-luna, etc.).
 * Chat Completions remains as fallback inside the same provider.
 */

import {
  ChatProvider,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatCompletionChunk,
  ModelInfo,
  ProviderHealth
} from './types'
import { AppError, classifyProviderError } from '../errors'

export interface OpenAIResponsesOptions {
  id?: string
  displayName?: string
  /** Should be https://api.openai.com/v1 */
  baseUrl?: string
  apiKey: string
  timeoutMs?: number
}

function splitSystem(messages: ChatCompletionRequest['messages']): {
  instructions: string
  input: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
} {
  const systemParts: string[] = []
  const input: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content)
    } else {
      input.push({ role: m.role, content: m.content })
    }
  }
  return { instructions: systemParts.join('\n\n').trim(), input }
}

export class OpenAIResponsesProvider implements ChatProvider {
  readonly id: string
  readonly kind = 'openai-compatible' as const
  readonly displayName: string
  private baseUrl: string
  private apiKey: string
  private timeoutMs: number

  constructor(options: OpenAIResponsesOptions) {
    this.id = options.id ?? 'openai'
    this.displayName = options.displayName ?? 'OpenAI'
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.timeoutMs = options.timeoutMs ?? 120_000
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`
    }
  }

  private async fetchJson(
    path: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort)
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { ...this.headers(), ...(init.headers as Record<string, string>) }
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AppError({
          code: 'PROVIDER_TIMEOUT',
          message: `OpenAI timeout ${this.timeoutMs}ms`,
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
      const res = await this.fetchJson('/models', { method: 'GET' }, signal)
      if (!res.ok) {
        return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` }
      }
      return { ok: true, latencyMs: Date.now() - start }
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : String(e)
      }
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    try {
      const res = await this.fetchJson('/models', { method: 'GET' }, signal)
      if (!res.ok) return []
      const data = (await res.json()) as { data?: Array<{ id: string }> }
      return (data.data ?? [])
        .filter((m) => /gpt|o[1-9]|chatgpt/i.test(m.id))
        .slice(0, 40)
        .map((m) => ({ id: m.id, name: m.id, isLocal: false }))
    } catch {
      return [
        { id: 'gpt-5.6-luna', name: 'gpt-5.6-luna', isLocal: false },
        { id: 'gpt-5.6-terra', name: 'gpt-5.6-terra', isLocal: false },
        { id: 'gpt-4o-mini', name: 'gpt-4o-mini', isLocal: false }
      ]
    }
  }

  /** Primary path: Responses API (matches platform onboarding) */
  private async chatViaResponses(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResult> {
    const { instructions, input } = splitSystem(request.messages)
    const body: Record<string, unknown> = {
      model: request.model || 'gpt-5.6-luna',
      input: input.length === 1 && input[0].role === 'user' ? input[0].content : input,
      store: false
    }
    if (instructions) body.instructions = instructions
    if (request.maxTokens) body.max_output_tokens = request.maxTokens
    // temperature not supported on all reasoning models — omit when model looks like 5.x

    const res = await this.fetchJson(
      '/responses',
      { method: 'POST', body: JSON.stringify(body) },
      request.signal
    )
    const raw = await res.text()
    if (!res.ok) {
      throw classifyProviderError(raw || `HTTP ${res.status}`, this.id)
    }
    const data = JSON.parse(raw) as {
      output_text?: string
      model?: string
      output?: Array<{
        type?: string
        content?: Array<{ type?: string; text?: string }>
      }>
      usage?: {
        input_tokens?: number
        output_tokens?: number
        total_tokens?: number
      }
    }
    let content = (data.output_text || '').trim()
    if (!content && Array.isArray(data.output)) {
      const parts: string[] = []
      for (const item of data.output) {
        for (const c of item.content || []) {
          if (c.text) parts.push(c.text)
        }
      }
      content = parts.join('\n').trim()
    }
    return {
      content,
      model: data.model || request.model,
      usage: {
        promptTokens: data.usage?.input_tokens,
        completionTokens: data.usage?.output_tokens,
        totalTokens: data.usage?.total_tokens
      }
    }
  }

  /** Fallback: classic Chat Completions */
  private async chatViaCompletions(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResult> {
    const res = await this.fetchJson(
      '/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          model: request.model || 'gpt-5.6-luna',
          messages: request.messages,
          max_tokens: request.maxTokens,
          stream: false
        })
      },
      request.signal
    )
    const raw = await res.text()
    if (!res.ok) {
      throw classifyProviderError(raw || `HTTP ${res.status}`, this.id)
    }
    const data = JSON.parse(raw) as {
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

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    try {
      return await this.chatViaResponses(request)
    } catch (e1) {
      try {
        return await this.chatViaCompletions(request)
      } catch (e2) {
        throw e1 instanceof Error ? e1 : e2
      }
    }
  }

  async chatStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void
  ): Promise<ChatCompletionResult> {
    // Stream via Responses when possible; else one-shot and emit as stream
    try {
      const { instructions, input } = splitSystem(request.messages)
      const body: Record<string, unknown> = {
        model: request.model || 'gpt-5.6-luna',
        input: input.length === 1 && input[0].role === 'user' ? input[0].content : input,
        store: false,
        stream: true
      }
      if (instructions) body.instructions = instructions
      if (request.maxTokens) body.max_output_tokens = request.maxTokens

      const res = await this.fetchJson(
        '/responses',
        { method: 'POST', body: JSON.stringify(body) },
        request.signal
      )
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        throw classifyProviderError(text || `HTTP ${res.status}`, this.id)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let full = ''
      let model = request.model

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          const payload = t.slice(5).trim()
          if (payload === '[DONE]') continue
          try {
            const ev = JSON.parse(payload) as {
              type?: string
              delta?: string
              text?: string
              response?: { model?: string; output_text?: string }
            }
            const piece =
              (typeof ev.delta === 'string' && ev.delta) ||
              (ev.type?.includes('output_text.delta') && typeof (ev as { delta?: string }).delta === 'string'
                ? (ev as { delta?: string }).delta
                : '') ||
              ''
            // Common event shapes
            const deltaText =
              (ev as { delta?: string }).delta ||
              (ev as { text?: string }).text ||
              ''
            const out =
              deltaText ||
              (ev.type === 'response.output_text.delta'
                ? String((ev as { delta?: string }).delta || '')
                : '')
            if (out) {
              full += out
              onChunk({ content: out, done: false, model })
            }
            if (ev.response?.model) model = ev.response.model
          } catch {
            /* ignore partial JSON */
          }
        }
      }

      if (!full) {
        // stream returned nothing useful — non-stream fallback
        const result = await this.chat({ ...request, stream: false })
        if (result.content) {
          onChunk({ content: result.content, done: false, model: result.model })
        }
        onChunk({ content: '', done: true, model: result.model })
        return result
      }
      onChunk({ content: '', done: true, model })
      return { content: full, model }
    } catch {
      const result = await this.chat({ ...request, stream: false })
      if (result.content) {
        onChunk({ content: result.content, done: false, model: result.model })
      }
      onChunk({ content: '', done: true, model: result.model })
      return result
    }
  }
}

/** Use Responses provider for official OpenAI; Completions for other OpenAI-compatible hosts */
export function isOfficialOpenAI(baseUrl: string, providerId?: string): boolean {
  const u = (baseUrl || '').toLowerCase()
  const id = (providerId || '').toLowerCase()
  return id === 'openai' || u.includes('api.openai.com')
}
