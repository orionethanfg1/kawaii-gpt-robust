/**
 * Files + diagnostics path helpers IPC.
 */
import { ipcMain, shell, app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, writeFile, readdir, unlink, readFile } from 'fs/promises'

/** D1 — rehydrate document text from disk when textContent was thinned (quota). */
ipcMain.handle(
  'files:readTextPath',
  async (
    _e,
    filePath?: string
  ): Promise<{ ok: boolean; text?: string; error?: string; path?: string }> => {
    try {
      const fp = String(filePath || '').trim()
      if (!fp || !existsSync(fp)) {
        return { ok: false, error: 'Archivo no encontrado' }
      }
      const lower = fp.toLowerCase()
      // Prefer plain text extracts; binary office still needs extractText pipeline
      if (!/\.(txt|md|markdown|json|csv|tsv|log|html|xml|yml|yaml)$/i.test(lower) && !lower.endsWith('.txt')) {
        // Still try utf-8 read for unknown extracts saved as .txt without extension edge cases
        if (!/\.txt$/i.test(lower) && !/\.md$/i.test(lower)) {
          // Allow any path under userData
          const ud = app.getPath('userData').toLowerCase().replace(/\\/g, '/')
          const norm = fp.toLowerCase().replace(/\\/g, '/')
          if (!norm.includes(ud) && !norm.includes('kawaii')) {
            return { ok: false, error: 'Solo se leen extractos de texto en userData' }
          }
        }
      }
      const buf = await readFile(fp)
      if (buf.length > 8 * 1024 * 1024) {
        return { ok: false, error: 'Archivo demasiado grande (>8MB)' }
      }
      const text = buf.toString('utf8')
      if (!text.trim()) return { ok: false, error: 'Archivo vacío', path: fp }
      return { ok: true, text, path: fp }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

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
          return { ok: true, text: r.text.slice(0, 500_000) }
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

/** P1 — full conversation body under userData/chats/{id}.json */
ipcMain.handle(
  'files:saveChatBody',
  async (
    _e,
    payload?: { conversationId?: string; json?: string }
  ): Promise<{ ok: boolean; filePath?: string; backupPath?: string; error?: string }> => {
    try {
      const id = String(payload?.conversationId || '')
        .replace(/[^\w.-]+/g, '_')
        .slice(0, 80)
      if (!id || !payload?.json) return { ok: false, error: 'sin id o json' }
      const { rename } = await import('fs/promises')
      const root = app.getPath('userData')
      const dir = join(root, 'chats')
      const bakDir = join(root, 'chats-backup', id)
      await mkdir(dir, { recursive: true })
      await mkdir(bakDir, { recursive: true })
      const filePath = join(dir, `${id}.json`)
      const tmpPath = join(dir, `${id}.json.tmp`)
      await writeFile(tmpPath, payload.json, 'utf8')
      try {
        await rename(tmpPath, filePath)
      } catch {
        await writeFile(filePath, payload.json, 'utf8')
        try {
          await unlink(tmpPath)
        } catch {
          /* */
        }
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = join(bakDir, `${stamp}.json`)
      try {
        await writeFile(backupPath, payload.json, 'utf8')
        const names = (await readdir(bakDir)).filter((n) => n.endsWith('.json')).sort()
        while (names.length > 8) {
          const oldName = names.shift()
          if (oldName) {
            try {
              await unlink(join(bakDir, oldName))
            } catch {
              /* */
            }
          }
        }
      } catch {
        /* backup optional */
      }
      return { ok: true, filePath, backupPath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

ipcMain.handle(
  'files:readChatBody',
  async (
    _e,
    conversationId?: string
  ): Promise<{ ok: boolean; json?: string; error?: string }> => {
    try {
      const id = String(conversationId || '')
        .replace(/[^\w.-]+/g, '_')
        .slice(0, 80)
      if (!id) return { ok: false, error: 'sin id' }
      const filePath = join(app.getPath('userData'), 'chats', `${id}.json`)
      if (!existsSync(filePath)) return { ok: false, error: 'no existe' }
      const json = await readFile(filePath, 'utf8')
      return { ok: true, json }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

/** List primary + rotating backup chat JSON under userData/chats and chats-backup */
ipcMain.handle(
  'files:listChatBodies',
  async (): Promise<{
    ok: boolean
    items?: Array<{
      id: string
      path: string
      size: number
      mtimeMs: number
      messageCount?: number
      title?: string
      kind?: 'primary' | 'snapshot'
    }>
    error?: string
  }> => {
    try {
      const { stat } = await import('fs/promises')
      const root = app.getPath('userData')
      const items: Array<{
        id: string
        path: string
        size: number
        mtimeMs: number
        messageCount?: number
        title?: string
        kind?: 'primary' | 'snapshot'
      }> = []

      const pushFile = async (
        fp: string,
        id: string,
        kind: 'primary' | 'snapshot'
      ) => {
        try {
          const st = await stat(fp)
          if (!st.isFile()) return
          let messageCount: number | undefined
          let title: string | undefined
          try {
            const raw = await readFile(fp, 'utf8')
            const parsed = JSON.parse(raw) as {
              title?: string
              messages?: unknown[]
            }
            messageCount = Array.isArray(parsed.messages) ? parsed.messages.length : undefined
            title = typeof parsed.title === 'string' ? parsed.title : undefined
          } catch {
            /* */
          }
          items.push({
            id,
            path: fp,
            size: st.size,
            mtimeMs: st.mtimeMs,
            messageCount,
            title,
            kind
          })
        } catch {
          /* */
        }
      }

      const dir = join(root, 'chats')
      if (existsSync(dir)) {
        for (const name of await readdir(dir)) {
          if (!name.endsWith('.json') || name.endsWith('.tmp')) continue
          await pushFile(join(dir, name), name.replace(/\.json$/i, ''), 'primary')
        }
      }

      const bakRoot = join(root, 'chats-backup')
      if (existsSync(bakRoot)) {
        for (const id of await readdir(bakRoot)) {
          const sub = join(bakRoot, id)
          try {
            const st = await stat(sub)
            if (!st.isDirectory()) continue
            for (const name of await readdir(sub)) {
              if (!name.endsWith('.json')) continue
              await pushFile(join(sub, name), id, 'snapshot')
            }
          } catch {
            /* */
          }
        }
      }

      items.sort((a, b) => b.mtimeMs - a.mtimeMs)
      return { ok: true, items }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), items: [] }
    }
  }
)

/** Read chat JSON from an absolute path (recovery from snapshots) */
ipcMain.handle(
  'files:readChatBodyPath',
  async (
    _e,
    filePath?: string
  ): Promise<{ ok: boolean; json?: string; error?: string }> => {
    try {
      const fp = String(filePath || '')
      if (!fp || !existsSync(fp)) return { ok: false, error: 'no existe' }
      // Only allow under userData
      const root = app.getPath('userData')
      if (!fp.startsWith(root)) return { ok: false, error: 'ruta no permitida' }
      const json = await readFile(fp, 'utf8')
      return { ok: true, json }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

/** Library inventory for UI + LLM awareness */
ipcMain.handle(
  'files:listLibrary',
  async (): Promise<{
    ok: boolean
    items?: Array<{
      name: string
      path: string
      kind: 'user' | 'context' | 'images' | 'other'
      size: number
      mtimeMs: number
      isImage: boolean
    }>
    error?: string
  }> => {
    try {
      const { readdir, stat } = await import('fs/promises')
      const ud = app.getPath('userData')
      const roots: Array<{ sub: string; kind: 'user' | 'context' | 'images' }> = [
        { sub: 'user-uploads', kind: 'user' },
        { sub: 'app-context', kind: 'context' },
        { sub: 'images', kind: 'images' }
      ]
      const items: Array<{
        name: string
        path: string
        kind: 'user' | 'context' | 'images' | 'other'
        size: number
        mtimeMs: number
        isImage: boolean
      }> = []
      for (const r of roots) {
        const dir = join(ud, r.sub)
        if (!existsSync(dir)) continue
        let names: string[] = []
        try {
          names = await readdir(dir)
        } catch {
          continue
        }
        for (const name of names.slice(0, 200)) {
          if (name.startsWith('.')) continue
          const fp = join(dir, name)
          try {
            const st = await stat(fp)
            if (!st.isFile()) continue
            const isImage = /\.(png|jpe?g|webp|gif)$/i.test(name)
            items.push({
              name,
              path: fp,
              kind: r.kind,
              size: st.size,
              mtimeMs: st.mtimeMs,
              isImage
            })
          } catch {
            /* skip */
          }
        }
      }
      items.sort((a, b) => b.mtimeMs - a.mtimeMs)
      return { ok: true, items: items.slice(0, 120) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)


ipcMain.handle(
  'files:saveWardrobeImage',
  async (
    _e,
    payload?: { fileName?: string; base64?: string; dataUrl?: string }
  ) => {
    try {
      const { join } = await import('path')
      const { mkdir, writeFile } = await import('fs/promises')
      const dir = join(app.getPath('userData'), 'wardrobe')
      await mkdir(dir, { recursive: true })
      let buf: Buffer | null = null
      let ext = 'png'
      if (payload?.dataUrl && payload.dataUrl.startsWith('data:image/')) {
        const m = payload.dataUrl.match(/^data:image\/([\w+.-]+);base64,(.+)$/i)
        if (!m) return { ok: false, error: 'dataUrl inválido' }
        ext = (m[1] || 'png').replace('jpeg', 'jpg').split('+')[0]
        buf = Buffer.from(m[2], 'base64')
      } else if (payload?.base64) {
        buf = Buffer.from(payload.base64, 'base64')
        const n = (payload.fileName || '').toLowerCase()
        if (n.endsWith('.jpg') || n.endsWith('.jpeg')) ext = 'jpg'
        else if (n.endsWith('.webp')) ext = 'webp'
      } else {
        return { ok: false, error: 'sin contenido' }
      }
      if (buf.length > 20 * 1024 * 1024) {
        return { ok: false, error: 'imagen demasiado grande (>20MB)' }
      }
      const rawName = (payload?.fileName || `look-${Date.now()}.${ext}`).replace(
        /[\\/:*?"<>|]/g,
        '_'
      )
      const fileName = /\.(png|jpe?g|webp)$/i.test(rawName) ? rawName : `${rawName}.${ext}`
      const filePath = join(dir, fileName)
      await writeFile(filePath, buf)
      return { ok: true, filePath, dir }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

ipcMain.handle('files:openWardrobeDir', async () => openUserDataSubdir('wardrobe'))


ipcMain.handle('files:listWardrobe', async () => {
  try {
    const dir = join(app.getPath('userData'), 'wardrobe')
    if (!existsSync(dir)) return { ok: true, items: [] }
    const { readdir, stat } = await import('fs/promises')
    const names = await readdir(dir)
    const items: Array<{ name: string; path: string; size: number }> = []
    for (const name of names) {
      if (name.startsWith('.')) continue
      if (!/\.(png|jpe?g|webp)$/i.test(name)) continue
      const fp = join(dir, name)
      try {
        const st = await stat(fp)
        if (st.isFile()) items.push({ name, path: fp, size: st.size })
      } catch { /* */ }
    }
    items.sort((a, b) => b.size - a.size)
    return { ok: true, items }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), items: [] }
  }
})

ipcMain.handle('files:backupWardrobeFile', async (_e, filePath?: string) => {
  try {
    const src = String(filePath || '')
    if (!src || !existsSync(src)) return { ok: false, error: 'no source' }
    const { copyFile, mkdir } = await import('fs/promises')
    const { basename } = await import('path')
    const bak = join(app.getPath('userData'), 'wardrobe-backup')
    await mkdir(bak, { recursive: true })
    const dest = join(bak, basename(src))
    await copyFile(src, dest)
    return { ok: true, path: dest }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('files:toDataUrlFromWardrobeBackup', async (_e, originalPath?: string) => {
  try {
    const { basename } = await import('path')
    const { readFile } = await import('fs/promises')
    const name = basename(String(originalPath || ''))
    if (!name) return { ok: false, error: 'no name' }
    const bak = join(app.getPath('userData'), 'wardrobe-backup', name)
    if (!existsSync(bak)) return { ok: false, error: 'no backup' }
    const buf = await readFile(bak)
    const ext = name.toLowerCase().endsWith('.jpg') || name.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png'
    const dataUrl = `data:image/${ext};base64,${buf.toString('base64')}`
    return { ok: true, dataUrl, path: bak }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

