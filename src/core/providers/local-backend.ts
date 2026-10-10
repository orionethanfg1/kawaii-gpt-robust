import { localHttp } from './local-http'
import { discoverLmStudioServer } from './lmstudio-ports'
/**
 * LocalInferenceBackend — runtime-agnostic local chat/list surface.
 * Ollama and LM Studio (OpenAI-compatible) are adapters; the app depends on this interface.
 */

import type { ChatProvider, ChatRequest, ChatResult, ChatChunk, HealthResult } from './types'
import { OllamaProvider } from './ollama'
import { OpenAICompatibleProvider } from './openai-compatible'
import {
  resolveLocalRuntime,
  type LocalRuntimeKind,
  type ResolvedLocalRuntime
} from './resolve-local'

export type LocalBackendKind = LocalRuntimeKind

export type LocalModelInfo = {
  id: string
  name: string
  source: LocalBackendKind | 'unknown'
}

export type LocalBackendStatus = {
  kind: LocalBackendKind
  baseUrl: string
  label: string
  healthy: boolean
  defaultModel?: string
  models: LocalModelInfo[]
  alsoAvailable?: LocalBackendKind[]
}

/**
 * Unified local inference backend.
 * Implementations must not require the caller to know Ollama vs LM Studio.
 */
export interface LocalInferenceBackend {
  readonly kind: LocalBackendKind
  readonly label: string
  readonly baseUrl: string
  asChatProvider(): ChatProvider
  healthCheck(): Promise<HealthResult>
  listModels(): Promise<LocalModelInfo[]>
  chat(request: ChatRequest): Promise<ChatResult>
  chatStream(request: ChatRequest, onChunk: (c: ChatChunk) => void): Promise<void>
}

class OllamaBackend implements LocalInferenceBackend {
  readonly kind = 'ollama' as const
  readonly label: string
  readonly baseUrl: string
  private provider: OllamaProvider

  constructor(baseUrl: string, label = 'Ollama') {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.label = label
    this.provider = new OllamaProvider({ baseUrl: this.baseUrl })
  }

  asChatProvider(): ChatProvider {
    return this.provider
  }

  healthCheck(): Promise<HealthResult> {
    return this.provider.healthCheck()
  }

  async listModels(): Promise<LocalModelInfo[]> {
    try {
      const res = await localHttp(`${this.baseUrl}/api/tags`, { timeoutMs: 4_000 })
      if (!res.ok) return []
      const json = (await res.json()) as { models?: Array<{ name?: string; model?: string }> }
      return (json.models || [])
        .map((m) => {
          const id = m.name || m.model || ''
          if (!id) return null
          return { id, name: id, source: 'ollama' as const }
        })
        .filter(Boolean) as LocalModelInfo[]
    } catch {
      return []
    }
  }

  chat(request: ChatRequest): Promise<ChatResult> {
    return this.provider.chat(request)
  }

  chatStream(request: ChatRequest, onChunk: (c: ChatChunk) => void): Promise<void> {
    return this.provider.chatStream(request, onChunk)
  }
}

class OpenAICompatBackend implements LocalInferenceBackend {
  readonly kind = 'openai-compatible' as const
  readonly label: string
  readonly baseUrl: string
  private provider: OpenAICompatibleProvider
  private root: string

  constructor(baseUrl: string, label = 'LM Studio / local OpenAI') {
    const cleaned = baseUrl.replace(/\/+$/, '')
    this.baseUrl = cleaned.endsWith('/v1') ? cleaned : `${cleaned}/v1`
    this.root = this.baseUrl.replace(/\/v1$/, '')
    this.label = label
    this.provider = new OpenAICompatibleProvider({
      id: 'local-openai',
      displayName: label,
      baseUrl: this.baseUrl,
      apiKey: 'lm-studio',
      timeoutMs: 300_000 // JIT load of 14B+ can take minutes
    })
  }

  asChatProvider(): ChatProvider {
    return this.provider
  }

  healthCheck(): Promise<HealthResult> {
    return this.provider.healthCheck()
  }

  async listModels(): Promise<LocalModelInfo[]> {
    const out: LocalModelInfo[] = []
    const seen = new Set<string>()
    const add = (id: string) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      out.push({ id, name: id, source: 'openai-compatible' })
    }
    const pull = (json: unknown) => {
      if (!json || typeof json !== 'object') return
      const j = json as {
        data?: Array<{ id?: string }>
        models?: Array<{ key?: string; id?: string }>
      }
      for (const m of j.data || []) if (m.id) add(m.id)
      for (const m of j.models || []) if (m.key || m.id) add(m.key || m.id || '')
    }
    for (const url of [
      `${this.baseUrl}/models`,
      `${this.root}/api/v1/models`,
      `${this.root}/api/v0/models`
    ]) {
      try {
        const res = await localHttp(url, {
          timeoutMs: 3_500,
          headers: { Authorization: 'Bearer lm-studio' }
        })
        if (res.ok) pull(await res.json())
      } catch {
        try {
          const res2 = await localHttp(url, { timeoutMs: 3_500 })
          if (res2.ok) pull(await res2.json())
        } catch {
          /* next */
        }
      }
    }
    return out
  }

  chat(request: ChatRequest): Promise<ChatResult> {
    return this.provider.chat(request)
  }

  chatStream(request: ChatRequest, onChunk: (c: ChatChunk) => void): Promise<void> {
    return this.provider.chatStream(request, onChunk)
  }
}

