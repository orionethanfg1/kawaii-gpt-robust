import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { backendFromResolved, createLocalBackend } from './local-backend'
import type { ResolvedLocalRuntime } from './resolve-local'

describe('LocalInferenceBackend', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('builds Ollama backend from resolved runtime', () => {
    const resolved: ResolvedLocalRuntime = {
      kind: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      label: 'Ollama'
    }
    const b = backendFromResolved(resolved)
    expect(b.kind).toBe('ollama')
    expect(b.baseUrl).toContain('11434')
    expect(b.asChatProvider().id).toBe('ollama')
  })

  it('builds OpenAI-compatible backend for LM Studio', () => {
    const resolved: ResolvedLocalRuntime = {
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1234/v1',
      label: 'LM Studio',
      defaultModel: 'qwen/qwen3.8-27b'
    }
    const b = backendFromResolved(resolved)
    expect(b.kind).toBe('openai-compatible')
    expect(b.baseUrl.endsWith('/v1')).toBe(true)
    expect(b.asChatProvider().id).toBe('local-openai')
  })

  it('createLocalBackend returns null when nothing responds', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as typeof fetch
    const r = await createLocalBackend({ preference: 'auto' })
    expect(r.backend).toBeNull()
    expect(r.status).toBeNull()
  })

  it('createLocalBackend prefers LM Studio when only :1234 is up', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('11434')) throw new Error('no ollama')
      if (u.includes('/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'qwen/qwen3.8-27b' }] })
        } as Response
      }
      throw new Error('unexpected ' + u)
    }) as typeof fetch

    const r = await createLocalBackend({
      preference: 'auto',
      preferredModel: 'qwen/qwen3.8-27b'
    })
    expect(r.backend).not.toBeNull()
    expect(r.backend?.kind).toBe('openai-compatible')
    expect(r.status?.healthy).toBe(true)
    expect(r.status?.defaultModel).toBe('qwen/qwen3.8-27b')
  })

  it('createLocalBackend uses Ollama when tags API is up', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('/api/tags')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'qwen2.5:7b' }] })
        } as Response
      }
      // LM Studio probes fail
      throw new Error('no lm')
    }) as typeof fetch

    const r = await createLocalBackend({ preference: 'auto' })
    expect(r.backend?.kind).toBe('ollama')
    expect(r.status?.models.some((m) => m.id === 'qwen2.5:7b')).toBe(true)
  })
})
