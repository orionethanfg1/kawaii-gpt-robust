/**
 * Image IPC: health, models, folders, cancel, cleanup (non-generate).
 * Extracted from image-ipc.ts to shrink the generate host module.
 */
import { app, ipcMain, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { listControlNetModels } from './image-a1111'

/** Set in main/index via electron-store; same process as generate handler */
function secureStoreGet(k: string, d = ""): string {
  try {
    const s = (globalThis as { __kawaiiSecureStore?: { get: (a: string, b?: string) => unknown } }).__kawaiiSecureStore
    return String(s?.get(k, d) ?? d ?? "")
  } catch {
    return d
  }
}

export type ImageAbortMap = Map<string, AbortController>

export function registerImageMetaIpc(opts: {
  ensureImagesDir: () => Promise<string>
  imageAbortControllers: ImageAbortMap
}): void {
  const { ensureImagesDir, imageAbortControllers } = opts

ipcMain.handle('image:a1111Health', async (_e, baseUrl?: string) => {
  const start = Date.now()
  try {
    const { probeForgeHealth, scanForgeApiPorts, getForgeRuntimeStatus, refreshForgeHealth } =
      await import('./forge-runtime')

    // Prefer explicit URL, then runtime, then scan
    const candidates: string[] = []
    if (baseUrl) candidates.push(baseUrl.replace(/\/$/, ''))
    try {
      const st = getForgeRuntimeStatus()
      if (st.baseUrl) candidates.push(st.baseUrl.replace(/\/$/, ''))
    } catch {
      /* ignore */
    }
    // Always probe the full candidate list — settings may point at a dead port (e.g. 7890)
    try {
      const { FORGE_PORT_CANDIDATES } = await import('./forge-runtime')
      for (const p of FORGE_PORT_CANDIDATES) {
        candidates.push(`http://127.0.0.1:${p}`, `http://localhost:${p}`)
      }
    } catch {
      candidates.push('http://127.0.0.1:7860', 'http://localhost:7860')
    }

    let uiOnlyHint = ''
    let lastProbeErr = ''
    for (const root of [...new Set(candidates)]) {
      const h = await probeForgeHealth(root, 4500)
      if (h.ok) {
        try {
          await refreshForgeHealth()
        } catch {
          /* ignore */
        }
        return {
          ok: true,
          latencyMs: Date.now() - start,
          baseUrl: h.baseUrl || root,
          error: undefined
        }
      }
      lastProbeErr = h.error || lastProbeErr
      if ((h as { uiOnly?: boolean }).uiOnly) {
        uiOnlyHint =
          h.error ||
          'UI de Forge sin --api (txt2img 404). Cierra esa ventana y pulsa Arrancar Forge en la app.'
      }
    }

    const scan = await scanForgeApiPorts()
    if (scan.ok && scan.baseUrl) {
      try {
        await refreshForgeHealth()
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        latencyMs: Date.now() - start,
        baseUrl: scan.baseUrl
      }
    }
    if (uiOnlyHint) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: uiOnlyHint
      }
    }
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error:
        scan.error ||
        lastProbeErr ||
        'Forge/A1111 no responde. Capas → Arrancar Forge (API --nowebui) y espera a que health sea OK.'
    }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err)
    }
  }
})


ipcMain.handle('image:controlNetModels', async (_e, baseUrl?: string) => {
  try {
    const root = (baseUrl || process.env.A1111_BASE_URL || 'http://127.0.0.1:7860').replace(/\/$/, '')
    const models = await listControlNetModels(root, AbortSignal.timeout(8000))
    return { ok: true as const, models }
  } catch (e) {
    return {
      ok: false as const,
      models: [] as string[],
      error: e instanceof Error ? e.message : String(e)
    }
  }
})

