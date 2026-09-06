/**
 * Phase 2b: download Forge portable (.7z), extract into machine-profile forge path.
 * Uses standalone 7zr.exe when system 7-Zip is missing.
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, chmod, stat, writeFile, readdir } from 'fs/promises'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { platform } from 'os'
import {
  ensureMachineProfile,
  ensureDataRootWorkspace,
  detectForgePresent,
  loadMachineProfile,
  type MachineProfile
} from './machine-profile'
import {
  resumableDownload,
  loadDownloadJob,
  listRecoveryJobs,
  type DownloadControl,
  type DownloadJobState
} from './resumable-download'

const execFileAsync = promisify(execFile)

/** Official recommended one-click pack (CUDA 12.1 + Torch 2.3.1) */
export const FORGE_PACK = {
  id: 'webui_forge_cu121_torch231',
  filename: 'webui_forge_cu121_torch231.7z',
  url: 'https://github.com/lllyasviel/stable-diffusion-webui-forge/releases/download/latest/webui_forge_cu121_torch231.7z',
  /** Approximate size for UI / free-space check */
  approxGB: 3.5,
  label: 'Forge portable CUDA 12.1 + PyTorch 2.3.1 (oficial)'
}

/** Minimal 7-Zip reduced console (extracts .7z) */
const SEVEN_ZR = {
  filename: '7zr.exe',
  url: 'https://www.7-zip.org/a/7zr.exe'
}

export type ForgeInstallProgress = {
  phase: 'download-7z' | 'download-pack' | 'extract' | 'configure' | 'done' | 'error'
  pct: number
  message: string
  received?: number
  total?: number | null
}

let activeAbort: AbortController | null = null
let activeDownloadControl: DownloadControl | null = null


function toolsDir(): string {
  return join(app.getPath('userData'), 'tools')
}

function downloadsDir(profile: MachineProfile): string {
  return join(profile.preferredDataRoot, 'downloads')
}

function sendProgress(win: BrowserWindow | null, p: ForgeInstallProgress): void {
  win?.webContents.send('forge:install-progress', p)
}

async function ensureSevenZr(signal: AbortSignal, win: BrowserWindow | null): Promise<string> {
  const dir = toolsDir()
  await mkdir(dir, { recursive: true })
  const local = join(dir, SEVEN_ZR.filename)

  // Prefer system 7z if available
  if (platform() === 'win32') {
    for (const cmd of ['7z', '7za', '7zr']) {
      try {
        await execFileAsync(cmd, ['--help'], { timeout: 5000, windowsHide: true })
        return cmd
      } catch {
        /* try next */
      }
    }
  }

  if (existsSync(local)) return local

  sendProgress(win, {
    phase: 'download-7z',
    pct: 0,
    message: 'Descargando extractor 7zr.exe (una vez)…'
  })
  const r7 = await resumableDownload({
    id: '7zr',
    url: SEVEN_ZR.url,
    dest: local,
    label: '7zr.exe',
    signal,
    onProgress: (received, total) => {
      const pct = total ? Math.min(99, (received / total) * 100) : 0
      sendProgress(win, {
        phase: 'download-7z',
        pct,
        message: 'Descargando extractor 7zr.exe…',
        received,
        total
      })
    },
    onControl: (ctrl) => {
      activeDownloadControl = ctrl
    }
  })
  if (!r7.ok) {
    if (r7.paused) throw new Error('PAUSED')
    if (r7.cancelled) throw new Error('CANCELLED')
    throw new Error(r7.error)
  }
  try {
    await chmod(local, 0o755)
  } catch {
    /* windows */
  }
  return local
}

async function extract7z(
  seven: string,
  archive: string,
  outDir: string,
  signal: AbortSignal
): Promise<void> {
  await mkdir(outDir, { recursive: true })
  // 7z x -y -oOUT archive
  await new Promise<void>((resolve, reject) => {
    const args =
      seven.endsWith('.exe') || seven === '7zr' || seven === '7za' || seven === '7z'
        ? ['x', '-y', `-o${outDir}`, archive]
        : ['x', '-y', `-o${outDir}`, archive]
    const child = spawn(seven, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let errBuf = ''
    child.stderr?.on('data', (d) => {
      errBuf += String(d)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (signal.aborted) {
        reject(new Error('Cancelado'))
        return
      }
      if (code === 0) resolve()
      else reject(new Error(`Extracción falló (código ${code}). ${errBuf.slice(0, 300)}`))
    })
    signal.addEventListener('abort', () => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    })
  })
}

