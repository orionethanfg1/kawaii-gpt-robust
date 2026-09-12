/**
 * Phase 1 music installer: ACE-Step (+ YuE if eligible).
 * Automatic, resumable downloads into preferredDataRoot/music.
 */

import { BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { spawn } from 'child_process'
import { platform } from 'os'
import {
  ensureMusicWorkspace,
  loadMusicState,
  saveMusicState,
  type MusicInstallState
} from './music-workspace'
import { resumableDownload, type DownloadControl } from './resumable-download'

const ACE_REPO_ZIP =
  'https://github.com/ACE-Step/ACE-Step-1.5/archive/refs/heads/main.zip'
const YUE_REPO_ZIP =
  'https://github.com/multimodal-art-projection/YuE/archive/refs/heads/main.zip'

export type MusicInstallProgress = {
  backend: 'ace-step' | 'yue'
  phase: 'download' | 'extract' | 'mark' | 'done' | 'error' | 'skipped'
  pct: number
  message: string
  received?: number
  total?: number | null
}

let activeAbort: AbortController | null = null
let activeDownloadControl: DownloadControl | null = null

function broadcast(p: MusicInstallProgress) {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.webContents.send('music:install-progress', p)
    } catch {
      /* ignore */
    }
  }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true })
  if (platform() === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const ps = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
        ],
        { windowsHide: true }
      )
      ps.on('error', reject)
      ps.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`Expand-Archive exit ${code}`))
      )
    })
  } else {
    await new Promise<void>((resolve, reject) => {
      const u = spawn('unzip', ['-o', zipPath, '-d', destDir])
      u.on('error', reject)
      u.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`unzip exit ${code}`))
      )
    })
  }
}

