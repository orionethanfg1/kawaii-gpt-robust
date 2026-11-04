/**
 * Forge IPC — install, runtime, FaceID/ControlNet extensions, health.
 * Domain module pattern: thin handlers → services in forge-*.ts
 * Channels: forge:*
 *
 * Best practices applied:
 * - registerX() once at boot (index only wires)
 * - namespaced channels
 * - business logic stays in forge-runtime / forge-installer / forge-extensions
 * - progress via event.sender.send (not return stream)
 */
import { BrowserWindow, ipcMain } from 'electron'
import {
  installForgePortable,
  cancelForgeInstall,
  pauseForgeInstall,
  openForgeFolder,
  FORGE_PACK,
  getForgeDownloadJob,
  listInstallRecoveryJobs
} from '../forge-installer'
import {
  startForgeRuntime,
  stopForgeRuntime,
  getForgeRuntimeStatus,
  refreshForgeHealth,
  pickForgePort,
  FORGE_PORT_CANDIDATES,
  getForgeLogPath,
  getForgeLogTail
} from '../forge-runtime'

export function registerForgeIpc(): void {
  ipcMain.handle('forge:extensionsStatus', async () => {
    const { getForgeExtensionsStatus } = await import('../forge-extensions')
    return getForgeExtensionsStatus()
  })

  ipcMain.handle('forge:ensureControlNet', async () => {
    const { ensureControlNetFolders } = await import('../forge-extensions')
    return ensureControlNetFolders()
  })

  ipcMain.handle('forge:installFaceId', async (event) => {
    const { installFaceIdModels } = await import('../forge-extensions')
    const send = (msg: string, pct?: number) => {
      try {
        event.sender.send('forge:faceid-progress', { detail: msg, pct })
      } catch {
        /* */
      }
    }
    return installFaceIdModels(send)
  })

  ipcMain.handle('forge:hasFaceId', async () => {
    const { hasFaceIdOnDisk, getForgeExtensionsStatus } = await import('../forge-extensions')
    const disk = await hasFaceIdOnDisk()
    const st = await getForgeExtensionsStatus()
    return {
      ok: true as const,
      hasFaceId: disk.hasFaceId,
      hasLora: disk.hasLora,
      files: disk.files,
      controlNetModels: st.controlNetModels,
      dir: disk.dir || st.controlNetModelsDir
    }
  })

  ipcMain.handle('forge:installControlNetModels', async (event) => {
    const { installBasicControlNetModels } = await import('../forge-extensions')
    return installBasicControlNetModels((msg, pct) => {
      try {
        event.sender.send('forge:cn-progress', { msg, pct })
      } catch {
        /* ignore */
      }
    })
  })

  ipcMain.handle('forge:install', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null
      return await installForgePortable(() => win)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('forge:cancelInstall', async (_e, wipe?: boolean) => {
    try {
      return cancelForgeInstall(!!wipe)
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('forge:pauseInstall', async () => {
    try {
      return pauseForgeInstall()
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('forge:downloadJob', async () => {
    try {
      return await getForgeDownloadJob()
    } catch {
      return null
    }
  })

  ipcMain.handle('forge:listRecovery', async () => {
    try {
      return await listInstallRecoveryJobs()
    } catch {
      return []
    }
  })

  ipcMain.handle('forge:openFolder', async () => {
    try {
      return await openForgeFolder()
    } catch (err) {
      return { ok: false, path: '', error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('forge:packInfo', async () => {
    try {
      return FORGE_PACK
    } catch {
      return { id: '', filename: '', url: '', approxGB: 0, label: 'No disponible' }
    }
  })

  ipcMain.handle('forge:start', async (_e, preferredPort?: number) => {
    try {
      let unloadNote = ''
      try {
        const { unloadLocalModelsForForge } = await import('../../core/resources/unload-local')
        const ur = await unloadLocalModelsForForge({
          unloadAll: false,
          minSizeGB: 4
        })
        unloadNote = ur.detail
        if (ur.unloaded.length) {
          console.log('[forge:start] R2 unload local LLM:', ur.detail)
        }
      } catch (e) {
        unloadNote = e instanceof Error ? e.message : String(e)
      }
      const st = await startForgeRuntime({
        preferredPort: preferredPort != null ? Number(preferredPort) : undefined,
        skipUnload: true
      })
      if (unloadNote && st && typeof st === 'object') {
        const msg = (st as { message?: string }).message || ''
        ;(st as { message?: string; unloadNote?: string }).unloadNote = unloadNote
        if (!msg) (st as { message?: string }).message = unloadNote
        else (st as { message?: string }).message = `${msg} · ${unloadNote}`
      }
      return st
    } catch (err) {
      return {
        state: 'error',
        port: null,
        baseUrl: null,
        pid: null,
        forgeRoot: null,
        message: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('forge:stop', async () => {
    try {
      return await stopForgeRuntime()
    } catch (err) {
      return {
        state: 'error',
        port: null,
        baseUrl: null,
        pid: null,
        forgeRoot: null,
        message: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('forge:logPath', async () => {
    try {
      return { ok: true, path: getForgeLogPath() }
    } catch (e) {
      return { ok: false, path: null, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('forge:logTail', () => {
    try {
      return { lines: getForgeLogTail(), path: getForgeLogPath() }
    } catch {
      return { lines: [], path: null }
    }
  })

  ipcMain.handle('forge:status', async () => {
    try {
      return getForgeRuntimeStatus()
    } catch {
      return {
        state: 'stopped',
        port: null,
        baseUrl: null,
        pid: null,
        forgeRoot: null,
        message: 'Estado no disponible'
      }
    }
  })

  ipcMain.handle('forge:refreshHealth', async () => {
    try {
      return await refreshForgeHealth()
    } catch (err) {
      return {
        state: 'error',
        port: null,
        baseUrl: null,
        pid: null,
        forgeRoot: null,
        message: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('forge:pickPort', async (_e, preferred?: number) => {
    try {
      const port = await pickForgePort(preferred)
      return { ok: true, port, candidates: FORGE_PORT_CANDIDATES }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        candidates: FORGE_PORT_CANDIDATES
      }
    }
  })
}
