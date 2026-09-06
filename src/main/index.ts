import { app, BrowserWindow, shell, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { arch, cpus, totalmem } from 'os'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import Store from 'electron-store'
import {
  ensureSdWorkspace,
  openSdWorkspace,
  listLocalCheckpoints,
  downloadCheckpoint,
  syncCheckpointsToForge
} from './sd-workspace'
import {
  ensureMachineProfile,
  setDataRoot,
  clearMachineProfile,
  loadMachineProfile,
  ensureDataRootWorkspace,
  detectForgePresent,
  listDrives
} from './machine-profile'
import {
  installForgePortable,
  cancelForgeInstall,
  pauseForgeInstall,
  openForgeFolder,
  FORGE_PACK,
  getForgeDownloadJob,
  listInstallRecoveryJobs
} from './forge-installer'
import {
  startForgeRuntime,
  stopForgeRuntime,
  getForgeRuntimeStatus,
  refreshForgeHealth,
  pickForgePort,
  FORGE_PORT_CANDIDATES,
  ensureLocalImagePipeline,
  getForgeLogPath,
  getForgeLogTail
} from './forge-runtime'
import * as gitSync from './git-sync'
import { refreshModelCatalog } from './model-catalog-runtime'

const windowStore = new Store<{ windowBounds: Electron.Rectangle }>({
  name: 'window-state'
})
const secureStore = new Store<Record<string, string>>({
  name: 'secure-settings'
})

let mainWindowRef: BrowserWindow | null = null

type SystemHardwareProfile = {
  totalMemoryGB: number
  cpuCores: number
  architecture: string
  /** Best-effort; may be null if undetectable */
  gpuName?: string | null
  vramGB?: number | null
  hasDiscreteGpu?: boolean | null
}

function resolveResourcePath(...segments: string[]): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', ...segments)
  }
  return join(__dirname, '../../resources', ...segments)
}

function createWindow(): void {
  const saved = windowStore.get('windowBounds', {
    width: 1180,
    height: 780
  } as Electron.Rectangle)

  const iconPng = resolveResourcePath('icon.png')
  const iconIco = resolveResourcePath('icon.ico')
  let appIcon = nativeImage.createFromPath(iconPng)
  if (appIcon.isEmpty()) {
    appIcon = nativeImage.createFromPath(iconIco)
  }

  const mainWindow = new BrowserWindow({
    width: saved.width ?? 1180,
    height: saved.height ?? 780,
    x: saved.x,
    y: saved.y,
    minWidth: 860,
    minHeight: 600,
    show: true,
    autoHideMenuBar: true,
    title: 'KawaiiGPT Robust',
    backgroundColor: '#FFF8F0',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindowRef = mainWindow

  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) mainWindowRef = null
  })

  const saveBounds = (): void => {
    if (!mainWindow.isDestroyed()) {
      windowStore.set('windowBounds', mainWindow.getBounds())
    }
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[renderer did-fail-load]', code, desc, url)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', details)
  })
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error('[renderer]', message, sourceId + ':' + line)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url)
  }
})


ipcMain.handle('sd:ensureWorkspace', async () => {
  return ensureSdWorkspace()
})