async function flattenGithubExtract(extractParent: string, targetDir: string): Promise<void> {
  const { readdir, stat, cp, rm } = await import('fs/promises')
  const entries = await readdir(extractParent)
  const sub = entries.find(
    (e) => e.includes('ACE-Step') || e.includes('YuE') || e.endsWith('-main')
  )
  if (!sub) return
  const src = join(extractParent, sub)
  const st = await stat(src)
  if (!st.isDirectory()) return
  await mkdir(targetDir, { recursive: true })
  const kids = await readdir(src)
  for (const k of kids) {
    await cp(join(src, k), join(targetDir, k), { recursive: true, force: true })
  }
  try {
    await rm(src, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

export function cancelMusicInstall(): void {
  activeAbort?.abort()
  activeDownloadControl?.cancel?.(false)
  activeAbort = null
  activeDownloadControl = null
}

export async function installMusicStack(opts?: {
  forceAce?: boolean
  forceYue?: boolean
}): Promise<{ ok: boolean; state: MusicInstallState; error?: string }> {
  const { musicRoot, aceDir, yueDir } = await ensureMusicWorkspace()
  let state = await loadMusicState()
  const downloads = join(musicRoot, 'downloads')
  await mkdir(downloads, { recursive: true })

  activeAbort = new AbortController()
  const signal = activeAbort.signal

  try {
    // --- ACE-Step ---
    if (!state.eligibility.ace.eligible && !opts?.forceAce) {
      broadcast({
        backend: 'ace-step',
        phase: 'skipped',
        pct: 0,
        message: state.eligibility.ace.reason
      })
    } else if (state.ace.stage !== 'ready' || opts?.forceAce) {
      if (state.ace.stage === 'cloned' && existsSync(join(aceDir, '.installed')) && !opts?.forceAce) {
        broadcast({
          backend: 'ace-step',
          phase: 'done',
          pct: 100,
          message: 'ACE-Step ya tiene código (fase 1).'
        })
      } else {
        broadcast({
          backend: 'ace-step',
          phase: 'download',
          pct: 2,
          message: 'Descargando ACE-Step 1.5 (código fuente)…'
        })
        const aceZip = join(downloads, 'ace-step-main.zip')
        const r = await resumableDownload({
          id: 'music-ace-repo',
          url: ACE_REPO_ZIP,
          dest: aceZip,
          label: 'ACE-Step 1.5 source',
          signal,
          onProgress: (received, total) => {
            const pct = total ? Math.min(70, 5 + Math.round((received / total) * 65)) : 10
            broadcast({
              backend: 'ace-step',
              phase: 'download',
              pct,
              message: 'Descargando ACE-Step…',
              received,
              total
            })
          },
          onControl: (ctrl) => {
            activeDownloadControl = ctrl
          }
        })
        if (!r.ok) {
          if (r.paused) throw new Error('PAUSED')
          if (r.cancelled) throw new Error('CANCELLED')
          throw new Error(r.error)
        }

        broadcast({
          backend: 'ace-step',
          phase: 'extract',
          pct: 75,
          message: 'Extrayendo ACE-Step…'
        })
        const aceExtract = join(downloads, 'ace-extract')
        await mkdir(aceExtract, { recursive: true })
        await extractZip(aceZip, aceExtract)
        await flattenGithubExtract(aceExtract, aceDir)
        await writeFile(join(aceDir, '.installed'), new Date().toISOString(), 'utf-8')
        await writeFile(
          join(aceDir, 'kawaii-meta.json'),
          JSON.stringify(
            {
              backend: 'ace-step',
              tier: state.eligibility.ace.tier,
              phase1: true,
              note: 'Fase 1: código. Fase 2: venv + pesos + acestep-api'
            },
            null,
            2
          ),
          'utf-8'
        )
        state.ace = {
          present: true,
          path: aceDir,
          stage: 'cloned',
          lastError: undefined
        }
        await saveMusicState(state)
        broadcast({
          backend: 'ace-step',
          phase: 'done',
          pct: 100,
          message: 'ACE-Step código listo (fase 1).'
        })
      }
    }

    // --- YuE ---
    state = await loadMusicState()
    if (!state.eligibility.yue.eligible && !opts?.forceYue) {
      state.yue = {
        ...state.yue,
        stage: 'disabled',
        disabledReason: state.eligibility.yue.reason
      }
      await saveMusicState(state)
      broadcast({
        backend: 'yue',
        phase: 'skipped',
        pct: 0,
        message: state.eligibility.yue.reason
      })
    } else if (
      (state.yue.stage === 'none' || state.yue.stage === 'error' || opts?.forceYue) &&
      (state.eligibility.yue.eligible || opts?.forceYue)
    ) {
      broadcast({
        backend: 'yue',
        phase: 'download',
        pct: 2,
        message: 'Descargando YuE (código fuente)…'
      })
      const yueZip = join(downloads, 'yue-main.zip')
      const r = await resumableDownload({
        id: 'music-yue-repo',
        url: YUE_REPO_ZIP,
        dest: yueZip,
        label: 'YuE source',
        signal,
        onProgress: (received, total) => {
          const pct = total ? Math.min(70, 5 + Math.round((received / total) * 65)) : 10
          broadcast({
            backend: 'yue',
            phase: 'download',
            pct,
            message: 'Descargando YuE…',
            received,
            total
          })
        },
        onControl: (ctrl) => {
          activeDownloadControl = ctrl
        }
      })
      if (!r.ok) {
        if (r.paused) throw new Error('PAUSED')
        if (r.cancelled) throw new Error('CANCELLED')
        throw new Error(r.error)
      }

      broadcast({ backend: 'yue', phase: 'extract', pct: 75, message: 'Extrayendo YuE…' })
      const yueExtract = join(downloads, 'yue-extract')
      await mkdir(yueExtract, { recursive: true })
      await extractZip(yueZip, yueExtract)
      await flattenGithubExtract(yueExtract, yueDir)
      await writeFile(join(yueDir, '.installed'), new Date().toISOString(), 'utf-8')
      state.yue = {
        present: true,
        path: yueDir,
        stage: 'cloned',
        lastError: undefined
      }
      await saveMusicState(state)
      broadcast({ backend: 'yue', phase: 'done', pct: 100, message: 'YuE código listo (fase 1).' })
    }

    state = await loadMusicState()
    // Phase 2: try env setup (uv sync + models) — non-blocking failure surfaces in state
    try {
      const { ensureAceEnvironment } = await import('./music-runtime')
      if (state.eligibility.ace.eligible && state.ace.present) {
        broadcast({
          backend: 'ace-step',
          phase: 'mark',
          pct: 90,
          message: 'Fase 2: instalando entorno Python/uv y modelos…'
        })
        const setup = await ensureAceEnvironment((p) => {
          broadcast({
            backend: 'ace-step',
            phase: p.phase === 'error' ? 'error' : 'mark',
            pct: p.pct,
            message: p.message
          })
        })
        state = await loadMusicState()
        if (!setup.ok) {
          return { ok: true, state, error: setup.error }
        }
      }
    } catch (e) {
      /* phase2 optional at end of install */
    }
    state = await loadMusicState()
    return { ok: true, state }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    broadcast({ backend: 'ace-step', phase: 'error', pct: 0, message: msg })
    try {
      state = await loadMusicState()
      if (state.ace.stage !== 'ready') {
        state.ace.lastError = msg
        state.ace.stage = state.ace.present ? 'error' : 'none'
        await saveMusicState(state)
      }
    } catch {
      /* ignore */
    }
    return { ok: false, state: await loadMusicState(), error: msg }
  } finally {
    activeAbort = null
    activeDownloadControl = null
  }
}