ipcMain.handle('image:a1111Models', async (_e, baseUrl?: string) => {
  let root = (baseUrl || '').replace(/\/$/, '')
  if (!root) {
    try {
      const { getForgeRuntimeStatus } = await import('./forge-runtime')
      const st = getForgeRuntimeStatus()
      if (st.baseUrl) root = st.baseUrl.replace(/\/$/, '')
    } catch {
      /* ignore */
    }
  }
  if (!root) root = 'http://127.0.0.1:7860'

  const fromDisk = async () => {
    try {
      const { listInstalledCheckpoints } = await import('./sd-workspace')
      const installed = await listInstalledCheckpoints()
      return installed.map((m) => ({
        title: m.filename,
        modelName: m.filename,
        hash: undefined as string | undefined
      }))
    } catch {
      return [] as { title: string; modelName: string; hash: string | undefined }[]
    }
  }

  try {
    // Prefer disk: Forge /sd-models often 500 (pydantic config field) and floods logs
    {
      const diskFirst = await fromDisk()
      if (diskFirst.length > 0) {
        let current = ''
        try {
          const oc = new AbortController()
          const ot = setTimeout(() => oc.abort(), 3000)
          const optRes = await fetch(`${root}/sdapi/v1/options`, { signal: oc.signal })
          clearTimeout(ot)
          if (optRes.ok) {
            const opt = (await optRes.json()) as { sd_model_checkpoint?: string }
            current = opt.sd_model_checkpoint || ''
          }
        } catch {
          /* ignore */
        }
        return {
          ok: true,
          models: diskFirst,
          current,
          baseUrl: root,
          note: 'listado desde disco'
        }
      }
    }
    const paths = [`${root}/sdapi/v1/sd-models`]
    let lastErr = ''
    for (const url of paths) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        const res = await fetch(url, { signal: controller.signal })
        clearTimeout(timer)
        // Forge may return 500 on sd-models (pydantic "config" required) — still try body or disk
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`
          if (res.status >= 500) {
            try {
              const text = await res.text()
              // Fall through to disk list when API serialization is broken
              if (text.includes('config') || text.includes('ResponseValidationError')) {
                const disk = await fromDisk()
                if (disk.length) {
                  return { ok: true, models: disk, current: '', baseUrl: root, note: 'listado desde disco (sd-models 500)' }
                }
              }
            } catch {
              /* ignore */
            }
          }
          continue
        }
        const raw = (await res.json()) as Array<{
          title?: string
          model_name?: string
              hash?: string
          filename?: string
        }>
        let models = (Array.isArray(raw) ? raw : []).map((m) => ({
          title: String(m.title || m.model_name || m.filename || 'unknown'),
          modelName: String(m.model_name || m.title || ''),
          hash: m.hash ? String(m.hash) : undefined
        }))
        if (models.length === 0) {
          models = await fromDisk()
        }
        let current = ''
        try {
          const oc = new AbortController()
          const ot = setTimeout(() => oc.abort(), 3000)
          const optRes = await fetch(`${root}/sdapi/v1/options`, { signal: oc.signal })
          clearTimeout(ot)
          if (optRes.ok) {
            const opt = (await optRes.json()) as { sd_model_checkpoint?: string }
            current = opt.sd_model_checkpoint || ''
          }
        } catch {
          /* ignore */
        }
        return { ok: true as const, models, current }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }
    // API 404 / unreachable — still list checkpoints on disk so UI is useful
    const disk = await fromDisk()
    if (disk.length > 0) {
      return {
        ok: true as const,
        models: disk,
        current: '',
        note: lastErr ? `API: ${lastErr}; listando disco` : undefined
      }
    }
    return {
      ok: false as const,
      error: lastErr || 'Sin modelos',
      models: [] as { title: string; modelName: string }[]
    }
  } catch (err) {
    const disk = await fromDisk()
    if (disk.length > 0) {
      return { ok: true as const, models: disk, current: '' }
    }
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
      models: [] as { title: string; modelName: string }[]
    }
  }
})

ipcMain.handle('image:cloudflareProbe', async (_e, accountId?: string) => {
  try {
    const { probeCloudflareAi } = await import('./cloudflare-image')
    const acc = (accountId || '').trim()
    const token = String(secureStoreGet('providerKey:cloudflare', '') || '')
    if (!acc || !token) {
      return { ok: false, error: 'Configura Account ID y Token' }
    }
    return await probeCloudflareAi(acc, token)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('image:getFolder', async () => {
  try {
    const dir = await ensureImagesDir()
    return { ok: true, path: dir }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('image:openFolder', async () => {
  try {
    const dir = await ensureImagesDir()
    await shell.openPath(dir)
    return { ok: true, path: dir }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('image:showInFolder', async (_e, filePath?: string) => {
  try {
    if (filePath && existsSync(filePath)) {
      shell.showItemInFolder(filePath)
      return { ok: true }
    }
    const dir = await ensureImagesDir()
    await shell.openPath(dir)
    return { ok: true, path: dir }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('image:cancel', (_e, jobId?: string) => {
  if (jobId && imageAbortControllers.has(jobId)) {
    imageAbortControllers.get(jobId)?.abort()
    imageAbortControllers.delete(jobId)
    return { ok: true }
  }
  for (const [, c] of imageAbortControllers) c.abort()
  imageAbortControllers.clear()
  return { ok: true }
})

ipcMain.handle('image:cleanup', async (_e, maxAgeDays = 30) => {
  try {
    const { readdir, stat, unlink } = await import('fs/promises')
    const dir = join(app.getPath('userData'), 'images')
    if (!existsSync(dir)) return { ok: true, removed: 0 }
    const cutoff = Date.now() - maxAgeDays * 86400_000
    let removed = 0
    for (const name of await readdir(dir)) {
      const fp = join(dir, name)
      try {
        const st = await stat(fp)
        if (st.isFile() && st.mtimeMs < cutoff) {
          await unlink(fp)
          removed++
        }
      } catch {
        /* skip */
      }
    }
    return { ok: true, removed }
  } catch (err) {
    return {
      ok: false,
      removed: 0,
      error: err instanceof Error ? err.message : String(err)
    }
  }
})

ipcMain.handle('image:ensureLocalPipeline', async (_e, preferredPort?: number) => {
  try {
    const { ensureLocalImagePipeline } = await import('./forge-runtime')
    return await ensureLocalImagePipeline({ preferredPort })
  } catch (err) {
    return {
      ok: false,
      baseUrl: null,
      port: null,
      modelsCount: 0,
      synced: { copied: [], skipped: [] },
      message: err instanceof Error ? err.message : String(err)
    }
  }
})
}