ipcMain.handle('music:ensureWorkspace', async () => {
  try {
    const { ensureMusicWorkspace } = await import('./music-workspace')
    return { ok: true, ...(await ensureMusicWorkspace()) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('music:status', async () => {
  try {
    const { getMusicStatusSnapshot } = await import('./music-workspace')
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
    const { loadMusicState } = await import('./music-workspace')
    const state = await loadMusicState()
    return { ok: true, eligibility: state.eligibility, state }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('music:install', async (_e, opts?: { forceAce?: boolean; forceYue?: boolean }) => {
  try {
    const { installMusicStack } = await import('./music-installer')
    return await installMusicStack(opts || {})
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('music:installCancel', async () => {
  try {
    const { cancelMusicInstall } = await import('./music-installer')
    cancelMusicInstall()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})


ipcMain.handle('music:setup', async () => {
  try {
    const { ensureAceEnvironment } = await import('./music-runtime')
    return await ensureAceEnvironment()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('music:start', async (_e, preferredPort?: number) => {
  try {
    const { startMusicRuntime } = await import('./music-runtime')
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
    const { stopMusicRuntime } = await import('./music-runtime')
    return await stopMusicRuntime()
  } catch (err) {
    return { state: 'error', message: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('music:runtimeStatus', async () => {
  try {
    const { getMusicRuntimeStatus } = await import('./music-runtime')
    return getMusicRuntimeStatus()
  } catch {
    return { state: 'stopped', port: null, baseUrl: null, message: 'N/A', backend: 'none' }
  }
})

ipcMain.handle('music:ensureReady', async (_e, preferredPort?: number) => {
  try {
    const { ensureMusicReady } = await import('./music-runtime')
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

ipcMain.handle('music:generate', async (_e, req?: {
  prompt?: string
  lyrics?: string
  durationSec?: number
  vocalLanguage?: string
}) => {
  try {
    const { generateMusicTrack } = await import('./music-runtime')
    return await generateMusicTrack({
      prompt: String(req?.prompt || '').trim() || 'instrumental ambient',
      lyrics: req?.lyrics,
      durationSec: req?.durationSec,
      vocalLanguage: req?.vocalLanguage
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})


ipcMain.handle('sd:openWorkspace', async () => {
  await openSdWorkspace()
  return true
})
ipcMain.handle('sd:listCheckpoints', async () => {
  return listLocalCheckpoints()
})
ipcMain.handle('sd:listCheckpointsCatalog', async () => {
  try {
    const { getCheckpointCatalog } = await import('./sd-workspace')
    return { ok: true, models: getCheckpointCatalog() }
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('sd:discardJob', async (_e, modelId?: string) => {
  try {
    if (!modelId) return { ok: false, error: 'Sin id' }
    const { getCheckpointCatalog, resolveSdModelsDir } = await import('./sd-workspace')
    const { clearDownloadJob } = await import('./resumable-download')
    const { join } = await import('path')
    const { unlink } = await import('fs/promises')
    const { existsSync } = await import('fs')
    const entry = getCheckpointCatalog().find((c) => c.id === modelId)
    const modelsDir = await resolveSdModelsDir()
    const filename = entry?.filename || `${modelId}.safetensors`
    const dest = join(modelsDir, filename)
    const partial = `${dest}.partial`
    await clearDownloadJob(dest)
    for (const p of [partial, dest + '.download.json']) {
      if (existsSync(p)) {
        try {
          await unlink(p)
        } catch {
          /* ignore */
        }
      }
    }
    // Also clear any .download.json whose id matches
    try {
      const { listRecoveryJobs } = await import('./resumable-download')
      const jobs = await listRecoveryJobs(modelsDir)
      for (const j of jobs) {
        if (j.id === modelId || (j.label && j.label.includes(modelId))) {
          await clearDownloadJob(j.dest)
          if (existsSync(j.partial)) {
            try {
              await unlink(j.partial)
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
})

ipcMain.handle('sd:listInstalled', async () => {
  try {
    const { listInstalledCheckpoints } = await import('./sd-workspace')
    const models = await listInstalledCheckpoints()
    return { ok: true, models }
  } catch (err) {
    return {
      ok: false,
      models: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
})

ipcMain.handle('sd:listRecovery', async () => {
  try {
    const { listSdDownloadRecovery } = await import('./sd-workspace')
    const jobs = await listSdDownloadRecovery()
    return { ok: true, jobs }
  } catch (err) {
    return {
      ok: false,
      jobs: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
})

ipcMain.handle('sd:pauseDownload', async () => {
  try {
    const { pauseSdDownload } = await import('./sd-workspace')
    return pauseSdDownload()
  } catch {
    return { ok: false }
  }
})

ipcMain.handle('sd:downloadCheckpoint', async (event, modelId?: string) => {

  const result = await downloadCheckpoint(
    (pct, received, total) => {
      try {
        event.sender.send('sd:download-progress', { pct, received, total, modelId })
      } catch {
        /* window gone */
      }
    },
    undefined,
    undefined,
    modelId
  )
  // After download, best-effort sync into Forge models folder
  try {
    const { syncCheckpointsToForge } = await import('./sd-workspace')
    await syncCheckpointsToForge()
  } catch {
    /* ignore */
  }
  return result
})

ipcMain.handle('app:version', () => {
  try {
    // Prefer package.json so UI never lags behind electron-builder cache
    const pkgPath = join(app.getAppPath(), 'package.json')
    const alt = join(__dirname, '../../package.json')
    const { readFileSync, existsSync } = require('fs') as typeof import('fs')
    for (const p of [pkgPath, alt]) {
      if (existsSync(p)) {
        const v = JSON.parse(readFileSync(p, 'utf-8')).version
        if (v) return String(v)
      }
    }
  } catch {
    /* fall through */
  }
  return app.getVersion()
})
ipcMain.handle('app:runtimeMode', () => (app.isPackaged ? 'packaged' : 'dev'))

ipcMain.handle('system:hardwareProfile', async (): Promise<SystemHardwareProfile> => {
  const base: SystemHardwareProfile = {
    totalMemoryGB: Number((totalmem() / 1024 ** 3).toFixed(1)),
    cpuCores: cpus().length,
    architecture: arch(),
    gpuName: null,
    vramGB: null,
    hasDiscreteGpu: null
  }
  try {
    if (process.platform === 'win32') {
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execFileAsync = promisify(execFile)
      // Prefer nvidia-smi (accurate); WMI AdapterRAM is often wrong on >4GB GPUs
      try {
        const { stdout: smi } = await execFileAsync(
          'nvidia-smi',
          ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
          { timeout: 5000, windowsHide: true }
        )
        const line = (smi || '').trim().split(/\r?\n/)[0] || ''
        const parts = line.split(',').map((s: string) => s.trim())
        if (parts[0]) {
          base.gpuName = parts[0]
          const mib = Number(parts[1])
          if (Number.isFinite(mib) && mib > 0) {
            base.vramGB = Number((mib / 1024).toFixed(1))
          }
          base.hasDiscreteGpu = true
        }
      } catch {
        /* no nvidia-smi in PATH */
      }

      if (!base.gpuName) {
        const { stdout } = await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'
          ],
          { timeout: 8000, windowsHide: true }
        )
        const parsed = JSON.parse(stdout || 'null')
        const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
        type Cand = { name: string; gb: number; score: number }
        const cands: Cand[] = []
        for (const g of list) {
          const name = String(g?.Name || '')
          if (!name || /microsoft|basic display|basic render|remote desktop/i.test(name)) continue
          const ram = Number(g?.AdapterRAM) || 0
          let gb = ram > 0 ? ram / 1024 ** 3 : 0
          if (gb > 32) gb = 0
          let score = 0
          if (/nvidia|geforce|rtx|gtx|quadro/i.test(name)) score = 100 + gb
          else if (/amd|radeon|rx /i.test(name) && !/radeon\(tm\) graphics|vega graphics/i.test(name))
            score = 80 + gb
          else if (/intel arc/i.test(name)) score = 70 + gb
          else if (/radeon|amd/i.test(name)) score = 20 + gb
          else score = 10
          cands.push({ name, gb, score })
        }
        cands.sort((a, b) => b.score - a.score)
        const best = cands[0]
        if (best) {
          base.gpuName = best.name
          base.vramGB = best.gb > 0 ? Number(best.gb.toFixed(1)) : null
          base.hasDiscreteGpu = best.score >= 70
        }
      }

      if (base.gpuName && /nvidia|geforce|rtx|gtx/i.test(base.gpuName)) {
        base.hasDiscreteGpu = true
        if (base.vramGB == null || base.vramGB < 1) {
          if (/3060/.test(base.gpuName)) base.vramGB = 12
          else if (/3070/.test(base.gpuName)) base.vramGB = 8
          else if (/3080/.test(base.gpuName)) base.vramGB = 10
          else if (/4060/.test(base.gpuName)) base.vramGB = 8
          else if (/4070|4080|4090/.test(base.gpuName)) base.vramGB = 12
        }
      }

      ;(global as unknown as { __kawaiiHw: SystemHardwareProfile }).__kawaiiHw = { ...base }
    }
  } catch {
    // keep nulls — never fail the profile
  }
  ;(global as unknown as { __kawaiiHw: SystemHardwareProfile }).__kawaiiHw = { ...base }
  return base
})

ipcMain.handle('secrets:getCloudApiKey', () => secureStore.get('cloudApiKey', ''))
ipcMain.handle('secrets:setCloudApiKey', (_e, key: string) => {
  secureStore.set('cloudApiKey', typeof key === 'string' ? key : '')
  return true
})

/** Per-provider API keys: secureStore key = providerKey:<id> */
ipcMain.handle('secrets:getProviderKey', (_e, providerId: string) => {
  if (typeof providerId !== 'string' || !providerId) return ''
  // Backward compat: openrouter / primary uses cloudApiKey if specific missing
  const specific = secureStore.get(`providerKey:${providerId}`, '')
  if (specific) return specific
  if (providerId === 'openrouter' || providerId === 'main') {
    return secureStore.get('cloudApiKey', '')
  }
  return ''
})

ipcMain.handle('secrets:setProviderKey', (_e, providerId: string, key: string) => {
  if (typeof providerId !== 'string' || !providerId) return false
  const value = typeof key === 'string' ? key : ''
  secureStore.set(`providerKey:${providerId}`, value)
  if (providerId === 'openrouter' || providerId === 'main') {
    secureStore.set('cloudApiKey', value)
  }
  return true
})

ipcMain.handle('secrets:getAllProviderKeys', () => {
  const ids = ['openrouter', 'groq', 'gemini', 'openai', 'main', 'cloudflare', 'huggingface']
  const out: Record<string, string> = {}
  for (const id of ids) {
    const specific = secureStore.get(`providerKey:${id}`, '') as string
    if (specific) out[id] = specific
    else if (id === 'openrouter' || id === 'main') {
      const legacy = secureStore.get('cloudApiKey', '') as string
      if (legacy) out[id] = legacy
    }
  }
  return out
})

/** ── Image generation (Pollinations + optional A1111) ───────────────── */
const imageAbortControllers = new Map<string, AbortController>()

async function ensureImagesDir(): Promise<string> {
  const dir = join(app.getPath('userData'), 'images')
  await mkdir(dir, { recursive: true })
  return dir
}

async function fetchPollinationsImage(
  prompt: string,
  width: number,
  height: number,
  seed: number | undefined,
  signal: AbortSignal,
  opts?: { model?: string; enhance?: boolean }
): Promise<{ buf: Buffer; contentType: string }> {
  const lower = prompt.toLowerCase()
  const wantsPhoto = /\b(photo|photoreal|foto|realista|realistic|35mm|raw photo)\b/i.test(lower)
  // Flux tends to respect subjects better than the default turbo-anime bias
  const model = opts?.model || (wantsPhoto ? 'flux' : 'flux')
  let finalPrompt = prompt
  if (wantsPhoto && !/raw photo/i.test(prompt)) {
    finalPrompt =
      'RAW photo, photorealistic, accurate eye color and hair color as written, ' + prompt
  }
  // Pollinations has no negative_prompt — encode avoid list in the text
  if (wantsPhoto) {
    finalPrompt +=
      '. Avoid: anime, cartoon, illustration, painting, 3d render, purple fantasy hair if not requested'
  }
  const params = new URLSearchParams()
  params.set('width', String(Math.min(1280, width)))
  params.set('height', String(Math.min(1280, height)))
  params.set('nologo', 'true')
  params.set('model', model)
  params.set('enhance', opts?.enhance === false ? 'false' : 'true')
  if (seed != null && Number.isFinite(seed)) {
    params.set('seed', String(Math.floor(seed)))
  }
  const url =
    'https://image.pollinations.ai/prompt/' +
    encodeURIComponent(finalPrompt.slice(0, 1800)) +
    '?' +
    params.toString()

  let res: Response | null = null
  let lastStatus = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(url, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'image/*,*/*',
        'User-Agent': 'KawaiiGPT-Robust/0.3'
      }
    })
    lastStatus = res.status
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2000))
      continue
    }
    break
  }
  if (!res || !res.ok) {
    const err = new Error(`Pollinations HTTP ${lastStatus || 'error'}`)
    ;(err as Error & { code?: string }).code =
      lastStatus === 429 ? 'IMAGE_RATE_LIMIT' : 'IMAGE_BACKEND_DOWN'
    throw err
  }
  const contentType = res.headers.get('content-type') || 'image/png'
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength < 100) throw new Error('Imagen vacía o inválida')
  return { buf, contentType }
}

async function fetchA1111Image(
  baseUrl: string,
  prompt: string,
  negative: string,
  width: number,
  height: number,
  steps: number,
  cfg: number,
  seed: number | undefined,
  signal: AbortSignal,
  checkpoint?: string
): Promise<{ buf: Buffer; contentType: string; info?: string; model?: string }> {
  const root = baseUrl.replace(/\/$/, '')
  const body: Record<string, unknown> = {
    prompt,
    negative_prompt: negative || '',
    width,
    height,
    steps,
    cfg_scale: cfg,
    seed: seed ?? -1,
    sampler_name: 'Euler a',
    batch_size: 1,
    n_iter: 1,
    enable_hr: false
  }
  if (checkpoint && checkpoint.trim()) {
    body.override_settings = { sd_model_checkpoint: checkpoint.trim() }
    body.override_settings_restore_afterwards = true
  }
  const res = await fetch(`${root}/sdapi/v1/txt2img`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `A1111 HTTP 404 en ${root}/sdapi/v1/txt2img — Forge sin --api o URL incorrecta. Usa Arrancar Forge desde la app.`
        : `A1111 HTTP ${res.status} en ${root}/sdapi/v1/txt2img`
    )
  }
  const data = (await res.json()) as { images?: string[]; info?: string }
  const b64 = data.images?.[0]
  if (!b64) throw new Error('A1111 no devolvió imagen')
  const buf = Buffer.from(b64, 'base64')
  return { buf, contentType: 'image/png', info: data.info, model: checkpoint?.trim() || 'stable-diffusion' }
}

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
    candidates.push('http://127.0.0.1:7860', 'http://localhost:7860')

    let uiOnlyHint = ''
    for (const root of [...new Set(candidates)]) {
      const h = await probeForgeHealth(root, 7000)
      if (h.ok) {
        return {
          ok: true,
          latencyMs: Date.now() - start,
          baseUrl: h.baseUrl || root,
          error: undefined
        }
      }
      if ((h as { uiOnly?: boolean }).uiOnly) {
        uiOnlyHint =
          h.error ||
          'UI de Forge sin --api (txt2img 404). Cierra esa ventana y pulsa Arrancar Forge en la app.'
      }
    }

    const scan = await scanForgeApiPorts()
    if (!scan.ok && uiOnlyHint) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: uiOnlyHint
      }
    }
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
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: scan.error || 'Forge/A1111 no responde en puertos conocidos'
    }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err)
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
    const token = String(secureStore.get('providerKey:cloudflare', '') || '')
    if (!acc || !token) {
      return { ok: false, error: 'Configura Account ID y Token' }
    }
    return await probeCloudflareAi(acc, token)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle(
  'image:generate',

  async (
    event,
    payload: {
      prompt: string
      negativePrompt?: string
      width?: number
      height?: number
      seed?: number
      timeoutMs?: number
      jobId?: string
      provider?: 'pollinations' | 'a1111' | 'cloudflare' | 'openai' | 'smart'
      a1111BaseUrl?: string
      steps?: number
      cfgScale?: number
      checkpoint?: string
      cloudflareAccountId?: string
    }
  ) => {
    const prompt = (payload?.prompt || '').trim()
    if (!prompt) {
      return { ok: false as const, code: 'IMAGE_INVALID_PROMPT', error: 'Prompt vacío' }
    }
    const jobId = payload.jobId || randomUUID()
    const controller = new AbortController()
    imageAbortControllers.set(jobId, controller)

    const width = Math.min(2048, Math.max(256, Math.round(payload.width ?? 1024)))
    const height = Math.min(2048, Math.max(256, Math.round(payload.height ?? 1024)))
    const timeoutMs = Math.min(300_000, Math.max(15_000, payload.timeoutMs ?? 180_000))
    const providerPref = payload.provider || 'smart'

    const start = Date.now()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const saveBuf = async (buf: Buffer, contentType: string, providerId: string, model?: string) => {
      const ext = contentType.includes('jpeg')
        ? 'jpg'
        : contentType.includes('webp')
          ? 'webp'
          : 'png'
      const mime =
        ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
      const dir = await ensureImagesDir()
      const fileName = `img-${Date.now()}-${jobId.slice(0, 8)}.${ext}`
      const filePath = join(dir, fileName)
      await writeFile(filePath, buf)
      return {
        ok: true as const,
        jobId,
        filePath,
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        width,
        height,
        providerId,
        model,
        seed: payload.seed,
        latencyMs: Date.now() - start,
        prompt
      }
    }

    try {
      const sendProgress = (phase: string, pct: number, detail?: string) => {
        try {
          event.sender.send('image:generate-progress', {
            jobId,
            phase,
            pct,
            detail: detail || phase
          })
        } catch {
          /* ignore */
        }
      }

      const tryA1111 = async () => {
        sendProgress('local', 5, 'Conectando con Forge…')
        let root = (payload.a1111BaseUrl || '').replace(/\/$/, '')
        // Prefer live Forge runtime / port scan over stale settings
        try {
          const { getForgeRuntimeStatus, scanForgeApiPorts, refreshForgeHealth, startForgeRuntime } =
            await import('./forge-runtime')
          const st = getForgeRuntimeStatus()
          if (st.baseUrl && st.apiOk) root = st.baseUrl.replace(/\/$/, '')
          if (!root || !(st.apiOk)) {
            sendProgress('local', 8, 'Buscando API Forge en puertos…')
            const scan = await scanForgeApiPorts()
            if (scan.ok && scan.baseUrl) root = scan.baseUrl.replace(/\/$/, '')
          }
          if (!root) {
            sendProgress('local', 10, 'Intentando arrancar Forge…')
            try {
              await startForgeRuntime()
              const st2 = getForgeRuntimeStatus()
              if (st2.baseUrl) root = st2.baseUrl.replace(/\/$/, '')
              else {
                const scan2 = await scanForgeApiPorts()
                if (scan2.ok && scan2.baseUrl) root = scan2.baseUrl.replace(/\/$/, '')
              }
            } catch (bootErr) {
              /* continue with default */
            }
          }
          try { await refreshForgeHealth() } catch { /* ignore */ }
        } catch {
          /* forge-runtime optional */
        }
        if (!root) root = 'http://127.0.0.1:7860'
        sendProgress('local', 12, `Forge en ${root}`)
        // Confirm real /sdapi (not just Gradio UI)
        {
          const { probeForgeHealth, scanForgeApiPorts } = await import('./forge-runtime')
          let h = await probeForgeHealth(root, 5000)
          if (!h.ok) {
            const scan = await scanForgeApiPorts()
            if (scan.ok && scan.baseUrl) {
              root = scan.baseUrl.replace(/\/$/, '')
              h = await probeForgeHealth(root, 4000)
            }
          }
          if (!h.ok) {
            throw new Error(
              h.error ||
                `No hay API Forge (--api). Cierra la ventana de Forge abierta a mano y usa «Arrancar Forge» en la app.`
            )
          }
          root = (h.baseUrl || root).replace(/\/$/, '')
        }
        // Progress poll while txt2img runs
        let stopPoll = false
        const poll = async () => {
          while (!stopPoll && !controller.signal.aborted) {
            try {
              const pr = await fetch(`${root}/sdapi/v1/progress?skip_current_image=true`, {
                signal: AbortSignal.timeout(3000)
              })
              if (pr.ok) {
                const data = (await pr.json()) as {
                  progress?: number
                  eta_relative?: number
                  state?: { sampling_step?: number; sampling_steps?: number }
                }
                const p = Math.max(0, Math.min(0.99, data.progress ?? 0))
                const step = data.state?.sampling_step
                const steps = data.state?.sampling_steps
                const eta = data.eta_relative
                let detail = `Forge · ${Math.round(p * 100)}%`
                if (step != null && steps) detail += ` · paso ${step}/${steps}`
                if (eta != null && eta > 0) detail += ` · ETA ${Math.ceil(eta)}s`
                sendProgress('local', 5 + p * 90, detail)
              }
            } catch {
              /* ignore poll errors */
            }
            await new Promise((r) => setTimeout(r, 800))
          }
        }
        void poll()
        try {
          const r = await fetchA1111Image(
            root,
            prompt,
            payload.negativePrompt || '',
            width,
            height,
            payload.steps ?? 32,
            payload.cfgScale ?? 7,
            payload.seed,
            controller.signal,
            payload.checkpoint
          )
          sendProgress('local', 100, 'Listo')
          return saveBuf(
            r.buf,
            r.contentType,
            'a1111',
            r.model || payload.checkpoint || 'stable-diffusion'
          )
        } finally {
          stopPoll = true
        }
      }
      const tryPollinations = async () => {
        sendProgress('cloud', 10, 'Pollinations Flux…')
        const r = await fetchPollinationsImage(
          prompt,
          width,
          height,
          payload.seed,
          controller.signal
        )
        sendProgress('cloud', 100, 'Listo')
        return saveBuf(r.buf, r.contentType, 'pollinations', 'pollinations-flux')
      }

      const tryCloudflare = async () => {
        sendProgress('cloudflare', 8, 'Cloudflare FLUX.1 Schnell…')
        const { fetchCloudflareFlux } = await import('./cloudflare-image')
        let token = ''
        let accStored = ''
        try {
          token = String(secureStore.get('providerKey:cloudflare', '') || '')
          accStored = String(secureStore.get('providerKey:cloudflareAccountId', '') || '')
        } catch {
          token = ''
        }
        const acc = (
          (payload as { cloudflareAccountId?: string }).cloudflareAccountId ||
          accStored ||
          ''
        ).trim()
        if (!acc || !token) {
          const err = new Error(
            `Cloudflare no configurado (Account ID ${acc ? 'OK' : 'faltante'}, Token ${token ? 'OK' : 'faltante'}). Ajustes → Guardar y probar.`
          )
          ;(err as Error & { code?: string }).code = 'IMAGE_CF_NO_CREDS'
          throw err
        }
        const r = await fetchCloudflareFlux({
          accountId: acc,
          apiToken: token,
          prompt,
          steps: 6,
          seed: payload.seed,
          width: payload.width,
          height: payload.height,
          signal: controller.signal
        })
        sendProgress('cloudflare', 100, 'Listo')
        return saveBuf(r.buf, r.contentType, 'cloudflare', r.model)
      }

      if (providerPref === 'a1111') {
        return await tryA1111()
      }
      if (providerPref === 'cloudflare') {
        try {
          return await tryCloudflare()
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          sendProgress('cloud', 5, `CF falló · Pollinations…`)
          const pol = await tryPollinations()
          if (pol && pol.ok) {
            return {
              ...pol,
              model: `${pol.model || 'pollinations'} (CF: ${msg.slice(0, 80)})`
            }
          }
          return pol
        }
      }
      const tryOpenAI = async () => {
        sendProgress('openai', 8, 'OpenAI Images…')
        const key =
          (secureStore.get('providerKey:openai', '') as string) ||
          (secureStore.get('cloudApiKey', '') as string) ||
          ''
        if (!key || key.trim().length < 8) {
          throw new Error('Sin API key de OpenAI')
        }
        const { generateOpenAIImage } = await import('../core/image/openai-images')
        const r = await generateOpenAIImage({
          apiKey: key.trim(),
          prompt,
          width,
          height,
          model: 'gpt-image-1.5',
          signal: controller.signal
        })
        return saveBuf(r.buf, r.contentType, 'openai', r.model)
      }

      if (providerPref === 'openai') {
        return await tryOpenAI()
      }
      if (providerPref === 'smart') {
        // OpenAI (si hay key) → Local Forge → Cloudflare → Pollinations

        const errors: string[] = []
        try {
          return await tryOpenAI()
        } catch (e) {
          errors.push(`OpenAI: ${e instanceof Error ? e.message : String(e)}`)
        }
        try {
          return await tryA1111()
        } catch (e) {
          errors.push(`Local: ${e instanceof Error ? e.message : String(e)}`)
        }
        try {
          sendProgress('cloudflare', 5, 'Cloudflare FLUX…')
          return await tryCloudflare()
        } catch (e) {
          errors.push(`Cloudflare: ${e instanceof Error ? e.message : String(e)}`)
        }
        try {
          sendProgress('cloud', 5, 'Último recurso · Pollinations Flux…')
          const pol = await tryPollinations()
          if (pol && pol.ok) {
            return {
              ...pol,
              model: `${pol.model || 'pollinations'} (fallback; ${errors.join(' | ')})`.slice(0, 200)
            }
          }
          return pol
        } catch (e) {
          errors.push(`Pollinations: ${e instanceof Error ? e.message : String(e)}`)
          return {
            ok: false as const,
            code: 'IMAGE_ALL_FAILED',
            error: errors.join(' · '),
            jobId
          }
        }
      }
      if (providerPref === 'pollinations') {
        return await tryPollinations()
      }
      // cloud default
      try {
        return await tryCloudflare()
      } catch {
        return await tryPollinations()
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const code =
        (err as Error & { code?: string }).code ||
        (controller.signal.aborted ? 'IMAGE_CANCELLED' : 'IMAGE_NETWORK')
      const cancelled =
        controller.signal.aborted ||
        msg.toLowerCase().includes('abort') ||
        msg.toLowerCase().includes('cancel')
      return {
        ok: false as const,
        code: cancelled ? 'IMAGE_CANCELLED' : code,
        error: cancelled ? 'Generación cancelada' : msg,
        jobId
      }
    } finally {
      clearTimeout(timer)
      imageAbortControllers.delete(jobId)
    }
  }
)

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


ipcMain.handle(
  'web:search',
  async (
    _event,
    query: string,
    maxResults = 5
  ): Promise<{ title: string; snippet: string; url?: string }[]> => {
    const q = (query || '').trim()
    if (!q) return []
    const limit = Math.max(1, Math.min(maxResults, 10))
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'KawaiiGPT-Robust/0.1' }
      })
      if (!res.ok) return []
      const data = (await res.json()) as {
        AbstractText?: string
        AbstractURL?: string
        Heading?: string
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>
      }
      const results: { title: string; snippet: string; url?: string }[] = []
      if (data.AbstractText) {
        results.push({
          title: data.Heading || 'Resultado',
          snippet: data.AbstractText,
          url: data.AbstractURL
        })
      }
      for (const t of data.RelatedTopics ?? []) {
        if (results.length >= limit) break
        if (t.Text) {
          results.push({
            title: t.Text.slice(0, 80),
            snippet: t.Text,
            url: t.FirstURL
          })
        }
      }
      return results.slice(0, limit)
    } catch {
      return []
    }
  }
)


// ── Ollama lifecycle helpers (Windows-friendly) ──────────────────────────────

let ollamaChild: ChildProcess | null = null

function resolveOllamaBinary(): string | null {
  if (process.platform === 'win32') {
    const home = process.env.USERPROFILE || process.env.HOME || ''
    const candidates = [
      join(home, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
      'C:\\\\Program Files\\\\Ollama\\\\ollama.exe',
      'ollama'
    ]
    for (const c of candidates) {
      if (c === 'ollama') return c
      if (c && existsSync(c)) return c
    }
    return 'ollama'
  }
  const unix = ['/usr/local/bin/ollama', '/usr/bin/ollama', 'ollama']
  for (const c of unix) {
    if (c === 'ollama') return c
    if (existsSync(c)) return c
  }
  return 'ollama'
}

async function isOllamaReachable(baseUrl = 'http://localhost:11434'): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: controller.signal
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

ipcMain.handle('ollama:status', async (_e, baseUrl?: string) => {
  const url = baseUrl || 'http://localhost:11434'
  const reachable = await isOllamaReachable(url)
  return {
    reachable,
    managedByApp: Boolean(ollamaChild && !ollamaChild.killed),
    pid: ollamaChild?.pid
  }
})

ipcMain.handle('ollama:start', async (_e, baseUrl?: string) => {
  const url = baseUrl || 'http://localhost:11434'
  if (await isOllamaReachable(url)) {
    return { ok: true, alreadyRunning: true, message: 'Ollama ya está respondiendo' }
  }

  const bin = resolveOllamaBinary()
  if (!bin) {
    return { ok: false, message: 'No se encontró el ejecutable de Ollama' }
  }

  try {
    // Prefer "ollama serve"; on Windows the app may already auto-start the daemon
    ollamaChild = spawn(bin, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: process.platform === 'win32'
    })
    ollamaChild.unref()

    // Wait up to ~8s for readiness
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500))
      if (await isOllamaReachable(url)) {
        return { ok: true, alreadyRunning: false, message: 'Ollama iniciado', pid: ollamaChild.pid }
      }
    }
    return {
      ok: false,
      message:
        'Se intentó iniciar Ollama pero no responde aún. Ábrelo manualmente desde el menú Inicio.'
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'No se pudo iniciar Ollama'
    }
  }
})


// Active pull controllers for cancel support
const pullAbortControllers = new Map<string, AbortController>()

ipcMain.handle('ollama:list-pull-jobs', async () => {
  const { listRecoverableOllamaPulls } = await import('./ollama-pull-jobs')
  return { ok: true, jobs: await listRecoverableOllamaPulls() }
})

ipcMain.handle('ollama:pull-cancel', async (_e, model?: string) => {
  if (model && pullAbortControllers.has(model)) {
    pullAbortControllers.get(model)!.abort()
    pullAbortControllers.delete(model)
    return { ok: true }
  }
  // cancel all
  for (const [key, c] of pullAbortControllers) {
    c.abort()
    pullAbortControllers.delete(key)
  }
  return { ok: true }
})

ipcMain.handle(
  'ollama:pull',
  async (event, payload: { model: string; baseUrl?: string }) => {
    const model = (payload?.model || '').trim()
    if (!model) return { ok: false, error: 'Modelo vacío' }
    const base = (payload.baseUrl || 'http://localhost:11434').replace(/\/$/, '')

    if (pullAbortControllers.has(model)) {
      pullAbortControllers.get(model)!.abort()
      pullAbortControllers.delete(model)
    }
    const controller = new AbortController()
    pullAbortControllers.set(model, controller)

    const { upsertOllamaPullJob, removeOllamaPullJob } = await import('./ollama-pull-jobs')
    await upsertOllamaPullJob({ model, status: 'running', updatedAt: Date.now(), progress: 0 })

    const maxAttempts = 5
    let lastError = ''

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (controller.signal.aborted) {
        await upsertOllamaPullJob({ model, status: 'paused', updatedAt: Date.now() })
        pullAbortControllers.delete(model)
        return { ok: false, error: 'cancelled', cancelled: true }
      }
      try {
        if (attempt > 1) {
          event.sender.send('ollama:pull-progress', {
            model,
            status: `Reintento ${attempt}/${maxAttempts} (Ollama reanuda capas ya bajadas)…`,
            progress: undefined
          })
          await new Promise((r) => setTimeout(r, Math.min(15_000, 2000 * attempt)))
        }

        const res = await fetch(`${base}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model, stream: true }),
          signal: controller.signal
        })
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '')
          lastError = text || `HTTP ${res.status}`
          continue
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let lastPct = 0
        let streamError = ''

        while (true) {
          if (controller.signal.aborted) {
            try {
              await reader.cancel()
            } catch {
              /* ignore */
            }
            await upsertOllamaPullJob({ model, status: 'paused', progress: lastPct })
            pullAbortControllers.delete(model)
            event.sender.send('ollama:pull-progress', { model, status: 'cancelled' })
            return { ok: false, error: 'cancelled', cancelled: true }
          }
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              const parsed = JSON.parse(trimmed) as {
                status?: string
                completed?: number
                total?: number
                error?: string
              }
              if (parsed.error) {
                streamError = parsed.error
                break
              }
              const progress =
                parsed.total && parsed.total > 0 && parsed.completed != null
                  ? Math.min(99, (parsed.completed / parsed.total) * 100)
                  : undefined
              if (progress != null) lastPct = progress
              event.sender.send('ollama:pull-progress', {
                model,
                status: parsed.status || 'downloading',
                progress,
                completed: parsed.completed,
                total: parsed.total
              })
              if (progress != null && Math.floor(progress) % 5 === 0) {
                await upsertOllamaPullJob({
                  model,
                  status: 'running',
                  progress: lastPct
                })
              }
            } catch {
              /* ignore bad json line */
            }
          }
          if (streamError) break
        }

        if (streamError) {
          lastError = streamError
          const retryable =
            /max retries|timeout|temporar|connection|EOF|reset|TLS|cloudflare|529|502|503|504/i.test(
              streamError
            )
          await upsertOllamaPullJob({
            model,
            status: 'error',
            error: streamError,
            progress: lastPct
          })
          event.sender.send('ollama:pull-progress', {
            model,
            status: 'error',
            error: streamError + (retryable ? ' · Se reintentará automáticamente…' : '')
          })
          if (retryable && attempt < maxAttempts) continue
          pullAbortControllers.delete(model)
          return { ok: false, error: streamError }
        }

        pullAbortControllers.delete(model)
        await removeOllamaPullJob(model)
        event.sender.send('ollama:pull-progress', { model, status: 'success', progress: 100 })
        return { ok: true }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          await upsertOllamaPullJob({ model, status: 'paused' })
          pullAbortControllers.delete(model)
          event.sender.send('ollama:pull-progress', { model, status: 'cancelled' })
          return { ok: false, error: 'cancelled', cancelled: true }
        }
        lastError = err instanceof Error ? err.message : String(err)
        await upsertOllamaPullJob({ model, status: 'error', error: lastError })
        if (attempt >= maxAttempts) break
      }
    }

    pullAbortControllers.delete(model)
    event.sender.send('ollama:pull-progress', {
      model,
      status: 'error',
      error:
        (lastError || 'Error de descarga') +
        ' · Pulsa Continuar: Ollama reanuda lo ya descargado.'
    })
    return { ok: false, error: lastError }
  }
)

ipcMain.handle(
  'ollama:delete',
  async (_e, payload: { model: string; baseUrl?: string }) => {
    const model = (payload?.model || '').trim()
    if (!model) return { ok: false, error: 'Modelo vacío' }
    const base = (payload.baseUrl || 'http://localhost:11434').replace(/\/$/, '')
    try {
      const res = await fetch(`${base}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model })
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, error: text || `HTTP ${res.status}` }
      }
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }
)

app.on('before-quit', () => {
  // Keep system Ollama running; we only spawn helpers, we don't own the daemon lifecycle.
})


const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindowRef) return
    if (mainWindowRef.isMinimized()) mainWindowRef.restore()
    mainWindowRef.focus()
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.kawaiigpt.robust')
    }
    void refreshModelCatalog()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    // Background: Ollama + Forge without blocking the window
    setTimeout(() => {
      void (async () => {
        try {
          if (!(await isOllamaReachable('http://127.0.0.1:11434'))) {
            // best-effort start via same handler logic
            try {
              const bin = resolveOllamaBinary()
              if (!bin) return
              const { spawn } = await import('child_process')
              const c = spawn(bin, ['serve'], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
                shell: process.platform === 'win32'
              })
              if (typeof c?.unref === 'function') c.unref()
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
        try {
          const { loadMachineProfile, detectForgePresent } = await import('./machine-profile')
          const profile = await loadMachineProfile().catch(() => null)
          const forgePath = profile?.forgeInstallPath
          const present = forgePath ? await detectForgePresent(forgePath).catch(() => false) : false
          if (!present) {
            // no install yet — skip auto-start (user uses Asistente / SD panel)
          } else {
            const st = getForgeRuntimeStatus()
            if (st.state !== 'running') {
              void startForgeRuntime({ readyTimeoutMs: 240_000 }).catch(() => null)
            } else {
              void refreshForgeHealth().catch(() => null)
            }
          }
        } catch {
          /* ignore */
        }
        try {
          const { purgeStaleJobs } = await import('./resumable-download')
          const { loadMachineProfile } = await import('./machine-profile')
          const { join } = await import('path')
          const p = await loadMachineProfile().catch(() => null)
          const root = (p as { sdWorkRoot?: string; forgeInstallPath?: string } | null)?.sdWorkRoot
            || (p as { forgeInstallPath?: string } | null)?.forgeInstallPath
          if (root) {
            await purgeStaleJobs(join(String(root), 'downloads')).catch(() => 0)
          }
        } catch {
          /* ignore */
        }
      })()
    }, 3500)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

  ipcMain.handle('machine:ensureProfile', async () => {
    let hw: {
      gpuName?: string | null
      vramGB?: number | null
      hasDiscreteGpu?: boolean | null
      totalMemoryGB?: number
    } = {}
    try {
      // Call internal profile from same process by reusing system handler logic is heavy;
      // clients pass nothing — we read OS here lightly via ensure which uses os.totalmem
      const { totalmem } = await import('os')
      hw.totalMemoryGB = Number((totalmem() / 1024 ** 3).toFixed(1))
    } catch { /* ignore */ }
    // Prefer live hardware from a quick re-query if available on global
    try {
      const cached = (global as unknown as { __kawaiiHw?: typeof hw }).__kawaiiHw
      if (cached) hw = { ...hw, ...cached }
    } catch { /* ignore */ }
    const result = await ensureMachineProfile(hw)
    const forgePresent = await detectForgePresent(result.profile.forgeInstallPath)
    return { ...result, forgePresent }
  })

  ipcMain.handle('machine:getProfile', async () => {
    return loadMachineProfile()
  })

  ipcMain.handle('machine:listDrives', async () => listDrives())

  ipcMain.handle(
    'machine:setDataRoot',
    async (_e, root: string, lock?: boolean) => {
      let hw: {
        gpuName?: string | null
        vramGB?: number | null
        hasDiscreteGpu?: boolean | null
        totalMemoryGB?: number
      } = {}
      try {
        const cached = (global as unknown as { __kawaiiHw?: typeof hw }).__kawaiiHw
        if (cached) hw = cached
      } catch { /* ignore */ }
      const profile = await setDataRoot(String(root || ''), hw, lock !== false)
      await ensureDataRootWorkspace(profile)
      const forgePresent = await detectForgePresent(profile.forgeInstallPath)
      return { profile, forgePresent }
    }
  )

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
    let hw: {
      gpuName?: string | null
      vramGB?: number | null
      hasDiscreteGpu?: boolean | null
      totalMemoryGB?: number
    } = {}
    try {
      const cached = (global as unknown as { __kawaiiHw?: typeof hw }).__kawaiiHw
      if (cached) hw = cached
    } catch { /* ignore */ }
    const { profile, drives, created } = await ensureMachineProfile(hw)
    const ws = await ensureDataRootWorkspace(profile)
    const forgePresent = await detectForgePresent(profile.forgeInstallPath)
    return { profile, drives, created, workspace: ws, forgePresent }
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
      return await startForgeRuntime({
        preferredPort: preferredPort != null ? Number(preferredPort) : undefined
      })
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

  ipcMain.handle('python:ensure', async () => {
    try {
      const { ensureMachineProfile } = await import('./machine-profile')
      const { ensurePortablePython, isPortablePythonReady, portablePythonExe } = await import('./python-runtime')
      const { profile } = await ensureMachineProfile({} as never)
      if (isPortablePythonReady(profile.preferredDataRoot)) {
        return { ok: true, python: portablePythonExe(profile.preferredDataRoot), already: true }
      }
      const r = await ensurePortablePython(profile.preferredDataRoot)
      return r
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
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


  // ── Git sync (multi-account SSH) ─────────────────────────────────────────
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

  ipcMain.handle('sd:syncCheckpointsToForge', async () => {
    try {
      return await syncCheckpointsToForge()
    } catch (err) {
      return {
        ok: false,
        copied: [],
        skipped: [],
        forgeModelsDir: null,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('image:ensureLocalPipeline', async (_e, preferredPort?: number) => {
    try {
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

