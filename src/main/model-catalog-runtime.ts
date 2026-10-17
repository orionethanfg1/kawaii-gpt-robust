import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { BUILTIN_MODEL_CATALOG, syncModelCatalog, type ModelCatalog } from '@core/models'

const CATALOG_URL = process.env.KAWAII_MODEL_CATALOG_URL ||
  'https://raw.githubusercontent.com/orionethanfg1/kawaii-gpt-robust/main/model-catalog.json'

function catalogPath(): string {
  return join(app.getPath('userData'), 'model-catalog.json')
}

export async function refreshModelCatalog(): Promise<{
  catalog: ModelCatalog
  source: 'remote' | 'cache' | 'builtin'
  updated: boolean
  error?: string
}> {
  const result = await syncModelCatalog({
    url: CATALOG_URL,
    fallback: BUILTIN_MODEL_CATALOG,
    storage: {
      load: async () => {
        try {
          return JSON.parse(await readFile(catalogPath(), 'utf8'))
        } catch {
          return null
        }
      },
      save: async (catalog) => {
        await mkdir(app.getPath('userData'), { recursive: true })
        await writeFile(catalogPath(), JSON.stringify(catalog, null, 2), 'utf8')
      }
    }
  })
  if (result.error) console.warn('[model-catalog]', result.error)
  return result
}
