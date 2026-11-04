/**
 * Files + diagnostics path helpers IPC.
 */
import { ipcMain, shell, app, dialog } from 'electron'
import { join, resolve as pathResolve, normalize as pathNormalize, dirname as pathDirname, basename as pathBasename } from 'path'
import { existsSync } from 'fs'
import { assertPathAllowed } from '../path-boundary'
import { mkdir, writeFile, readdir, unlink, readFile } from 'fs/promises'


/** Full document extract to disk — no char cap. Returns path + totalChars. */
async function runDocReadToFile(
  sourcePath: string,
  outPath: string
): Promise<{ ok: boolean; totalChars?: number; path?: string; error?: string }> {
  const { spawn } = await import('child_process')
  const { existsSync } = await import('fs')
  const candidates = [
    join(app.getAppPath(), 'tools', 'doc_read.py'),
    join(process.cwd(), 'tools', 'doc_read.py'),
    join(app.getAppPath(), '..', 'tools', 'doc_read.py')
  ]
  const script = candidates.find((c) => existsSync(c))
  if (!script) return { ok: false, error: 'No se encontró tools/doc_read.py' }

  const runPy = (python: string) =>
    new Promise<{ ok: boolean; totalChars?: number; error?: string }>((resolve) => {
      const child = spawn(python, [script, sourcePath, '--out', outPath], {
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
        resolve({ ok: false, error: 'Timeout extrayendo documento (120s)' })
      }, 120_000)
      child.stdout?.on('data', (d) => {
        out += d.toString('utf8')
      })
      child.stderr?.on('data', (d) => {
        err += d.toString('utf8')
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          const m = /total=(\d+)/i.exec(out)
          const n = m ? parseInt(m[1], 10) : 0
          resolve({ ok: true, totalChars: n || undefined })
        } else {
          resolve({ ok: false, error: (err || out || 'falló extracción').slice(0, 400) })
        }
      })
      child.on('error', (e) => {
        clearTimeout(timer)
        resolve({ ok: false, error: e.message })
      })
    })

  for (const py of ['python', 'python3', 'py']) {
    const r = await runPy(py)
    if (r.ok) {
      try {
        const { stat } = await import('fs/promises')
        const st = await stat(outPath)
        const totalChars = r.totalChars || Math.max(0, Math.floor(st.size * 0.9))
        return { ok: true, totalChars, path: outPath }
      } catch {
        return { ok: true, totalChars: r.totalChars, path: outPath }
      }
    }
  }
  return { ok: false, error: 'Python no disponible o extracción falló' }
}


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
      // Office binary: re-extract with doc_read (2M) so long books leave Cap.10
      if (/\.(docx|pdf)$/i.test(lower)) {
        try {
          const { spawn } = await import('child_process')
          const candidates = [
            join(app.getAppPath(), 'tools', 'doc_read.py'),
            join(process.cwd(), 'tools', 'doc_read.py'),
            join(app.getAppPath(), '..', 'tools', 'doc_read.py')
          ]
          const script = candidates.find((c) => existsSync(c))
          if (script) {
            const runPy = (python: string) =>
              new Promise<string | null>((resolve) => {
                const child = spawn(python, [script, fp], {
                  windowsHide: true,
                  env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
                })
                let out = ''
                const timer = setTimeout(() => {
                  try {
                    child.kill()
                  } catch {
                    /* */
                  }
                  resolve(null)
                }, 60_000)
                child.stdout?.on('data', (d) => {
                  out += d.toString('utf8')
                })
                child.on('close', (code) => {
                  clearTimeout(timer)
                  resolve(code === 0 && out.trim() ? out : null)
                })
                child.on('error', () => {
                  clearTimeout(timer)
                  resolve(null)
                })
              })
            for (const py of ['python', 'python3', 'py']) {
              const text = await runPy(py)
              if (text && text.trim().length > 100) {
                const clipped =
                  text.length > 2_000_000 ? text.slice(0, 2_000_000) : text
                // Cache extract beside original when under userData
                try {
                  const outPath = fp.replace(/\.[^.]+$/i, '') + '.extract.txt'
                  await writeFile(outPath, clipped, 'utf8')
                } catch {
                  /* */
                }
                return { ok: true, text: clipped, path: fp }
              }
            }
          }
        } catch {
          /* fall through to utf8 */
        }
      }
      // Prefer plain text extracts
      if (!/\.(txt|md|markdown|json|csv|tsv|log|html|xml|yml|yaml)$/i.test(lower) && !lower.endsWith('.txt')) {
        if (!/\.txt$/i.test(lower) && !/\.md$/i.test(lower)) {
          const ud = app.getPath('userData').toLowerCase().replace(/\\/g, '/')
          const norm = fp.toLowerCase().replace(/\\/g, '/')
          if (!norm.includes(ud) && !norm.includes('kawaii')) {
            return { ok: false, error: 'Solo se leen extractos de texto en userData' }
          }
        }
      }
      const buf = await readFile(fp)
      if (buf.length > 32 * 1024 * 1024) {
        return { ok: false, error: 'Archivo demasiado grande (>32MB)' }
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
    let fp = String(filePath || '').trim()
    if (fp.startsWith('kawaii-file:')) fp = fp.slice('kawaii-file:'.length)
    if (fp.startsWith('file:')) {
      fp = fp.replace(/^file:\/\//i, '')
      if (fp.startsWith('localhost/')) fp = fp.slice(10)
      if (/^\/[A-Za-z]:/.test(fp)) fp = fp.slice(1)
      try {
        fp = decodeURIComponent(fp)
      } catch {
        /* */
      }
    }
    if (!fp || !existsSync(fp)) {
      const alt = fp.includes('\\') ? fp.replace(/\\/g, '/') : fp.replace(/\//g, '\\')
      if (alt && existsSync(alt)) fp = alt
    }
    if (!fp || !existsSync(fp)) {
      return { ok: false, error: 'Archivo no encontrado' }
    }
    filePath = fp
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

      // Full extract to userData/app-context — no char limit on disk
      const ctxDir = join(app.getPath('userData'), 'app-context')
      await mkdir(ctxDir, { recursive: true })
      const extractOut = join(ctxDir, safe.replace(/\.[^.]+$/i, '') + '.extract.txt')
      const full = await runDocReadToFile(tmpPath, extractOut)
      try {
        await unlink(tmpPath)
      } catch {
        /* */
      }
      if (full.ok && full.path) {
        const diskText = await readFile(full.path, 'utf8')
        const forIpc =
          diskText.length > 2_000_000 ? diskText.slice(0, 2_000_000) : diskText
        return {
          ok: true,
          text: forIpc,
          totalChars: diskText.length,
          extractPath: full.path,
          complete: true,
          truncatedForIpc: diskText.length > forIpc.length
        }
      }
      return {
        ok: false,
        error: full.error || 'falló extracción',
        note: /pdf/i.test(name)
          ? 'Para PDF: pip install pypdf (o instala pdftotext)'
          : 'Prueba convertir a .txt o .md'
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)



ipcMain.handle(
  'files:ensureDocExtract',
  async (
    _e,
    payload?: { sourcePath?: string; extractPath?: string; name?: string }
  ): Promise<{
    ok: boolean
    text?: string
    totalChars?: number
    extractPath?: string
    sourcePath?: string
    repaired?: boolean
    error?: string
  }> => {
    try {
      const source = String(payload?.sourcePath || '').trim()
      let extract = String(payload?.extractPath || '').trim()
      const name = String(payload?.name || '').trim() || 'documento.docx'
      const root = app.getPath('userData')
      const uploads = join(root, 'user-uploads')
      const ctxDir = join(root, 'app-context')
      const legacy = join(root, 'chat-attachments')
      await mkdir(ctxDir, { recursive: true })
      await mkdir(uploads, { recursive: true })

      const stem = (s: string) =>
        s
          .replace(/\.extract\.txt$/i, '')
          .replace(/\.(docx|pdf|txt|md)$/i, '')
          .replace(/^app\s+/i, '')
          .trim()

      const nameStem = stem(name || extract || source)

      /** Find original office file by path or fuzzy name under userData */
      const findOffice = async (): Promise<string | null> => {
        const tried: string[] = []
        const add = (p: string) => {
          if (p && existsSync(p) && /\.(docx|pdf)$/i.test(p)) tried.push(p)
        }
        add(source)
        if (extract) {
          const base = extract.replace(/\.extract\.txt$/i, '').replace(/\.txt$/i, '')
          add(base + '.docx')
          add(base + '.pdf')
        }
        // Search dirs by stem
        for (const dir of [uploads, ctxDir, legacy]) {
          try {
            const files = await readdir(dir)
            const lowerStem = nameStem.toLowerCase().slice(0, 48)
            for (const f of files) {
              if (!/\.(docx|pdf)$/i.test(f)) continue
              const fl = f.toLowerCase()
              if (
                (lowerStem && fl.includes(lowerStem.slice(0, 20))) ||
                (lowerStem && fl.startsWith(lowerStem.slice(0, 16)))
              ) {
                add(join(dir, f))
              }
            }
          } catch {
            /* */
          }
        }
        // Prefer longest path match / first hit
        return tried[0] || null
      }

      let office = await findOffice()

      // Default extract path in app-context (same name user sees)
      if (!extract) {
        const safe =
          (nameStem || 'documento').replace(/[^a-zA-Z0-9._\-\s]+/g, '_').slice(0, 80) +
          '.extract.txt'
        extract = join(ctxDir, safe)
      }

      let existingLen = 0
      if (extract && existsSync(extract)) {
        try {
          existingLen = (await readFile(extract, 'utf8')).length
        } catch {
          /* */
        }
      }

      if (office) {
        const r = await runDocReadToFile(office, extract)
        if (r.ok && r.path) {
          const diskText = await readFile(extract, 'utf8')
          const repaired = diskText.length > existingLen + 200
          return {
            ok: true,
            text: diskText.length > 2_000_000 ? diskText.slice(0, 2_000_000) : diskText,
            totalChars: diskText.length,
            extractPath: extract,
            sourcePath: office,
            repaired
          }
        }
        // keep old extract if re-extract failed
        if (existingLen > 100) {
          const t = await readFile(extract, 'utf8')
          return {
            ok: true,
            text: t.length > 2_000_000 ? t.slice(0, 2_000_000) : t,
            totalChars: t.length,
            extractPath: extract,
            sourcePath: office,
            repaired: false,
            error: r.error
          }
        }
        return { ok: false, error: r.error || 'extracción falló', sourcePath: office }
      }

      // No office: still return existing extract
      if (extract && existsSync(extract)) {
        const t = await readFile(extract, 'utf8')
        return {
          ok: true,
          text: t.length > 2_000_000 ? t.slice(0, 2_000_000) : t,
          totalChars: t.length,
          extractPath: extract,
          repaired: false,
          error: 'No se encontró el .docx/.pdf original en user-uploads; re-adjunta el archivo'
        }
      }
      return {
        ok: false,
        error:
          'No hay .docx/.pdf original ni extracto. Sube de nuevo el libro (se guarda en user-uploads + app-context).'
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
      kind: 'user' | 'context' | 'images' | 'wardrobe' | 'backups' | 'other'
      size: number
      mtimeMs: number
      isImage: boolean
    }>
    error?: string
  }> => {
    try {
      const { readdir, stat } = await import('fs/promises')
      const ud = app.getPath('userData')
      const roots: Array<{
        sub: string
        kind: 'user' | 'context' | 'images' | 'wardrobe' | 'backups' | 'other'
      }> = [
        { sub: 'user-uploads', kind: 'user' },
        { sub: 'chat-attachments', kind: 'user' },
        { sub: 'app-context', kind: 'context' },
        { sub: 'images', kind: 'images' },
        { sub: 'generated-images', kind: 'images' },
        { sub: 'wardrobe', kind: 'wardrobe' },
        { sub: 'backups', kind: 'backups' }
      ]
      const items: Array<{
        name: string
        path: string
        kind: 'user' | 'context' | 'images' | 'wardrobe' | 'backups' | 'other'
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

ipcMain.handle('files:deleteWardrobeImage', async (_e, filePath?: string) => {
  try {
    const { join, normalize, sep } = await import('path')
    const { unlink } = await import('fs/promises')
    const fp = String(filePath || '').trim()
    if (!fp) return { ok: false, error: 'sin path' }
    const ward = normalize(join(app.getPath('userData'), 'wardrobe'))
    const target = normalize(fp)
    if (!target.startsWith(ward + sep) && target !== ward) {
      return { ok: false, error: 'path fuera de wardrobe' }
    }
    await unlink(target)
    // best-effort backup twin
    try {
      const base = target.split(/[/\\]/).pop() || ''
      const bak = join(app.getPath('userData'), 'wardrobe-backup', base)
      await unlink(bak)
    } catch {
      /* */
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

/** A2 — Persist character visual sheet outside localStorage (survives quota). */
ipcMain.handle(
  'files:saveCharacterIdentity',
  async (
    _e,
    payload?: {
      visualDescription?: string
      visualFromAvatar?: boolean
      name?: string
      personality?: string
      style?: string
      tagline?: string
      relationshipRole?: string
      updatedAt?: number
    }
  ) => {
    try {
      const { join } = await import('path')
      const { mkdir, writeFile } = await import('fs/promises')
      const dir = join(app.getPath('userData'), 'identity')
      await mkdir(dir, { recursive: true })
      const filePath = join(dir, 'character-visual.json')
      const body = {
        visualDescription: String(payload?.visualDescription || ''),
        visualFromAvatar: payload?.visualFromAvatar === true,
        name: String(payload?.name || ''),
        personality: String(payload?.personality || ''),
        style: String(payload?.style || ''),
        tagline: String(payload?.tagline || ''),
        relationshipRole: String(payload?.relationshipRole || ''),
        updatedAt: payload?.updatedAt || Date.now()
      }
      await writeFile(filePath, JSON.stringify(body, null, 2), 'utf8')
      return { ok: true, path: filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

ipcMain.handle('files:loadCharacterIdentity', async () => {
  try {
    const { join } = await import('path')
    const { readFile } = await import('fs/promises')
    const filePath = join(app.getPath('userData'), 'identity', 'character-visual.json')
    if (!existsSync(filePath)) return { ok: true, missing: true }
    const raw = await readFile(filePath, 'utf8')
    const json = JSON.parse(raw) as {
      visualDescription?: string
      visualFromAvatar?: boolean
      name?: string
      personality?: string
      style?: string
      tagline?: string
      relationshipRole?: string
      updatedAt?: number
    }
    return {
      ok: true,
      visualDescription: String(json.visualDescription || ''),
      visualFromAvatar: json.visualFromAvatar === true,
      name: String(json.name || ''),
      personality: String(json.personality || ''),
      style: String(json.style || ''),
      tagline: String(json.tagline || ''),
      relationshipRole: String(json.relationshipRole || ''),
      updatedAt: json.updatedAt || 0,
      path: filePath
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})




ipcMain.handle(
  'files:saveUserVisualImage',
  async (
    _e,
    payload?: { fileName?: string; base64?: string; dataUrl?: string }
  ) => {
    try {
      const { join } = await import('path')
      const { mkdir, writeFile } = await import('fs/promises')
      const dir = join(app.getPath('userData'), 'user-visual')
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
      } else {
        return { ok: false, error: 'sin contenido' }
      }
      if (buf.length > 12 * 1024 * 1024) {
        return { ok: false, error: 'imagen demasiado grande (>12MB)' }
      }
      const rawName = (payload?.fileName || `user-${Date.now()}.${ext}`).replace(
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

ipcMain.handle('files:openUserVisualDir', async () => openUserDataSubdir('user-visual'))


/** A1 — describe a file under userData (text sample or image meta). */
ipcMain.handle(
  'files:describePath',
  async (
    _e,
    filePath?: string
  ): Promise<{
    ok: boolean
    summary?: string
    kind?: string
    size?: number
    mtimeMs?: number
    preview?: string
    error?: string
  }> => {
    try {
      const fp = String(filePath || '').trim()
      if (!fp) return { ok: false, error: 'Ruta vacía' }
      const allowed = resolveAllowedPath(fp)
      if (!allowed.ok) return { ok: false, error: allowed.error }
      const safePath = allowed.path
      if (!existsSync(safePath)) return { ok: false, error: 'Archivo no encontrado' }
      const { stat, readFile } = await import('fs/promises')
      const { basename, extname } = await import('path')
      const st = await stat(safePath)
      if (!st.isFile()) return { ok: false, error: 'No es un archivo' }
      const name = basename(safePath)
      const ext = extname(safePath).toLowerCase()
      const isImage = /\.(png|jpe?g|webp|gif)$/i.test(name)
      const isText =
        /\.(txt|md|json|csv|log|html?|xml|ts|tsx|js|jsx|py|css)$/i.test(name) ||
        ext === '.txt'
      let preview = ''
      if (isText && st.size < 2_000_000) {
        const buf = await readFile(safePath)
        preview = buf.toString('utf8').slice(0, 1200)
      } else if (isImage) {
        preview = `Imagen ${ext || ''} · ${Math.round(st.size / 1024)} KB · mtime ${new Date(st.mtimeMs).toISOString()}`
      } else if (/\.(docx|pdf)$/i.test(name)) {
        preview = `Documento Office/PDF · ${Math.round(st.size / 1024)} KB (usar lectura de documentos para el texto completo)`
      } else {
        preview = `Binario o tipo no texto · ${Math.round(st.size / 1024)} KB`
      }
      const summary =
        `«${name}» · ${Math.round(st.size / 1024)} KB · ${isImage ? 'imagen' : isText ? 'texto' : 'archivo'}` +
        (preview && !isImage ? ` · vista previa: ${preview.slice(0, 280).replace(/\s+/g, ' ')}` : preview ? ` · ${preview}` : '')
      return {
        ok: true,
        summary,
        kind: isImage ? 'image' : isText ? 'text' : 'file',
        size: st.size,
        mtimeMs: st.mtimeMs,
        preview: preview.slice(0, 1500)
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

/** A1 — heuristic classify under userData (no LLM required). */
ipcMain.handle(
  'files:classifyPath',
  async (
    _e,
    filePath?: string
  ): Promise<{
    ok: boolean
    category?: string
    tags?: string[]
    summary?: string
    error?: string
  }> => {
    try {
      const fp = String(filePath || '').trim()
      if (!fp) return { ok: false, error: 'Ruta vacía' }
      const allowed = resolveAllowedPath(fp)
      if (!allowed.ok) return { ok: false, error: allowed.error }
      const safePath = allowed.path
      if (!existsSync(safePath)) return { ok: false, error: 'Archivo no encontrado' }
      const { basename } = await import('path')
      const { stat } = await import('fs/promises')
      const name = basename(safePath)
      const st = await stat(safePath)
      const lower = name.toLowerCase()
      const tags: string[] = []
      let category = 'otro'
      if (/\.(png|jpe?g|webp|gif)$/i.test(lower)) {
        category = 'imagen'
        tags.push('imagen')
        if (/wardrobe|guardarropa|outfit|look/i.test(fp + name)) tags.push('guardarropa')
        if (/avatar|face|retrato|portrait/i.test(name)) tags.push('retrato')
        if (/scene|escena|fondo/i.test(name)) tags.push('escena')
      } else if (/\.(docx|pdf|txt|md)$/i.test(lower)) {
        category = 'documento'
        tags.push('documento')
        if (/libro|book|cap[ií]tulo|novel/i.test(name)) tags.push('libro')
      } else if (/\.(mp3|wav|ogg|flac)$/i.test(lower)) {
        category = 'audio'
        tags.push('audio')
      } else if (/\.(json)$/i.test(lower)) {
        category = 'datos'
        tags.push('json')
        if (/backup|memory|chat/i.test(name)) tags.push('respaldo')
      } else if (/\.(ts|tsx|js|py)$/i.test(lower)) {
        category = 'código'
        tags.push('código')
      }
      if (/backup/i.test(fp)) tags.push('backup')
      if (/upload|adjunto/i.test(fp)) tags.push('subida-usuario')
      if (/app-context|context/i.test(fp)) tags.push('contexto-app')
      const summary = `Clasificación: ${category} · tags: ${tags.join(', ') || '—'} · ${Math.round(st.size / 1024)} KB`
      return { ok: true, category, tags, summary }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)



/**
 * G1/P0 — path must stay under userData (or trustedFileRoots).
 * Delimiter-safe prefix + realpath when possible (symlink/junction).
 */
function resolveAllowedPath(
  filePath: string,
  extraRoots?: string[]
): { ok: true; path: string } | { ok: false; error: string } {
  const ud = app.getPath('userData')
  const r = assertPathAllowed(filePath, ud, extraRoots)
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, path: r.path }
}

/** @deprecated use resolveAllowedPath */
function resolveUnderUserData(filePath: string, extraRoots?: string[]) {
  return resolveAllowedPath(filePath, extraRoots)
}

async function appendFileAudit(line: string): Promise<void> {
  try {
    const { appendFile, mkdir } = await import('fs/promises')
    const dir = join(app.getPath('userData'), 'backups')
    await mkdir(dir, { recursive: true })
    await appendFile(
      join(dir, 'file-audit.log'),
      `${new Date().toISOString()} ${line}\n`,
      'utf8'
    )
  } catch {
    /* best-effort */
  }
}


/** G1: short-lived mutation tickets issued by main (not a free confirm from renderer). */
type MutationTicket = {
  id: string
  op: string
  path: string
  dest?: string
  newName?: string
  exp: number
}
const mutationTickets = new Map<string, MutationTicket>()

function ticketKey(t: Omit<MutationTicket, 'id' | 'exp'>): string {
  return `${t.op}|${t.path}|${t.dest || ''}|${t.newName || ''}`.toLowerCase()
}

function issueMutationTicket(parts: {
  op: string
  path: string
  dest?: string
  newName?: string
}): { ok: true; ticket: string; expiresAt: number } | { ok: false; error: string } {
  const pathR = resolveAllowedPath(parts.path)
  if (!pathR.ok) return { ok: false, error: pathR.error }
  if (parts.dest) {
    const d = resolveAllowedPath(parts.dest)
    if (!d.ok) return { ok: false, error: d.error }
  }
  const id = `mt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const exp = Date.now() + 120_000
  mutationTickets.set(id, {
    id,
    op: parts.op,
    path: pathR.path,
    dest: parts.dest,
    newName: parts.newName,
    exp
  })
  // prune
  for (const [k, v] of mutationTickets) {
    if (v.exp < Date.now()) mutationTickets.delete(k)
  }
  return { ok: true, ticket: id, expiresAt: exp }
}

function consumeMutationTicket(
  ticket: string | undefined,
  op: string,
  path: string,
  dest?: string,
  newName?: string
): { ok: true } | { ok: false; error: string } {
  if (!ticket) return { ok: false, error: 'Falta ticket de mutación' }
  const t = mutationTickets.get(ticket)
  if (!t) return { ok: false, error: 'Ticket inválido o ya usado' }
  if (t.exp < Date.now()) {
    mutationTickets.delete(ticket)
    return { ok: false, error: 'Ticket expirado' }
  }
  const pathR = resolveAllowedPath(path)
  if (!pathR.ok) return { ok: false, error: pathR.error }
  if (t.op !== op || t.path !== pathR.path) {
    return { ok: false, error: 'Ticket no corresponde a esta operación/ruta' }
  }
  if ((t.newName || '') !== (newName || '')) {
    return { ok: false, error: 'Ticket no corresponde al newName' }
  }
  mutationTickets.delete(ticket)
  return { ok: true }
}

ipcMain.handle(
  'files:issueMutationTicket',
  async (
    _e,
    payload?: { op?: string; path?: string; dest?: string; newName?: string }
  ) => {
    try {
      const op = String(payload?.op || '').trim()
      if (!['copy', 'move', 'rename', 'trash'].includes(op)) {
        return { ok: false, error: 'op inválida' }
      }
      return issueMutationTicket({
        op,
        path: String(payload?.path || ''),
        dest: payload?.dest ? String(payload.dest) : undefined,
        newName: payload?.newName ? String(payload.newName) : undefined
      })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
)


/**
 * A2 mutations: copy | move | rename | trash
 * Requires confirm:true unless dryRun:true (preview only).
 */
ipcMain.handle(
  'files:mutatePath',
  async (
    _e,
    payload?: {
      op?: 'copy' | 'move' | 'rename' | 'trash'
      path?: string
      dest?: string
      newName?: string
      confirm?: boolean
      dryRun?: boolean
      ticket?: string
      trustedRoots?: string[]
    }
  ): Promise<{ ok: boolean; summary?: string; error?: string; dryRun?: boolean }> => {
    try {
      const op = String(payload?.op || '').trim() as 'copy' | 'move' | 'rename' | 'trash'
      if (!['copy', 'move', 'rename', 'trash'].includes(op)) {
        return { ok: false, error: 'op debe ser copy|move|rename|trash' }
      }
      const roots = Array.isArray(payload?.trustedRoots) ? payload!.trustedRoots : []
      const srcR = resolveAllowedPath(String(payload?.path || ''), roots)
      if (!srcR.ok) return { ok: false, error: srcR.error }
      const src = srcR.path
      if (!existsSync(src)) return { ok: false, error: 'Origen no existe' }

      const dry = Boolean(payload?.dryRun)
      const ticket = payload?.ticket ? String(payload.ticket) : ''
      if (!dry) {
        const tk = consumeMutationTicket(
          ticket,
          op,
          src,
          payload?.dest ? String(payload.dest) : undefined,
          payload?.newName ? String(payload.newName) : undefined
        )
        if (!tk.ok) {
          return {
            ok: false,
            error:
              (tk.error || 'Ticket requerido') +
              ' · files:issueMutationTicket tras aprobación UI'
          }
        }
      }

      const { basename, dirname, join: pjoin } = await import('path')
      const { copyFile, rename, mkdir } = await import('fs/promises')

      if (op === 'trash') {
        const summary = `Papelera SO: ${basename(src)}`
        if (dry) return { ok: true, summary: `[dry-run] ${summary}`, dryRun: true }
        await shell.trashItem(src)
        await appendFileAudit(`TRASH ${src}`)
        return { ok: true, summary }
      }

      if (op === 'rename') {
        const nn = String(payload?.newName || '').trim()
        if (!nn || /[\\/]/.test(nn) || nn === '.' || nn === '..') {
          return { ok: false, error: 'newName inválido (solo nombre, sin rutas)' }
        }
        const dest = pjoin(dirname(src), nn)
        const destR = resolveAllowedPath(dest, roots)
        if (!destR.ok) return { ok: false, error: destR.error }
        if (existsSync(destR.path)) return { ok: false, error: 'Ya existe un archivo con ese nombre' }
        const summary = `Renombrar «${basename(src)}» → «${nn}»`
        if (dry) return { ok: true, summary: `[dry-run] ${summary}`, dryRun: true }
        await rename(src, destR.path)
        await appendFileAudit(`RENAME ${src} -> ${destR.path}`)
        return { ok: true, summary }
      }

      // copy | move
      const destIn = String(payload?.dest || '').trim()
      if (!destIn) return { ok: false, error: 'Falta dest' }
      let destPath = destIn
      // If dest is a directory under userData, keep basename
      try {
        const { stat } = await import('fs/promises')
        if (existsSync(destIn)) {
          const st = await stat(destIn)
          if (st.isDirectory()) destPath = pjoin(destIn, basename(src))
        }
      } catch {
        /* */
      }
      const destR = resolveAllowedPath(destPath, roots)
      if (!destR.ok) return { ok: false, error: destR.error }
      if (existsSync(destR.path) && destR.path !== src) {
        return { ok: false, error: 'Destino ya existe' }
      }
      const summary =
        op === 'copy'
          ? `Copiar «${basename(src)}» → ${destR.path}`
          : `Mover «${basename(src)}» → ${destR.path}`
      if (dry) return { ok: true, summary: `[dry-run] ${summary}`, dryRun: true }
      await mkdir(dirname(destR.path), { recursive: true })
      if (op === 'copy') {
        await copyFile(src, destR.path)
        await appendFileAudit(`COPY ${src} -> ${destR.path}`)
      } else {
        await rename(src, destR.path)
        await appendFileAudit(`MOVE ${src} -> ${destR.path}`)
      }
      return { ok: true, summary }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

/** Read small image as dataUrl for vision describe (cap ~4MB file). */

/** A4 — read text file under allowed roots (max ~200KB). */
ipcMain.handle(
  'files:readTextFileAllowed',
  async (
    _e,
    payload?: { path?: string; trustedRoots?: string[]; maxChars?: number }
  ): Promise<{ ok: boolean; text?: string; error?: string; path?: string }> => {
    try {
      const roots = Array.isArray(payload?.trustedRoots) ? payload!.trustedRoots : []
      const srcR = resolveAllowedPath(String(payload?.path || ''), roots)
      if (!srcR.ok) return { ok: false, error: srcR.error }
      const { readFile, stat } = await import('fs/promises')
      const st = await stat(srcR.path)
      if (!st.isFile() || st.size > 400_000) {
        return { ok: false, error: 'Archivo demasiado grande o no texto (máx ~400KB)' }
      }
      const max = Math.min(200_000, Math.max(1000, payload?.maxChars || 80_000))
      const buf = await readFile(srcR.path)
      const text = buf.toString('utf8').slice(0, max)
      return { ok: true, text, path: srcR.path }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

/**
 * A4 — apply full text write under allowed roots (confirm required).
 * Prefer sending complete new content after user reviewed diff in UI/chat.
 */
ipcMain.handle(
  'files:writeTextFileAllowed',
  async (
    _e,
    payload?: {
      path?: string
      content?: string
      confirm?: boolean
      dryRun?: boolean
      trustedRoots?: string[]
    }
  ): Promise<{ ok: boolean; summary?: string; error?: string; dryRun?: boolean }> => {
    try {
      const roots = Array.isArray(payload?.trustedRoots) ? payload!.trustedRoots : []
      const srcR = resolveAllowedPath(String(payload?.path || ''), roots)
      if (!srcR.ok) return { ok: false, error: srcR.error }
      if (!existsSync(srcR.path)) return { ok: false, error: 'Archivo no existe' }
      const content = String(payload?.content ?? '')
      if (content.length > 500_000) return { ok: false, error: 'Contenido demasiado grande' }
      const dry = Boolean(payload?.dryRun)
      if (!dry && !payload?.confirm) {
        return { ok: false, error: 'Se requiere confirm:true o dryRun:true' }
      }
      const { basename } = await import('path')
      const summary = `Escribir «${basename(srcR.path)}» (${content.length} chars)`
      if (dry) return { ok: true, summary: `[dry-run] ${summary}`, dryRun: true }
      const { writeFile } = await import('fs/promises')
      await writeFile(srcR.path, content, 'utf8')
      await appendFileAudit(`WRITE ${srcR.path} chars=${content.length}`)
      return { ok: true, summary }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

ipcMain.handle(
  'files:readDataUrl',
  async (
    _e,
    filePath?: string
  ): Promise<{ ok: boolean; dataUrl?: string; error?: string }> => {
    try {
      const srcR = resolveUnderUserData(String(filePath || ''))
      // Also allow wardrobe etc already under userData via resolve
      if (!srcR.ok) {
        // fallback: any path under userData via resolveUnderUserData only
        return { ok: false, error: srcR.error }
      }
      const { readFile, stat } = await import('fs/promises')
      const { extname } = await import('path')
      const st = await stat(srcR.path)
      if (!st.isFile() || st.size > 4_500_000) {
        return { ok: false, error: 'Archivo demasiado grande o no es archivo (máx ~4.5MB)' }
      }
      const ext = extname(srcR.path).toLowerCase().replace('.', '')
      if (!/^(png|jpe?g|webp|gif)$/i.test(ext)) {
        return { ok: false, error: 'Solo imágenes png/jpg/webp/gif' }
      }
      const mime =
        ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
      const buf = await readFile(srcR.path)
      return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)


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

ipcMain.handle('files:saveMemoryArchive', async (_e, payload?: { kind?: string; data?: unknown }) => {
  try {
    const dir = join(app.getPath('userData'), 'memory-archive')
    await mkdir(dir, { recursive: true })
    const kind = String(payload?.kind || 'user').replace(/[^a-z0-9_-]/gi, '') || 'user'
    const filePath = join(dir, `${kind}-full.json`)
    const body = JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        kind,
        data: payload?.data ?? {}
      },
      null,
      2
    )
    await writeFile(filePath, body, 'utf8')
    return { ok: true, filePath, rel: `memory-archive/${kind}-full.json` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('files:loadMemoryArchive', async (_e, kind?: string) => {
  try {
    const k = String(kind || 'user').replace(/[^a-z0-9_-]/gi, '') || 'user'
    const filePath = join(app.getPath('userData'), 'memory-archive', `${k}-full.json`)
    const raw = await readFile(filePath, 'utf8')
    return { ok: true, filePath, data: JSON.parse(raw) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('files:openMemoryArchiveDir', async () => openUserDataSubdir('memory-archive'))



ipcMain.handle(
  'backup:exportFull',
  async (
    _e,
    payload?: {
      settings?: unknown
      character?: unknown
      chats?: unknown
      memory?: unknown
      primary?: { chatPrimaryPath?: string }
      appVersion?: string
      openAfter?: boolean
    }
  ) => {
    try {
      const { cp, mkdir, writeFile, readdir } = await import('fs/promises')
      const { join, basename } = await import('path')
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const defaultRoot = join(app.getPath('userData'), 'backups')
      await mkdir(defaultRoot, { recursive: true })
      const suggested = join(defaultRoot, `kawaii-full-${stamp}`)

      let destDir = suggested
      try {
        const picked = await dialog.showOpenDialog({
          title: 'Carpeta para el respaldo completo (se creará subcarpeta kawaii-full-…)',
          properties: ['openDirectory', 'createDirectory'],
          defaultPath: defaultRoot
        })
        if (!picked.canceled && picked.filePaths[0]) {
          destDir = join(picked.filePaths[0], `kawaii-full-${stamp}`)
        }
      } catch {
        destDir = suggested
      }

      await mkdir(destDir, { recursive: true })
      const wardrobeSrc = join(app.getPath('userData'), 'wardrobe')
      const wardrobeDest = join(destDir, 'wardrobe')
      let wardrobeFiles = 0
      if (existsSync(wardrobeSrc)) {
        await cp(wardrobeSrc, wardrobeDest, { recursive: true })
        try {
          const names = await readdir(wardrobeDest)
          wardrobeFiles = names.filter((n) => /\.(png|jpe?g|webp|gif)$/i.test(n)).length
        } catch {
          /* */
        }
      } else {
        await mkdir(wardrobeDest, { recursive: true })
      }

      const parts = [
        'manifest.json',
        'settings.json',
        'character.json',
        'chats.json',
        'memory.json',
        'primary.json',
        'wardrobe/'
      ]
      const manifest = {
        format: 'kawaii-full-backup',
        version: 1,
        appVersion: payload?.appVersion || '0.12.0-beta',
        createdAt: new Date().toISOString(),
        label: basename(destDir),
        parts,
        wardrobeFiles,
        notes: [
          'Copia esta carpeta entera para migrar a otro PC.',
          'En la app: Importar respaldo completo y elige esta carpeta.',
          'Las fotos están en wardrobe/; no borres esa subcarpeta.'
        ]
      }
      const write = async (name: string, data: unknown) => {
        await writeFile(join(destDir, name), JSON.stringify(data, null, 2), 'utf8')
      }
      await write('manifest.json', manifest)
      await write('settings.json', payload?.settings ?? {})
      await write('character.json', payload?.character ?? {})
      await write('chats.json', payload?.chats ?? {})
      await write('memory.json', payload?.memory ?? {})
      await write('primary.json', payload?.primary ?? {})

      if (payload?.openAfter !== false) {
        try {
          await shell.openPath(destDir)
        } catch {
          /* */
        }
      }
      return { ok: true, path: destDir, wardrobeFiles, manifest }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
)

ipcMain.handle('backup:importFull', async (_e, dirPath?: string) => {
  try {
    const { readFile, readdir, cp, mkdir } = await import('fs/promises')
    const { join } = await import('path')
    let root = String(dirPath || '').trim()
    if (!root) {
      const picked = await dialog.showOpenDialog({
        title: 'Selecciona la carpeta del respaldo completo (kawaii-full-…)',
        properties: ['openDirectory']
      })
      if (picked.canceled || !picked.filePaths[0]) {
        return { ok: false, error: 'cancelado' }
      }
      root = picked.filePaths[0]
    }
    if (!existsSync(root)) return { ok: false, error: 'carpeta no existe' }

    const readJson = async (name: string) => {
      const fp = join(root, name)
      if (!existsSync(fp)) return null
      return JSON.parse(await readFile(fp, 'utf8'))
    }
    const manifest = await readJson('manifest.json')
    if (!manifest || manifest.format !== 'kawaii-full-backup') {
      return { ok: false, error: 'No es un respaldo Kawaii completo (falta manifest.json)' }
    }
    const settings = await readJson('settings.json')
    const character = await readJson('character.json')
    const chats = await readJson('chats.json')
    const memory = await readJson('memory.json')
    const primary = await readJson('primary.json')

    const wardrobeSrc = join(root, 'wardrobe')
    const wardrobeDest = join(app.getPath('userData'), 'wardrobe')
    let wardrobeCopied = 0
    if (existsSync(wardrobeSrc)) {
      await mkdir(wardrobeDest, { recursive: true })
      try {
        const names = await readdir(wardrobeSrc)
        for (const n of names) {
          if (!/\.(png|jpe?g|webp|gif)$/i.test(n)) continue
          try {
            await cp(join(wardrobeSrc, n), join(wardrobeDest, n))
            wardrobeCopied++
          } catch {
            /* */
          }
        }
      } catch {
        /* */
      }
    }
    return {
      ok: true,
      path: root,
      manifest,
      settings,
      character,
      chats,
      memory,
      primary,
      wardrobeCopied
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('backup:openBackupsDir', async () => {
  try {
    const { mkdir } = await import('fs/promises')
    const dir = join(app.getPath('userData'), 'backups')
    await mkdir(dir, { recursive: true })
    await shell.openPath(dir)
    return { ok: true, path: dir }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})


/** Persist memory-write audit lines under userData/backups (testable on disk). */
ipcMain.handle(
  'memory:appendWriteLog',
  async (_e, entry?: Record<string, unknown>) => {
    try {
      const { appendFile, mkdir } = await import('fs/promises')
      const dir = join(app.getPath('userData'), 'backups')
      await mkdir(dir, { recursive: true })
      const line = JSON.stringify({ ...entry, at: entry?.at || Date.now() }) + '\n'
      await appendFile(join(dir, 'memory-write.log'), line, 'utf8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)
