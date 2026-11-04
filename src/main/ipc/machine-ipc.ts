/**
 * Machine profile / data root IPC.
 */
import { ipcMain } from 'electron'
import {
  ensureMachineProfile,
  setDataRoot,
  clearMachineProfile,
  loadMachineProfile,
  ensureDataRootWorkspace,
  detectForgePresent,
  listDrives
} from '../machine-profile'

type Hw = {
  gpuName?: string | null
  vramGB?: number | null
  hasDiscreteGpu?: boolean | null
  totalMemoryGB?: number
}

function cachedHw(): Hw {
  try {
    const cached = (global as unknown as { __kawaiiHw?: Hw }).__kawaiiHw
    return cached ? { ...cached } : {}
  } catch {
    return {}
  }
}

export function registerMachineIpc(): void {
  ipcMain.handle('machine:ensureProfile', async () => {
    let hw = cachedHw()
    try {
      const { totalmem } = await import('os')
      if (!hw.totalMemoryGB) {
        hw.totalMemoryGB = Number((totalmem() / 1024 ** 3).toFixed(1))
      }
    } catch {
      /* */
    }
    const result = await ensureMachineProfile(hw)
    const forgePresent = await detectForgePresent(result.profile.forgeInstallPath)
    return { ...result, forgePresent }
  })

  ipcMain.handle('machine:getProfile', async () => loadMachineProfile())
  ipcMain.handle('machine:listDrives', async () => listDrives())

  ipcMain.handle('machine:setDataRoot', async (_e, root: string, lock?: boolean) => {
    const hw = cachedHw()
    const profile = await setDataRoot(String(root || ''), hw, lock !== false)
    await ensureDataRootWorkspace(profile)
    const forgePresent = await detectForgePresent(profile.forgeInstallPath)
    return { profile, forgePresent }
  })

  ipcMain.handle('machine:openDataRoot', async () => {
    const { shell } = await import('electron')
    const profile = await loadMachineProfile()
    if (!profile) {
      const r = await ensureMachineProfile({})
      await ensureDataRootWorkspace(r.profile)
      await shell.openPath(r.profile.preferredDataRoot)
      return { ok: true, path: r.profile.preferredDataRoot }
    }
    await ensureDataRootWorkspace(profile)
    await shell.openPath(profile.preferredDataRoot)
    return { ok: true, path: profile.preferredDataRoot }
  })

  ipcMain.handle('machine:clearProfile', async () => {
    await clearMachineProfile()
    return { ok: true }
  })

  ipcMain.handle('machine:prepareDataRoot', async () => {
    const hw = cachedHw()
    const { profile, drives, created } = await ensureMachineProfile(hw)
    const ws = await ensureDataRootWorkspace(profile)
    const forgePresent = await detectForgePresent(profile.forgeInstallPath)
    return { profile, drives, created, workspace: ws, forgePresent }
  })
}
