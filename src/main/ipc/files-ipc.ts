/**
 * Files + diagnostics path helpers IPC.
 */
import { ipcMain, shell, app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, writeFile, readdir, unlink, readFile } from 'fs/promises'

ipcMain.handle('files:toDataUrl', async (_e, filePath?: string) => {
  try {
    if (!filePath || !existsSync(filePath)) {
      return { ok: false, error: 'Archivo no encontrado' }
    }
    const { readFile } = await import('node:fs/promises')
    const buf = await readFile(filePath)
    const lower = filePath.toLowerCase()
    const mime = lower.endsWith('.wav')
      ? 'audio/wav'
      : lower.endsWith('.ogg')
        ? 'audio/ogg'
        : lower.endsWith('.flac')
          ? 'audio/flac'
          : lower.endsWith('.png')
            ? 'image/png'
            : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
              ? 'image/jpeg'
              : lower.endsWith('.webp')
                ? 'image/webp'
                : 'audio/mpeg'
    // Cap ~25MB to keep renderer healthy
    if (buf.length > 25 * 1024 * 1024) {
      return { ok: false, error: 'Archivo demasiado grande para incrustar; ábrelo en carpeta', path: filePath }
    }
    return {
      ok: true,
      dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
      mime,
      path: filePath
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('files:showInFolder', async (_e, filePath?: string) => {
  try {
    const { shell } = await import('electron')
    if (filePath && existsSync(filePath)) {
      shell.showItemInFolder(filePath)
      return { ok: true, path: filePath }
    }
    return { ok: false, error: 'Ruta no válida' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})


ipcMain.handle('diagnostics:clearExports', async () => {
  const { join } = await import('node:path')
  const { readdir, unlink } = await import('node:fs/promises')
  const dir = join(app.getPath('userData'), 'diagnostics')
  try {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
  } catch {
    /* */
  }
  let removed = 0
  try {
    const files = await readdir(dir)
    for (const f of files) {
      if (!/\.(md|txt|json|log)$/i.test(f)) continue
      try {
        await unlink(join(dir, f))
        removed++
      } catch {
        /* skip locked */
      }
    }
  } catch {
    /* empty */
  }
  return { ok: true as const, removed, dir }
})

ipcMain.handle('diagnostics:listPaths', async () => {
  const { join } = await import('node:path')
  const root = app.getPath('userData')
  const logs = app.getPath('logs')
  return {
    ok: true as const,
    paths: [
      { id: 'userData', label: 'Datos de la app (userData)', path: root },
      { id: 'logs', label: 'Logs de Electron', path: logs },
      { id: 'images', label: 'Imágenes generadas', path: join(root, 'images') },
      { id: 'generated-images', label: 'Imágenes (generated-images)', path: join(root, 'generated-images') },
      { id: 'sd-workspace', label: 'Workspace SD / Forge', path: join(root, 'sd-workspace') },
      { id: 'diagnostics', label: 'Diagnósticos exportados', path: join(root, 'diagnostics') },
      { id: 'machine-profile', label: 'Perfil de máquina', path: join(root, 'machine-profile.json') }
    ]
  }
})

ipcMain.handle(
  'diagnostics:writeTextFile',
  async (_e, payload: { fileName?: string; content?: string; subdir?: string }) => {
    const { join } = await import('node:path')
    const { writeFile, mkdir } = await import('node:fs/promises')
    const sub = (payload?.subdir || 'diagnostics').replace(/\.\./g, '')
    const dir = join(app.getPath('userData'), sub)
    await mkdir(dir, { recursive: true })
    const name =
      (payload?.fileName || `informe-feedback-${Date.now()}.md`).replace(/[\\/:*?"<>|]/g, '_')
    const filePath = join(dir, name)
    await writeFile(filePath, payload?.content || '', 'utf8')
    return { ok: true as const, filePath, dir }
  }
)

ipcMain.handle('files:openPath', async (_e, filePath?: string) => {
  try {
    const { shell } = await import('electron')
    if (!filePath || !existsSync(filePath)) return { ok: false, error: 'Ruta no válida' }
    const err = await shell.openPath(filePath)
    return err ? { ok: false, error: err } : { ok: true, path: filePath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('files:listKnownDirs', async () => {
  try {
    const { ensureMachineProfile } = await import('../machine-profile')
    const profile = await ensureMachineProfile()
    const dirs: Array<{ id: string; label: string; path: string }> = []
    if (profile.preferredDataRoot) {
      dirs.push({ id: 'data', label: 'Datos Kawaii (D:/ o preferido)', path: profile.preferredDataRoot })
    }
    if (profile.forgeInstallPath) {
      dirs.push({ id: 'forge', label: 'Forge / SD workspace', path: profile.forgeInstallPath })
      const { join } = await import('path')
      dirs.push({
        id: 'sd-checkpoints',
        label: 'Checkpoints Stable Diffusion',
        path: join(profile.forgeInstallPath, 'models', 'Stable-diffusion')
      })
      dirs.push({
        id: 'lora',
        label: 'LoRAs (modelos de capa)',
        path: join(profile.forgeInstallPath, 'models', 'Lora')
      })
      try {
        const { ensureLoraDirs } = await import('../sd-workspace')
        await ensureLoraDirs()
      } catch {
        /* ignore */
      }
    }
    try {
      const { ensureMusicWorkspace } = await import('../music-workspace')
      const m = await ensureMusicWorkspace()
      if (m?.musicRoot) dirs.push({ id: 'music', label: 'Música ACE-Step', path: m.musicRoot })
      if (m?.aceDir) dirs.push({ id: 'ace', label: 'ACE-Step app', path: m.aceDir })
      if (m?.musicRoot) {
        const { join } = await import('path')
        dirs.push({ id: 'music-out', label: 'Salidas de audio (outputs)', path: join(m.musicRoot, 'outputs') })
      }
    } catch { /* optional */ }
    try {
      const { app } = await import('electron')
      const img = join(app.getPath('userData'), 'generated-images')
      dirs.push({ id: 'images', label: 'Imágenes generadas (userData)', path: img })
    } catch { /* ignore */ }
    return { ok: true, dirs }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), dirs: [] }
  }
})


export function registerFilesIpc(): void {
  /* handlers bound at module load */
}
