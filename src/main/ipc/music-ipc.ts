/**
 * Music layer IPC — workspace, install, runtime, generate.
 * Wired from main/index.ts via registerMusicIpc().
 */
import { ipcMain } from 'electron'

export function registerMusicIpc(): void {
  ipcMain.handle('music:ensureWorkspace', async () => {
    try {
      const { ensureMusicWorkspace } = await import('../music-workspace')
      return { ok: true, ...(await ensureMusicWorkspace()) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('music:status', async () => {
    try {
      const { getMusicStatusSnapshot } = await import('../music-workspace')
      return await getMusicStatusSnapshot()
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ace: { present: false, path: '', stage: 'none' },
        yue: { present: false, path: '', stage: 'disabled' },
        eligibility: null,
        musicRoot: ''
      }
    }
  })

  ipcMain.handle('music:analyze', async () => {
    try {
      const { loadMusicState } = await import('../music-workspace')
      const state = await loadMusicState()
      return { ok: true, eligibility: state.eligibility, state }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('music:install', async (_e, opts?: { forceAce?: boolean; forceYue?: boolean }) => {
    try {
      const { installMusicStack } = await import('../music-installer')
      return await installMusicStack(opts || {})
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('music:installCancel', async () => {
    try {
      const { cancelMusicInstall } = await import('../music-installer')
      cancelMusicInstall()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('music:setup', async () => {
    try {
      const { ensureAceEnvironment } = await import('../music-runtime')
      return await ensureAceEnvironment()
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('music:start', async (_e, preferredPort?: number) => {
    try {
      const { startMusicRuntime } = await import('../music-runtime')
      return await startMusicRuntime({ preferredPort })
    } catch (err) {
      return {
        state: 'error',
        port: null,
        baseUrl: null,
        pid: null,
        message: err instanceof Error ? err.message : String(err),
        backend: 'none'
      }
    }
  })

  ipcMain.handle('music:stop', async () => {
    try {
      const { stopMusicRuntime } = await import('../music-runtime')
      return await stopMusicRuntime()
    } catch (err) {
      return { state: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('music:runtimeStatus', async () => {
    try {
      const { getMusicRuntimeStatus } = await import('../music-runtime')
      return getMusicRuntimeStatus()
    } catch {
      return { state: 'stopped', port: null, baseUrl: null, message: 'N/A', backend: 'none' }
    }
  })

  ipcMain.handle('music:logTail', async () => {
    try {
      const { getMusicLogTail, getMusicLogPath } = await import('../music-runtime')
      return { lines: getMusicLogTail(), path: getMusicLogPath() }
    } catch {
      return { lines: [], path: null }
    }
  })

  ipcMain.handle('music:logPath', async () => {
    try {
      const { getMusicLogPath } = await import('../music-runtime')
      return { ok: true, path: getMusicLogPath() }
    } catch (e) {
      return { ok: false, path: null, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('music:ensureReady', async (_e, preferredPort?: number) => {
    try {
      const { ensureMusicReady } = await import('../music-runtime')
      return await ensureMusicReady(preferredPort)
    } catch (err) {
      return {
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
        port: null,
        baseUrl: null,
        backend: 'none'
      }
    }
  })

  ipcMain.handle(
    'music:generate',
    async (
      _e,
      req?: {
        prompt?: string
        lyrics?: string
        durationSec?: number
        vocalLanguage?: string
      }
    ) => {
      try {
        const { generateMusicTrack } = await import('../music-runtime')
        const r = await generateMusicTrack({
          prompt: String(req?.prompt || '').trim() || 'instrumental ambient',
          lyrics: req?.lyrics,
          durationSec: req?.durationSec,
          vocalLanguage: req?.vocalLanguage
        })
        const path =
          (r as { path?: string; audioPath?: string }).path ||
          (r as { audioPath?: string }).audioPath
        return { ...r, path, audioPath: path }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
