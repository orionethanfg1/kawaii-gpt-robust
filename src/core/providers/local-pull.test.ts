import { describe, it, expect, vi, afterEach } from 'vitest'
import { unifiedPullModel } from './local-pull'

describe('unifiedPullModel', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns error when model empty', async () => {
    const r = await unifiedPullModel({ model: '' })
    expect(r.ok).toBe(false)
    expect(r.acquired).toBe(false)
  })

  it('reports already installed via LM Studio list', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('11434')) throw new Error('no ollama')
      if (u.includes('/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'qwen/qwen3.8-27b' }] })
        } as Response
      }
      throw new Error(u)
    }) as typeof fetch

    const r = await unifiedPullModel({
      model: 'qwen/qwen3.8-27b',
      bridges: {}
    })
    expect(r.acquired).toBe(true)
    expect(r.activeModel).toBe('qwen/qwen3.8-27b')
    expect(r.attempts.some((a) => a.action === 'already-installed')).toBe(true)
  })

  it('falls back through Ollama pull then LM guidance', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url)
      // No models installed on either
      if (u.includes('/api/tags')) {
        return { ok: true, json: async () => ({ models: [] }) } as Response
      }
      if (u.includes('/models')) {
        return { ok: true, json: async () => ({ data: [] }) } as Response
      }
      throw new Error(u)
    }) as typeof fetch

    const ollamaPull = vi.fn().mockResolvedValue({ ok: false, error: 'pull failed' })
    const openExternal = vi.fn().mockResolvedValue(undefined)

    const r = await unifiedPullModel({
      model: 'llama3.2:3b',
      bridges: {
        ollamaStatus: async () => ({ reachable: true }),
        ollamaPull,
        openExternal
      }
    })
    expect(ollamaPull).toHaveBeenCalled()
    expect(r.attempts.some((a) => a.channel === 'ollama')).toBe(true)
    // After ollama fail, may still open library
    expect(r.ok === false || r.openUrl).toBeTruthy()
  })

  it('starts Ollama then pulls when status was down', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('/api/tags')) {
        return { ok: true, json: async () => ({ models: [] }) } as Response
      }
      throw new Error('skip')
    }) as typeof fetch

    const ollamaStart = vi.fn().mockResolvedValue({ ok: true, message: 'started' })
    const ollamaPull = vi.fn().mockResolvedValue({ ok: true })

    const r = await unifiedPullModel({
      model: 'qwen2.5:3b',
      tryStartOllama: true,
      bridges: {
        ollamaStatus: async () => ({ reachable: false }),
        ollamaStart,
        ollamaPull
      }
    })
    expect(ollamaStart).toHaveBeenCalled()
    expect(ollamaPull).toHaveBeenCalledWith('qwen2.5:3b', expect.any(String))
    expect(r.acquired).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('normalizes publisher/name to hf.co for ollama pull', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline list')) as typeof fetch
    const ollamaPull = vi.fn().mockResolvedValue({ ok: true })
    await unifiedPullModel({
      model: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
      bridges: {
        ollamaStatus: async () => ({ reachable: true }),
        ollamaPull
      }
    })
    expect(ollamaPull).toHaveBeenCalledWith(
      'hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF',
      expect.any(String)
    )
  })
})
