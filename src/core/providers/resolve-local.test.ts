import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveLocalRuntime } from './resolve-local'

describe('resolveLocalRuntime', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns null when both down', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('down')) as typeof fetch
    const r = await resolveLocalRuntime({ preference: 'auto' })
    expect(r).toBeNull()
  })

  it('picks openai-compatible for publisher/model ids', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('11434')) throw new Error('no')
      if (u.includes('/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'qwen/qwen3.8-27b' }] })
        } as Response
      }
      throw new Error(u)
    }) as typeof fetch

    const r = await resolveLocalRuntime({
      preference: 'auto',
      preferredModel: 'qwen/qwen3.8-27b'
    })
    expect(r?.kind).toBe('openai-compatible')
  })

  it('picks ollama for tag-style models when both up', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('/api/tags')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.2:3b' }] })
        } as Response
      }
      if (u.includes('/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'other-model' }] })
        } as Response
      }
      throw new Error(u)
    }) as typeof fetch

    const r = await resolveLocalRuntime({
      preference: 'auto',
      preferredModel: 'llama3.2:3b'
    })
    expect(r?.kind).toBe('ollama')
    expect(r?.alsoAvailable).toEqual(expect.arrayContaining(['ollama', 'openai-compatible']))
  })
})