export function backendFromResolved(resolved: ResolvedLocalRuntime): LocalInferenceBackend {
  if (resolved.kind === 'openai-compatible') {
    return new OpenAICompatBackend(resolved.baseUrl, resolved.label)
  }
  return new OllamaBackend(resolved.baseUrl, resolved.label)
}

/**
 * Resolve and construct the best local backend (Ollama and/or LM Studio).
 */
export async function createLocalBackend(opts: {
  preference?: 'auto' | 'ollama' | 'openai-compatible'
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
  preferredModel?: string
  preferredPinned?: boolean
}): Promise<{
  backend: LocalInferenceBackend | null
  resolved: ResolvedLocalRuntime | null
  status: LocalBackendStatus | null
  placementNote?: string
  resolvedModelId?: string
}> {
  // Always catalog-aware placement: intelligent pick first; settings = soft failover
  {
    try {
      const { resolveLocalModelPlacement, placementToResolved } = await import(
        './resolve-local-model'
      )
      const place = await resolveLocalModelPlacement({
        preferredModel: opts.preferredModel,
        preferredPinned: opts.preferredPinned,
        ollamaBaseUrl: opts.ollamaBaseUrl,
        openAIBaseUrl: opts.openAIBaseUrl,
        preference: opts.preference
      })
      if (place) {
        const resolved = placementToResolved(place)
        const backend = backendFromResolved(resolved)
        const health = await backend.healthCheck().catch(() => ({ ok: false as const }))
        const models = health.ok ? await backend.listModels().catch(() => []) : []
        const status: LocalBackendStatus = {
          kind: backend.kind,
          baseUrl: backend.baseUrl,
          label: backend.label,
          healthy: Boolean(health.ok),
          defaultModel: place.modelId,
          models,
          alsoAvailable: resolved.alsoAvailable
        }
        return {
          backend,
          resolved,
          status,
          placementNote: place.note,
          resolvedModelId: place.modelId
        }
      }
    } catch {
      /* fall through */
    }
  }

  // Pinned model could not be placed (e.g. LM Studio server off) — do not steal Ollama
  if (opts.preferredPinned && (opts.preferredModel || '').trim()) {
    return {
      backend: null,
      resolved: null,
      status: null,
      placementNote:
        `Modelo fijado «${(opts.preferredModel || '').trim()}» no disponible. ` +
        `Si es de LM Studio: activa Developer → Start Server. Si es Ollama: ollama pull <tag>.`,
      resolvedModelId: undefined
    }
  }

  const resolved = await resolveLocalRuntime({
    preference: opts.preference || 'auto',
    ollamaBaseUrl: opts.ollamaBaseUrl,
    openAIBaseUrl: opts.openAIBaseUrl,
    preferredModel: opts.preferredModel
  })
  if (!resolved) {
    return { backend: null, resolved: null, status: null }
  }
  const backend = backendFromResolved(resolved)
  const health = await backend.healthCheck().catch(() => ({ ok: false as const }))
  const models = health.ok ? await backend.listModels().catch(() => []) : []
  const status: LocalBackendStatus = {
    kind: backend.kind,
    baseUrl: backend.baseUrl,
    label: backend.label,
    healthy: Boolean(health.ok),
    defaultModel: resolved.defaultModel || models[0]?.id,
    models,
    alsoAvailable: resolved.alsoAvailable
  }
  return { backend, resolved, status }
}

/** Probe both runtimes without selecting one (for status UIs). */
export async function probeLocalBackends(opts: {
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
}): Promise<{
  ollama: LocalBackendStatus | null
  openAI: LocalBackendStatus | null
}> {
  const ollamaUrl = (opts.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')
  const ollama = new OllamaBackend(ollamaUrl)
  const ollamaHealth = await ollama.healthCheck().catch(() => ({ ok: false }))
  let ollamaStatus: LocalBackendStatus | null = null
  if (ollamaHealth.ok) {
    const models = await ollama.listModels().catch(() => [])
    ollamaStatus = {
      kind: 'ollama',
      baseUrl: ollama.baseUrl,
      label: ollama.label,
      healthy: true,
      defaultModel: models[0]?.id,
      models
    }
  }

  let openAI: LocalBackendStatus | null = null
  const lmProbe = await discoverLmStudioServer({
    preferredBaseUrl: opts.openAIBaseUrl,
    timeoutMs: 2_000,
    force: true
  })
  if (lmProbe.ok && lmProbe.baseUrl) {
    const lm = new OpenAICompatBackend(lmProbe.baseUrl.replace(/\/+$/, ''))
    const models = await lm.listModels().catch(() => [])
    openAI = {
      kind: 'openai-compatible',
      baseUrl: lm.baseUrl,
      label: lm.label,
      healthy: true,
      defaultModel: models[0]?.id || lmProbe.modelsSample?.[0],
      models
    }
  }

  return { ollama: ollamaStatus, openAI }
}
