import { describe, expect, it } from 'vitest'
import { BUILTIN_MODEL_CATALOG } from './registry'
import { syncModelCatalog } from './catalog-sync'

describe('syncModelCatalog', () => {
  it('updates from a valid remote catalog', async () => {
    let saved = false
    const result = await syncModelCatalog({
      url: 'https://example.test/catalog.json',
      fallback: BUILTIN_MODEL_CATALOG,
      storage: { load: async () => null, save: async () => { saved = true } },
      fetcher: async () => new Response(JSON.stringify({ ...BUILTIN_MODEL_CATALOG, catalogVersion: 'next' }))
    })
    expect(result.source).toBe('remote')
    expect(result.catalog.catalogVersion).toBe('next')
    expect(saved).toBe(true)
  })

  it('falls back to cache when remote update fails', async () => {
    const result = await syncModelCatalog({
      url: 'https://example.test/catalog.json',
      fallback: BUILTIN_MODEL_CATALOG,
      storage: { load: async () => BUILTIN_MODEL_CATALOG, save: async () => undefined },
      fetcher: async () => { throw new Error('offline') }
    })
    expect(result.source).toBe('cache')
    expect(result.error).toContain('offline')
  })
})
