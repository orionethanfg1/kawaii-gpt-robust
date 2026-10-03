/**
 * Stable Diffusion / Forge checkpoint workspace IPC.
 */
import { ipcMain } from 'electron'
import {
  ensureSdWorkspace,
  openSdWorkspace,
  listLocalCheckpoints,
  downloadCheckpoint,
  syncCheckpointsToForge
} from '../sd-workspace'

export function registerSdIpc(): void {
  ipcMain.handle('sd:ensureWorkspace', async () => ensureSdWorkspace())

  ipcMain.handle('sd:openWorkspace', async () => {
    await openSdWorkspace()
    return true
  })

  ipcMain.handle('sd:listCheckpoints', async () => listLocalCheckpoints())

  ipcMain.handle('sd:searchHuggingFace', async (_e, query?: string, limit?: number) => {
    const q = String(query || '').trim().slice(0, 80)
    if (q.length < 2) return { ok: false, error: 'query too short', results: [] }
    const lim = Math.min(20, Math.max(3, Number(limit) || 12))
    try {
      const url =
        'https://huggingface.co/api/models?search=' +
        encodeURIComponent(q) +
        '&filter=text-to-image&sort=downloads&direction=-1&limit=' +
        lim
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      })
      if (!res.ok) return { ok: false, error: `HF HTTP ${res.status}`, results: [] }
      const raw = (await res.json()) as Array<{
        id?: string
        modelId?: string
        downloads?: number
        likes?: number
        tags?: string[]
      }>
      const results = (Array.isArray(raw) ? raw : []).map((m) => {
        const id = String(m.id || m.modelId || '')
        return {
          id,
          label: id.split('/').pop() || id,
          repo: id,
          downloads: m.downloads || 0,
          likes: m.likes || 0,
          tags: (m.tags || []).slice(0, 8),
          pageUrl: `https://huggingface.co/${id}`,
          filesUrl: `https://huggingface.co/api/models/${id}/tree/main`
        }
      })
      return { ok: true, results }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), results: [] }
    }
  })

  ipcMain.handle('sd:listWeights', async () => {
    try {
      const { listLocalWeightsDetailed } = await import('../sd-workspace')
      return { ok: true, weights: await listLocalWeightsDetailed() }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        weights: []
      }
    }
  })

  ipcMain.handle('sd:listCheckpointsCatalog', async () => {
    try {
      const { getCheckpointCatalog } = await import('../sd-workspace')
      return { ok: true, models: getCheckpointCatalog() }
    } catch (err) {
      return {
        ok: false,
        models: [],
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('sd:discardJob', async (_e, modelId?: string) => {
    try {
      if (!modelId) return { ok: false, error: 'Sin id' }
      const { getCheckpointCatalog, resolveSdModelsDir } = await import('../sd-workspace')
      const { clearDownloadJob, listRecoveryJobs } = await import('../resumable-download')
      const { join } = await import('path')
      const { unlink } = await import('fs/promises')
      const { existsSync } = await import('fs')
      const entry = getCheckpointCatalog().find((c) => c.id === modelId)
      const modelsDir = await resolveSdModelsDir()
      const filename = entry?.filename || `${modelId}.safetensors`
      const dest = join(modelsDir, filename)
      const partial = `${dest}.partial`
      await clearDownloadJob(dest)
      for (const p of [partial, dest + '.download.json']) {
        if (existsSync(p)) {
          try {
            await unlink(p)
          } catch {
            /* */
          }
        }
      }
      try {
        const jobs = await listRecoveryJobs(modelsDir)
        for (const j of jobs) {
          if (j.id === modelId || (j.label && j.label.includes(modelId))) {
            await clearDownloadJob(j.dest)
            if (existsSync(j.partial)) {
              try {
                await unlink(j.partial)
              } catch {
                /* */
              }
            }
          }
        }
      } catch {
        /* */
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('sd:listInstalled', async () => {
    try {
      const { listInstalledCheckpoints } = await import('../sd-workspace')
      return { ok: true, models: await listInstalledCheckpoints() }
    } catch (err) {
      return {
        ok: false,
        models: [],
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('sd:listRecovery', async () => {
    try {
      const { listSdDownloadRecovery } = await import('../sd-workspace')
      return { ok: true, jobs: await listSdDownloadRecovery() }
    } catch (err) {
      return {
        ok: false,
        jobs: [],
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('sd:pauseDownload', async () => {
    try {
      const { pauseSdDownload } = await import('../sd-workspace')
      return pauseSdDownload()
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('sd:downloadCheckpoint', async (event, modelId?: string) => {
    const result = await downloadCheckpoint(
      (pct, received, total) => {
        try {
          event.sender.send('sd:download-progress', { pct, received, total, modelId })
        } catch {
          /* */
        }
      },
      undefined,
      undefined,
      modelId
    )
    try {
      await syncCheckpointsToForge()
    } catch {
      /* */
    }
    return result
  })

  ipcMain.handle('sd:syncCheckpointsToForge', async () => {
    try {
      return await syncCheckpointsToForge()
    } catch (err) {
      return {
        ok: false,
        copied: [],
        skipped: [],
        forgeModelsDir: null,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })
}
