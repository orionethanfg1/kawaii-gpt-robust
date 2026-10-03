/**
 * Local model catalog / scores IPC.
 */
import { ipcMain } from 'electron'

export function registerCatalogIpc(): void {
  ipcMain.handle('catalog:scanLocalModels', async (_e, force?: boolean) => {
    try {
      const { scanAndScoreLocalModels } = await import('../local-model-catalog')
      return await scanAndScoreLocalModels({ force: Boolean(force) })
    } catch (e) {
      return {
        ok: false,
        count: 0,
        fromCache: false,
        rows: [],
        error: e instanceof Error ? e.message : String(e)
      }
    }
  })
  ipcMain.handle('catalog:listModelScores', async () => {
    try {
      const { dbGetModelScores, dbGetLastModelScanAt, dbFilePath } = await import('../local-app-db')
      const rows = await dbGetModelScores()
      const last = await dbGetLastModelScanAt()
      return { ok: true, rows, lastScanAt: last, dbPath: dbFilePath() }
    } catch (e) {
      return { ok: false, rows: [], error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('catalog:pickModel', async (_e, task?: string) => {
    try {
      const { pickFromCatalog } = await import('../local-model-catalog')
      const t = (task || 'chat') as 'chat' | 'reason' | 'fast' | 'vision' | 'code'
      return await pickFromCatalog(t)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(
    'models:unloadLocal',
    async (
      _e,
      opts?: { unloadAll?: boolean; minSizeGB?: number; ollamaBaseUrl?: string }
    ) => {
      try {
        const { unloadLocalModelsForForge } = await import('../../core/resources/unload-local')
        return await unloadLocalModelsForForge({
          unloadAll: Boolean(opts?.unloadAll),
          minSizeGB: opts?.minSizeGB,
          ollamaBaseUrl: opts?.ollamaBaseUrl
        })
      } catch (err) {
        return {
          ok: false,
          unloaded: [],
          failed: [{ model: '*', error: err instanceof Error ? err.message : String(err) }],
          skipped: [],
          freedEstimateGB: 0,
          detail: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )
}
