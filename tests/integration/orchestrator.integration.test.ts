/**
 * Integration tests for sendChatMessage:
 * failover local↔cloud, cloud rotation, context overflow retry, model summary.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  sendChatMessage,
  type RouteInfo
} from '../../src/renderer/src/features/chat/services/chatOrchestrator'
import type {
  ChatProvider,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatCompletionChunk,
  ModelInfo,
  ProviderHealth
} from '../../src/core/providers/types'
import { AppError } from '../../src/core/errors'
import { globalCircuitBreaker } from '../../src/core/resilience'
import { DEFAULT_SETTINGS, type Settings } from '../../src/renderer/src/shared/types/settings'
import type { CloudEndpointWithKey } from '../../src/core/models/cloud-rotation'

function baseSettings(patch: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    providerMode: 'smart',
    localModel: 'local-test',
    cloudModel: 'cloud-test',
    cloudBaseUrl: 'https://openrouter.ai/api/v1',
    cloudSlots: [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'cloud-a',
        enabled: true,
        priority: 0
      },
      {
        id: 'groq',
        name: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'cloud-b',
        enabled: true,
        priority: 1
      }
    ],
    cloudAutoRotate: true,
    character: {
      name: 'TestBot',
      tagline: 'test',
      personality: 'Eres un bot de prueba.',
      style: 'corto',
      visualEmoji: '🧪',
      traits: ['test']
    },
    ...patch
  }
}

type ChatHandler = (
  req: ChatCompletionRequest
) => Promise<ChatCompletionResult> | ChatCompletionResult

function mockProvider(opts: {
  id: string
  displayName?: string
  healthy?: boolean
  chat?: ChatHandler
  streamTokens?: string[]
}): ChatProvider {
  const chatImpl: ChatHandler =
    opts.chat ??
    (async () => ({
      content: `reply-from-${opts.id}`,
      model: opts.id
    }))

  return {
    id: opts.id,
    kind: 'openai-compatible',
    displayName: opts.displayName ?? opts.id,
    healthCheck: async (): Promise<ProviderHealth> => ({
      ok: opts.healthy !== false,
      latencyMs: 1
    }),
    listModels: async (): Promise<ModelInfo[]> => [],
    chat: async (req) => chatImpl(req),
    chatStream: async (req, onChunk) => {
      const result = await chatImpl(req)
      const tokens = opts.streamTokens ?? (result.content ? [result.content] : [])
      for (const t of tokens) {
        onChunk({ content: t, done: false, model: result.model })
      }
      onChunk({ content: '', done: true, model: result.model })
      return result
    }
  }
}

function endpoint(
  id: string,
  model: string,
  priority = 0
): CloudEndpointWithKey {
  return {
    id,
    name: id,
    baseUrl: `https://example.test/${id}`,
    model,
    enabled: true,
    priority,
    apiKey: 'k'.repeat(20)
  }
}

async function runChat(opts: {
  settings?: Settings
  history?: { role: 'user' | 'assistant'; content: string }[]
  userContent?: string
  deps: NonNullable<Parameters<typeof sendChatMessage>[0]['deps']>
  previousSummary?: string
  summaryCoveredCount?: number
}) {
  const tokens: string[] = []
  const routes: RouteInfo[] = []
  const summaries: Array<{ source: string; summary: string }> = []
  const phases: string[] = []
  let done: { model: string; provider: string } | null = null
  let error: AppError | null = null

  await sendChatMessage({
    settings: opts.settings ?? baseSettings(),
    userContent: opts.userContent ?? 'Hola',
    history: opts.history ?? [],
    previousSummary: opts.previousSummary,
    summaryCoveredCount: opts.summaryCoveredCount ?? 0,
    providerKeys: { openrouter: 'x'.repeat(20), groq: 'y'.repeat(20) },
    deps: opts.deps,
    callbacks: {
      onToken: (t) => tokens.push(t),
      onRoute: (r) => routes.push(r),
      onSummary: (s) => summaries.push({ source: s.source, summary: s.summary }),
      onPhase: (p) => phases.push(p),
      onDone: (m) => {
        done = { model: m.model, provider: m.provider }
      },
      onError: (e) => {
        error = e
      }
    }
  })

  return { tokens, routes, summaries, phases, done, error }
}

beforeEach(() => {
  globalCircuitBreaker.reset()
})

describe('orchestrator integration', () => {
  it('uses local for short prompts when available', async () => {
    const local = mockProvider({
      id: 'ollama',
      streamTokens: ['hola-', 'local']
    })
    const cloudA = mockProvider({ id: 'openrouter' })

    const result = await runChat({
      deps: {
        local,
        availability: { localAvailable: true, cloudAvailable: true },
        cloudProviders: [
          { endpoint: endpoint('openrouter', 'cloud-a', 0), provider: cloudA }
        ]
      }
    })

    expect(result.error).toBeNull()
    expect(result.done?.provider).toBe('ollama')
    expect(result.tokens.join('')).toContain('hola-')
    expect(result.routes[0]?.target).toBe('local')
  })

  it('fails over to cloud when local throws', async () => {
    const local = mockProvider({
      id: 'ollama',
      chat: async () => {
        throw new AppError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'local down',
          provider: 'ollama',
          retryable: true
        })
      }
    })
    const cloudA = mockProvider({
      id: 'openrouter',
      streamTokens: ['from-cloud']
    })

    const result = await runChat({
      deps: {
        local,
        availability: { localAvailable: true, cloudAvailable: true },
        cloudProviders: [
          { endpoint: endpoint('openrouter', 'cloud-a', 0), provider: cloudA }
        ]
      }
    })

    expect(result.error).toBeNull()
    expect(result.done?.provider).toBe('openrouter')
    expect(result.tokens.join('')).toBe('from-cloud')
    expect(result.routes.some((r) => r.failover)).toBe(true)
  })

  it('rotates to next cloud provider on rate limit', async () => {
    const local = mockProvider({
      id: 'ollama',
      healthy: false
    })
    let callsA = 0
    const cloudA = mockProvider({
      id: 'openrouter',
      chat: async () => {
        callsA++
        throw new AppError({
          code: 'PROVIDER_RATE_LIMIT',
          message: '429',
          provider: 'openrouter',
          retryable: true
        })
      }
    })
    const cloudB = mockProvider({
      id: 'groq',
      streamTokens: ['groq-ok']
    })

    const result = await runChat({
      settings: baseSettings({ providerMode: 'cloud' }),
      deps: {
        local,
        availability: { localAvailable: false, cloudAvailable: true },
        cloudProviders: [
          { endpoint: endpoint('openrouter', 'cloud-a', 0), provider: cloudA },
          { endpoint: endpoint('groq', 'cloud-b', 1), provider: cloudB }
        ]
      }
    })

    expect(result.error).toBeNull()
    expect(callsA).toBeGreaterThanOrEqual(1)
    expect(result.done?.provider).toBe('groq')
    expect(result.tokens.join('')).toBe('groq-ok')
    expect(result.routes.some((r) => r.model === 'cloud-b')).toBe(true)
  })

  it('retries with smaller context on CONTEXT_OVERFLOW', async () => {
    let attempts = 0
    const local = mockProvider({
      id: 'ollama',
      chat: async (req) => {
        attempts++
        if (attempts === 1) {
          throw new AppError({
            code: 'CONTEXT_OVERFLOW',
            message: 'context length exceeded',
            provider: 'ollama',
            retryable: true
          })
        }
        return {
          content: `ok-after-shrink:${req.messages.length}`,
          model: 'local-test'
        }
      }
    })

    const result = await runChat({
      settings: baseSettings({ providerMode: 'local' }),
      history: Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `turn-${i} ` + 'x'.repeat(100)
      })),
      deps: {
        local,
        availability: { localAvailable: true, cloudAvailable: false },
        cloudProviders: []
      }
    })

    expect(result.error).toBeNull()
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(result.tokens.join('')).toContain('ok-after-shrink')
    expect(result.routes.some((r) => r.reason.includes('contexto reducido'))).toBe(
      true
    )
  })

  it('produces model summary for long history and injects it', async () => {
    let sawSummarySystem = false
    const local = mockProvider({
      id: 'ollama',
      chat: async (req) => {
        // Summarizer call: system prompt about compression
        const sys = req.messages.find((m) => m.role === 'system')
        if (sys?.content.includes('compresor de contexto')) {
          return {
            content: 'RESUMEN_MODELO: el usuario estudia TypeScript.',
            model: 'local-test'
          }
        }
        // Actual chat
        const summaryMsg = req.messages.find((m) =>
          m.content.includes('RESUMEN_MODELO')
        )
        if (summaryMsg) sawSummarySystem = true
        return { content: 'respuesta-final', model: 'local-test' }
      }
    })

    const history = Array.from({ length: 16 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `mensaje largo número ${i} sobre TypeScript y módulos`
    }))

    const result = await runChat({
      settings: baseSettings({ providerMode: 'local' }),
      history,
      summaryCoveredCount: 0,
      deps: {
        local,
        availability: { localAvailable: true, cloudAvailable: false },
        cloudProviders: []
      }
    })

    expect(result.error).toBeNull()
    expect(result.phases).toContain('summarizing')
    expect(result.summaries.length).toBeGreaterThanOrEqual(1)
    expect(result.summaries[0]?.source).toBe('model')
    expect(result.summaries[0]?.summary).toContain('TypeScript')
    expect(sawSummarySystem).toBe(true)
    expect(result.tokens.join('')).toBe('respuesta-final')
  })

  it('falls back to local when all cloud providers fail', async () => {
    const local = mockProvider({
      id: 'ollama',
      streamTokens: ['local-rescue']
    })
    const fail = async () => {
      throw new AppError({
        code: 'PROVIDER_QUOTA',
        message: 'out of credits',
        retryable: true
      })
    }
    const cloudA = mockProvider({ id: 'openrouter', chat: fail })
    const cloudB = mockProvider({ id: 'groq', chat: fail })

    const result = await runChat({
      settings: baseSettings({ providerMode: 'cloud' }),
      userContent: 'ayuda',
      deps: {
        local,
        availability: { localAvailable: true, cloudAvailable: true },
        cloudProviders: [
          { endpoint: endpoint('openrouter', 'a', 0), provider: cloudA },
          { endpoint: endpoint('groq', 'b', 1), provider: cloudB }
        ]
      }
    })

    expect(result.error).toBeNull()
    expect(result.done?.provider).toBe('ollama')
    expect(result.tokens.join('')).toBe('local-rescue')
  })
})
