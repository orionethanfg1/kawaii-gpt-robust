import { describe, it, expect, vi, afterEach } from 'vitest'
import { unloadLocalModelsForForge, listOllamaLoaded } from './unload-local'

describe('unload-local', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns empty when no models loaded', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] })
    }) as typeof fetch
    const r = await unloadLocalModelsForForge()
    expect(r.unloaded).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('unloads large resident models with keep_alive 0', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/ps')) {
        return {
          ok: true,
          json: async () => ({
            models: [
              { name: 'qwen2.5:7b', size_vram: 5 * 1024 ** 3 },
              { name: 'qwen/qwen3.8-27b', size_vram: 17 * 1024 ** 3 }
            ]
          })
        } as Response
      }
      if (u.includes('/api/generate') && init?.method === 'POST') {
        return { ok: true, text: async () => '{"done_reason":"unload"}' } as Response
      }
      throw new Error(u)
    }) as typeof fetch

    const r = await unloadLocalModelsForForge({ minSizeGB: 6, unloadAll: false })
    expect(r.unloaded).toContain('qwen/qwen3.8-27b')
    // 7B ~5GB may skip depending on isLargeLocalModel + minSize
    expect(r.freedEstimateGB).toBeGreaterThan(0)
  })

  it('listOllamaLoaded maps names', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2:3b' }] })
    }) as typeof fetch
    const list = await listOllamaLoaded()
    expect(list[0].name).toBe('llama3.2:3b')
  })
})