/** If archive extracted into a single top-level folder, flatten optional — keep as-is. */
async function findForgeRoot(extractDir: string): Promise<string> {
  const names = await readdir(extractDir)
  if (names.includes('run.bat') || names.includes('webui-user.bat') || names.includes('webui.py')) {
    return extractDir
  }
  // Often one folder inside
  for (const n of names) {
    const sub = join(extractDir, n)
    try {
      const st = await stat(sub)
      if (!st.isDirectory()) continue
      const inner = await readdir(sub)
      if (
        inner.includes('run.bat') ||
        inner.includes('webui-user.bat') ||
        inner.includes('webui.py')
      ) {
        return sub
      }
    } catch {
      /* ignore */
    }
  }
  return extractDir
}

async function writeApiLauncher(forgeRoot: string): Promise<string> {
  const bat = `@echo off
cd /d "%~dp0"
REM KawaiiGPT — API local (127.0.0.1)
set COMMANDLINE_ARGS=--api --api-log --listen 127.0.0.1 --skip-version-check
if exist "webui.bat" (
  call webui.bat
) else if exist "webui-user.bat" (
  call webui-user.bat %*
) else if exist "run.bat" (
  call run.bat %*
) else (
  echo No se encontro webui-user.bat ni run.bat
  pause
)
`
  const path = join(forgeRoot, 'run-kawaii-api.bat')
  await writeFile(path, bat, 'utf-8')
  return path
}

export function cancelForgeInstall(wipe = false): { ok: boolean } {
  if (activeDownloadControl) {
    activeDownloadControl.cancel(wipe)
    return { ok: true }
  }
  if (activeAbort) {
    activeAbort.abort()
    activeAbort = null
    return { ok: true }
  }
  return { ok: false }
}

export function pauseForgeInstall(): { ok: boolean } {
  if (activeDownloadControl) {
    activeDownloadControl.pause()
    return { ok: true }
  }
  if (activeAbort) {
    activeAbort.abort()
    return { ok: true }
  }
  return { ok: false }
}

export async function getForgeDownloadJob(profile?: MachineProfile | null): Promise<DownloadJobState | null> {
  const p = profile || (await loadMachineProfile())
  if (!p) return null
  const dest = join(downloadsDir(p), FORGE_PACK.filename)
  return loadDownloadJob(dest)
}

export async function listInstallRecoveryJobs(): Promise<DownloadJobState[]> {
  const p = await loadMachineProfile()
  if (!p) return []
  const jobs = await listRecoveryJobs(downloadsDir(p))
  // Only show incomplete / failed / paused — not completed (avoids "completed · 0%")
  return jobs.filter((j) => {
    if (j.status === 'completed') return false
    if (j.status === 'cancelled' && !(j.received > 0)) return false
    return j.status === 'downloading' || j.status === 'paused' || j.status === 'failed' || j.received > 0
  })
}


/**
 * Full install: ensure profile → download pack → extract → launcher.
 */
export async function installForgePortable(
  getWin: () => BrowserWindow | null
): Promise<
  | {
      ok: true
      forgeRoot: string
      launcher: string
      profile: MachineProfile
    }
  | { ok: false; error: string; cancelled?: boolean }
