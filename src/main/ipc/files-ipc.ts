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
      const { mkdir } = await import('fs/promises')
      const img = join(app.getPath('userData'), 'generated-images')
      dirs.push({ id: 'images', label: 'Imágenes generadas (userData)', path: img })
      const uploads = join(app.getPath('userData'), 'user-uploads')
      const ctx = join(app.getPath('userData'), 'app-context')
      await mkdir(uploads, { recursive: true }).catch(() => null)
      await mkdir(ctx, { recursive: true }).catch(() => null)
      dirs.push({ id: 'user-uploads', label: 'Archivos del usuario (subidas)', path: uploads })
      dirs.push({ id: 'app-context', label: 'Contexto / memoria de la app', path: ctx })
      // legacy alias
      const legacy = join(app.getPath('userData'), 'chat-attachments')
      await mkdir(legacy, { recursive: true }).catch(() => null)
      dirs.push({ id: 'chat-attachments', label: 'Adjuntos (legado)', path: legacy })
    } catch { /* ignore */ }
    return { ok: true, dirs }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), dirs: [] }
  }
})



ipcMain.handle(
  'files:extractText',
  async (
    _e,
    payload?: { name?: string; base64?: string; mime?: string }
  ): Promise<{ ok: boolean; text?: string; error?: string; note?: string }> => {
    try {
      const name = String(payload?.name || 'doc.bin')
      const b64 = String(payload?.base64 || '')
      if (!b64) return { ok: false, error: 'Sin datos del archivo' }
      const buf = Buffer.from(b64, 'base64')
      if (buf.length > 25 * 1024 * 1024) {
        return { ok: false, error: 'Archivo demasiado grande (máx. 25 MB)' }
      }
      const { app } = await import('electron')
      const { join } = await import('path')
      const { writeFile, unlink, mkdir } = await import('fs/promises')
      const { existsSync } = await import('fs')
      const { spawn } = await import('child_process')
      const tmpDir = join(app.getPath('temp'), 'kawaii-doc-extract')
      await mkdir(tmpDir, { recursive: true })
      const safe = name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'doc.bin'
      const tmpPath = join(tmpDir, Date.now() + '_' + safe)
      await writeFile(tmpPath, buf)

      const tryScript = (python: string, script: string) =>
        new Promise<{ ok: boolean; text?: string; error?: string }>((resolve) => {
          const child = spawn(python, [script, tmpPath], {
            windowsHide: true,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
          })
          let out = ''
          let err = ''
          const timer = setTimeout(() => {
            try {
              child.kill()
            } catch {
              /* */
            }
            resolve({ ok: false, error: 'Timeout extrayendo documento' })
          }, 45_000)
          child.stdout?.on('data', (d) => {
            out += d.toString('utf8')
          })
          child.stderr?.on('data', (d) => {
            err += d.toString('utf8')
          })
          child.on('close', (code) => {
            clearTimeout(timer)
            if (code === 0 && out.trim()) resolve({ ok: true, text: out })
            else resolve({ ok: false, error: (err || out || 'falló extracción').slice(0, 400) })
          })
          child.on('error', (e) => {
            clearTimeout(timer)
            resolve({ ok: false, error: e.message })
          })
        })

      const candidates = [
        join(app.getAppPath(), 'tools', 'doc_read.py'),
        join(process.cwd(), 'tools', 'doc_read.py'),
        join(app.getAppPath(), '..', 'tools', 'doc_read.py')
      ]
      const script = candidates.find((c) => existsSync(c))
      if (!script) {
        try {
          await unlink(tmpPath)
        } catch {
          /* */
        }
        return {
          ok: false,
          error: 'No se encontró tools/doc_read.py',
          note: 'Actualiza la app o convierte a .txt/.md'
        }
      }

      const pythons = ['python', 'python3', 'py']
      let lastErr = 'Python no disponible'
      for (const py of pythons) {
        const r = await tryScript(py, script)
        if (r.ok && r.text) {
          try {
            await unlink(tmpPath)
          } catch {
            /* */
          }
          return { ok: true, text: r.text.slice(0, 180_000) }
        }
        lastErr = r.error || lastErr
      }
      try {
        await unlink(tmpPath)
      } catch {
        /* */
      }
      return {
        ok: false,
        error: lastErr,
        note: /pdf/i.test(name)
          ? 'Para PDF: pip install pypdf (o instala pdftotext)'
          : 'Prueba convertir a .txt o .md'
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

export function registerFilesIpc(): void {
  /* handlers bound at module load */
}



/** kind: user = originales subidos; context = extractos/memoria app; legacy = chat-attachments */
ipcMain.handle(
  'files:saveChatAttachment',
  async (
    _e,
    payload?: { fileName?: string; base64?: string; text?: string; kind?: 'user' | 'context' | 'legacy' }
  ) => {
    try {
      const { join } = await import('path')
      const { mkdir, writeFile } = await import('fs/promises')
      const kind = payload?.kind === 'context' ? 'context' : payload?.kind === 'legacy' ? 'legacy' : 'user'
      const sub =
        kind === 'context' ? 'app-context' : kind === 'legacy' ? 'chat-attachments' : 'user-uploads'
      const dir = join(app.getPath('userData'), sub)
      await mkdir(dir, { recursive: true })
      const rawName = (payload?.fileName || `adjunto-${Date.now()}`).replace(/[\\/:*?"<>|]/g, '_')
      const filePath = join(dir, rawName)
      if (payload?.text != null) {
        await writeFile(filePath, payload.text, 'utf8')
      } else if (payload?.base64) {
        const buf = Buffer.from(payload.base64, 'base64')
        await writeFile(filePath, buf)
      } else {
        return { ok: false, error: 'sin contenido' }
      }
      return { ok: true, filePath, dir, kind }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

async function openUserDataSubdir(sub: string) {
  try {
    const { join } = await import('path')
    const { mkdir } = await import('fs/promises')
    const { shell } = await import('electron')
    const dir = join(app.getPath('userData'), sub)
    await mkdir(dir, { recursive: true })
    const err = await shell.openPath(dir)
    return err ? { ok: false, error: err, path: dir } : { ok: true, path: dir }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

ipcMain.handle('files:openChatAttachmentsDir', async () => openUserDataSubdir('user-uploads'))
ipcMain.handle('files:openUserUploadsDir', async () => openUserDataSubdir('user-uploads'))
ipcMain.handle('files:openAppContextDir', async () => openUserDataSubdir('app-context'))
