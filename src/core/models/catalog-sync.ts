import { ModelCatalogSchema, type ModelCatalog } from './registry'

export interface CatalogStorage {
  load: () => Promise<unknown | null>
  save: (catalog: ModelCatalog) => Promise<void>
}

export interface CatalogSyncResult {
  catalog: ModelCatalog
  source: 'remote' | 'cache' | 'builtin'
  updated: boolean
  error?: string
}

export async function syncModelCatalog(options: {
  url?: string
  storage: CatalogStorage
  fallback: ModelCatalog
  timeoutMs?: number
  fetcher?: typeof fetch
  verify?: (payload: unknown) => boolean | Promise<boolean>
}): Promise<CatalogSyncResult> {
  const cached = await options.storage.load().catch(() => null)
  const cachedResult = ModelCatalogSchema.safeParse(cached)
  const fallback = cachedResult.success ? cachedResult.data : options.fallback
  if (!options.url) return { catalog: fallback, source: cachedResult.success ? 'cache' : 'builtin', updated: false }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4000)
  try {
    const fetcher = options.fetcher ?? fetch
    const response = await fetcher(options.url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`)
    const payload = await response.json()
    if (options.verify && !(await options.verify(payload))) throw new Error('Catalog signature invalid')
    const parsed = ModelCatalogSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Catalog schema invalid')
    await options.storage.save(parsed.data)
    return { catalog: parsed.data, source: 'remote', updated: true }
  } catch (error) {
    return {
      catalog: fallback,
      source: cachedResult.success ? 'cache' : 'builtin',
      updated: false,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    clearTimeout(timer)
  }
}
