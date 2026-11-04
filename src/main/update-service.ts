/**
 * Auto-update via electron-updater (GitHub Releases).
 * Soft-fail if package not installed or not packaged.
 *
 * Publish releases as:
 *   KawaiiGPT-Robust-<version>-setup-x64.exe (+ .blockmap / latest.yml)
 * with owner/repo matching package.json homepage or env KAWAII_UPDATE_REPO.
 */

import { app, ipcMain } from 'electron'

export type UpdateStatus = {
  ok: boolean
  checking?: boolean
  available?: boolean
  version?: string
  downloaded?: boolean
  message?: string
  error?: string
}

let lastStatus: UpdateStatus = { ok: true, message: 'Sin comprobar aún' }

export function getUpdateStatus(): UpdateStatus {
  return { ...lastStatus }
}

export function registerUpdateIpc(): void {
  ipcMain.handle('update:status', async () => getUpdateStatus())
  ipcMain.handle('update:check', async () => {
    return checkForUpdates({ silent: false })
  })
  ipcMain.handle('update:install', async () => {
    try {
      // dynamic import so dev without dep still builds
      const mod = await import('electron-updater').catch(() => null)
      if (!mod?.autoUpdater) {
        return { ok: false, error: 'electron-updater no disponible' }
      }
      mod.autoUpdater.quitAndInstall(false, true)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

export async function checkForUpdates(opts?: { silent?: boolean }): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    lastStatus = {
      ok: true,
      available: false,
      message: 'Actualizaciones solo en build empaquetado (no en npm run dev)'
    }
    return lastStatus
  }
  try {
    const mod = await import('electron-updater').catch(() => null)
    if (!mod?.autoUpdater) {
      lastStatus = {
        ok: false,
        error:
          'Falta dependencia electron-updater. En el repo: npm i electron-updater --save'
      }
      return lastStatus
    }
    const { autoUpdater } = mod
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    lastStatus = { ok: true, checking: true, message: 'Buscando actualizaciones…' }

    return await new Promise<UpdateStatus>((resolve) => {
      const done = (s: UpdateStatus) => {
        lastStatus = s
        resolve(s)
      }
      const t = setTimeout(() => {
        done({
          ok: true,
          checking: false,
          message: 'Tiempo de espera al comprobar actualizaciones'
        })
      }, 45_000)

      autoUpdater.once('update-available', (info: { version?: string }) => {
        done({
          ok: true,
          checking: false,
          available: true,
          version: info?.version,
          message: `Hay actualización: v${info?.version || '?'}. Descargando…`
        })
      })
      autoUpdater.once('update-not-available', () => {
        clearTimeout(t)
        done({
          ok: true,
          checking: false,
          available: false,
          message: 'Ya tienes la última versión'
        })
      })
      autoUpdater.once('error', (err: Error) => {
        clearTimeout(t)
        done({
          ok: false,
          checking: false,
          error: err?.message || String(err)
        })
      })
      autoUpdater.once('update-downloaded', (info: { version?: string }) => {
        clearTimeout(t)
        done({
          ok: true,
          checking: false,
          available: true,
          downloaded: true,
          version: info?.version,
          message: `v${info?.version || '?'} descargada. Se instalará al reiniciar (o usa Instalar ahora).`
        })
      })

      void autoUpdater.checkForUpdates().catch((e: Error) => {
        clearTimeout(t)
        done({ ok: false, error: e?.message || String(e) })
      })
    })
  } catch (e) {
    lastStatus = {
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    }
    return lastStatus
  }
}

/** Call once after ready in packaged app (silent). */
export function scheduleUpdateCheckOnBoot(delayMs = 12_000): void {
  if (!app.isPackaged) return
  setTimeout(() => {
    void checkForUpdates({ silent: true }).catch(() => null)
  }, delayMs)
}
