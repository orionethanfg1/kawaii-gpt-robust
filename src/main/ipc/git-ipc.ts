/**
 * Git sync IPC (SSH multi-account).
 */
import { ipcMain } from 'electron'
import * as gitSync from '../git-sync'

export function registerGitIpc(): void {
  ipcMain.handle('git:status', async () => {
    try {
      return await gitSync.getGitStatus()
    } catch (e) {
      return { ok: false, lastError: String(e) }
    }
  })
  ipcMain.handle('git:listKeys', async () => {
    try {
      return await gitSync.listSshKeys()
    } catch {
      return []
    }
  })
  ipcMain.handle('git:applyIdentity', async (_e, identity) => {
    try {
      return await gitSync.applyGitIdentity(identity)
    } catch (e) {
      return { ok: false, steps: [], stdout: '', stderr: String(e), error: String(e) }
    }
  })
  ipcMain.handle('git:savedIdentity', async () => {
    try {
      return await gitSync.loadSavedIdentity()
    } catch {
      return null
    }
  })
  ipcMain.handle('git:add', async () => gitSync.gitAddAll())
  ipcMain.handle('git:commit', async (_e, message?: string) => gitSync.gitCommit(message || ''))
  ipcMain.handle('git:push', async (_e, force?: boolean) =>
    force ? gitSync.gitForcePush() : gitSync.gitPush({ setUpstream: true })
  )
  ipcMain.handle('git:sync', async (_e, message?: string, force?: boolean) =>
    gitSync.gitSyncAll({ message: message || '', force: Boolean(force) })
  )
  ipcMain.handle('git:testAuth', async () => gitSync.testSshAuth())
}