> {
  if (platform() !== 'win32') {
    return {
      ok: false,
      error: 'La instalación automática de Forge portable solo está soportada en Windows.'
    }
  }

  if (activeAbort) {
    return { ok: false, error: 'Ya hay una instalación en curso.' }
  }

  const ac = new AbortController()
  activeAbort = ac
  const win = getWin()

  try {
    let hw: {
      gpuName?: string | null
      vramGB?: number | null
      hasDiscreteGpu?: boolean | null
      totalMemoryGB?: number
    } = {}
    try {
      const cached = (global as unknown as { __kawaiiHw?: typeof hw }).__kawaiiHw
      if (cached) hw = cached
    } catch {
      /* ignore */
    }

    const { profile } = await ensureMachineProfile(hw)
    if (!profile.lastPreflight.ok) {
      return {
        ok: false,
        error:
          profile.lastPreflight.reasons[0] ||
          'Preflight no apto. Usa cloud o corrige GPU/espacio.'
      }
    }

    await ensureDataRootWorkspace(profile)

    // Already installed?
    if (await detectForgePresent(profile.forgeInstallPath)) {
      const root = await findForgeRoot(profile.forgeInstallPath)
      const launcher = await writeApiLauncher(root)
      sendProgress(win, {
        phase: 'done',
        pct: 100,
        message: 'Forge ya estaba presente. Launcher API actualizado.'
      })
      return { ok: true, forgeRoot: root, launcher, profile }
    }

    const dlDir = downloadsDir(profile)
    await mkdir(dlDir, { recursive: true })
    const archivePath = join(dlDir, FORGE_PACK.filename)

    // Free space soft check via profile warnings already done

    const existingJob = await loadDownloadJob(archivePath)
    if (existsSync(archivePath)) {
      sendProgress(win, {
        phase: 'download-pack',
        pct: 100,
        message: 'Pack ya descargado; se reutiliza.'
      })
    } else {
      const resumeMsg =
        existingJob && existingJob.received > 0
          ? `Reanudando Forge… ${Math.round((existingJob.received / (existingJob.total || existingJob.received + 1)) * 100)}%`
          : `Descargando ${FORGE_PACK.label} (~${FORGE_PACK.approxGB} GB)…`
      sendProgress(win, {
        phase: 'download-pack',
        pct: existingJob?.total
          ? Math.min(99, (existingJob.received / existingJob.total) * 100)
          : 0,
        message: resumeMsg,
        received: existingJob?.received,
        total: existingJob?.total ?? null
      })
      const rd = await resumableDownload({
        id: FORGE_PACK.id,
        url: FORGE_PACK.url,
        dest: archivePath,
        label: FORGE_PACK.label,
        signal: ac.signal,
        maxRetries: 15,
        retryBaseMs: 2000,
        onProgress: (received, total, job) => {
          const pct = total ? Math.min(99, (received / total) * 100) : 0
          const extra =
            job.error && /reintento/i.test(job.error) ? ` · ${job.error}` : ''
          sendProgress(win, {
            phase: 'download-pack',
            pct,
            message: `Descargando pack Forge (reanudable)…${extra}`,
            received,
            total
          })
        },
        onRetry: (attempt, max, error, waitMs) => {
          sendProgress(win, {
            phase: 'download-pack',
            pct: 0,
            message: `Red inestable — reintento ${attempt}/${max} en ${Math.round(waitMs / 1000)}s (${error.slice(0, 60)})`
          })
        },
        onControl: (ctrl) => {
          activeDownloadControl = ctrl
        }
      })
      if (!rd.ok) {
        if (rd.paused) {
          sendProgress(win, {
            phase: 'error',
            pct: existingJob?.total
              ? Math.min(99, ((await loadDownloadJob(archivePath))?.received || 0) / (existingJob.total || 1) * 100)
              : 0,
            message: 'Descarga pausada. Puedes reanudar después (incluso si cierras la app).'
          })
          return { ok: false, error: 'Pausado — progreso guardado', cancelled: false }
        }
        if (rd.cancelled) {
          return { ok: false, error: 'Cancelado', cancelled: true }
        }
        return { ok: false, error: rd.error }
      }
    }

    const seven = await ensureSevenZr(ac.signal, win)

    sendProgress(win, {
      phase: 'extract',
      pct: 0,
      message: 'Extrayendo (puede tardar varios minutos)…'
    })

    // Extract into forgeInstallPath (may create nested folder)
    const extractTarget = profile.forgeInstallPath
    await mkdir(extractTarget, { recursive: true })
    await extract7z(seven, archivePath, extractTarget, ac.signal)

    sendProgress(win, {
      phase: 'configure',
      pct: 90,
      message: 'Configurando launcher API…'
    })

    const forgeRoot = await findForgeRoot(extractTarget)
    const launcher = await writeApiLauncher(forgeRoot)

    // Optional: leave a marker
    await writeFile(
      join(profile.preferredDataRoot, 'FORGE-INSTALLED.txt'),
      `Forge root: ${forgeRoot}\nLauncher: ${launcher}\nPack: ${FORGE_PACK.id}\nAt: ${new Date().toISOString()}\n`,
      'utf-8'
    )

    sendProgress(win, {
      phase: 'done',
      pct: 100,
      message: 'Forge extraído. Ejecuta run-kawaii-api.bat (primer arranque tarda).'
    })

    return { ok: true, forgeRoot, launcher, profile }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'PAUSED' || /pausad/i.test(message)) {
      sendProgress(win, {
        phase: 'error',
        pct: 0,
        message: 'Pausado — progreso guardado en disco. Reanuda con Instalar Forge.'
      })
      return { ok: false, error: 'Pausado — progreso guardado', cancelled: false }
    }
    if (message === 'CANCELLED') {
      sendProgress(win, { phase: 'error', pct: 0, message: 'Cancelado' })
      return { ok: false, error: 'Cancelado', cancelled: true }
    }
    const cancelled = ac.signal.aborted
    sendProgress(win, {
      phase: 'error',
      pct: 0,
      message: cancelled ? 'Interrumpido — se puede reanudar' : message
    })
    return { ok: false, error: message, cancelled }
  } finally {
    activeAbort = null
    activeDownloadControl = null
  }
}

export async function openForgeFolder(): Promise<{ ok: boolean; path: string }> {
  const { shell } = await import('electron')
  const profile = (await loadMachineProfile()) || (await ensureMachineProfile({})).profile
  await ensureDataRootWorkspace(profile)
  await shell.openPath(profile.forgeInstallPath)
  return { ok: true, path: profile.forgeInstallPath }
}
