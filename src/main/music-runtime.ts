/**
 * ACE-Step 1.5 runtime: ensure env (uv), start API, health, generate.
 * Phase 2 — automatic, local, transparent.
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, writeFile, readFile, appendFile } from 'fs/promises'
import { spawn, type ChildProcess } from 'child_process'
import { createServer } from 'net'
import { platform } from 'os'
import {
  ensureMusicWorkspace,
  loadMusicState,
  saveMusicState
} from './music-workspace'
import { ensurePortablePython, portablePythonExe, isPortablePythonReady } from './python-runtime'
import { ensureMachineProfile } from './machine-profile'

export const MUSIC_API_PORTS = [8001, 8002, 8003, 8010, 8011, 8020]

export type MusicRuntimeState = {
  state: 'stopped' | 'starting' | 'running' | 'error'
  port: number | null
  baseUrl: string | null
  pid: number | null
  message: string
  backend: 'ace-step' | 'none'
  bootProgress?: number
  lastLogLine?: string
}

let child: ChildProcess | null = null
let runtime: MusicRuntimeState = {
  state: 'stopped',
  port: null,
  baseUrl: null,
  pid: null,
  message: 'Detenido',
  backend: 'none'
}

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.webContents.send(channel, payload)
    } catch {
      /* ignore */
    }
  }
}

function setRuntime(partial: Partial<MusicRuntimeState>) {
  runtime = { ...runtime, ...partial }
  broadcast('music:runtime', runtime)
}

async function canBindPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer()
    s.once('error', () => resolve(false))
    s.once('listening', () => {
      s.close(() => resolve(true))
    })
    s.listen(port, '127.0.0.1')
  })
}

export async function pickMusicPort(preferred?: number | null): Promise<number> {
  const ordered = [
    ...(preferred && Number.isFinite(preferred) ? [Number(preferred)] : []),
    ...MUSIC_API_PORTS
  ]
  const seen = new Set<number>()
  for (const p of ordered) {
    if (seen.has(p) || p < 1024) continue
    seen.add(p)
    if (await canBindPort(p)) return p
  }
  for (let p = 18001; p < 18040; p++) {
    if (await canBindPort(p)) return p
  }
  throw new Error('No hay puertos libres para ACE-Step API (8001–8020).')
}

function toolsDir(): string {
  return join(app.getPath('userData'), 'tools')
}

export function uvExePath(): string {
  if (platform() === 'win32') return join(toolsDir(), 'uv.exe')
  return join(toolsDir(), 'uv')
}

/** Download standalone uv if missing (Windows/Linux). */
export async function ensureUv(
  onProgress?: (msg: string, pct?: number) => void
): Promise<{ ok: true; uv: string } | { ok: false; error: string }> {
  const uv = uvExePath()
  if (existsSync(uv)) {
    onProgress?.('uv listo', 100)
    return { ok: true, uv }
  }
  await mkdir(toolsDir(), { recursive: true })
  onProgress?.('Descargando uv (gestor de paquetes)…', 5)

  const isWin = platform() === 'win32'
  // Official standalone builds from astral-sh/uv releases — pin a recent known pattern
  const url = isWin
    ? 'https://github.com/astral-sh/uv/releases/download/0.6.14/uv-x86_64-pc-windows-msvc.zip'
    : 'https://github.com/astral-sh/uv/releases/download/0.6.14/uv-x86_64-unknown-linux-gnu.tar.gz'

  try {
    const destZip = join(toolsDir(), isWin ? 'uv.zip' : 'uv.tgz')
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`uv download HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(destZip, buf)
    onProgress?.('Extrayendo uv…', 60)

    if (isWin) {
      await new Promise<void>((resolve, reject) => {
        const ps = spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `Expand-Archive -LiteralPath '${destZip.replace(/'/g, "''")}' -DestinationPath '${toolsDir().replace(/'/g, "''")}' -Force`
          ],
          { windowsHide: true }
        )
        ps.on('error', reject)
        ps.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`Expand uv exit ${c}`))))
      })
      // may extract as uv.exe in tools or nested folder
      if (!existsSync(uv)) {
        const { readdir } = await import('fs/promises')
        const entries = await readdir(toolsDir())
        for (const e of entries) {
          const p = join(toolsDir(), e)
          if (e === 'uv.exe' || e.endsWith('uv.exe')) {
            if (p !== uv) {
              try {
                const { copyFile } = await import('fs/promises')
                await copyFile(p, uv)
              } catch {
                /* ignore */
              }
            }
          }
        }
      }
    } else {
      await new Promise<void>((resolve, reject) => {
        const t = spawn('tar', ['-xzf', destZip, '-C', toolsDir()])
        t.on('error', reject)
        t.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`tar uv exit ${c}`))))
      })
    }

    if (!existsSync(uv)) {
      // nested path uv-x86_64-.../uv.exe
      const { readdir, stat, copyFile } = await import('fs/promises')
      async function findUv(dir: string, depth = 0): Promise<string | null> {
        if (depth > 3) return null
        const ents = await readdir(dir)
        for (const e of ents) {
          const p = join(dir, e)
          if (e === 'uv.exe' || e === 'uv') {
            const st = await stat(p)
            if (st.isFile()) return p
          }
        }
        for (const e of ents) {
          const p = join(dir, e)
          try {
            const st = await stat(p)
            if (st.isDirectory()) {
              const f = await findUv(p, depth + 1)
              if (f) return f
            }
          } catch {
            /* ignore */
          }
        }
        return null
      }
      const found = await findUv(toolsDir())
      if (found) {
        const { copyFile } = await import('fs/promises')
        await copyFile(found, uv)
      }
    }

    if (!existsSync(uv)) throw new Error('uv.exe no encontrado tras extracción')
    onProgress?.('uv listo', 100)
    return { ok: true, uv }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const childProc = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsHide: true,
      shell: false
    })
    let stdout = ''
    let stderr = ''
    const t = opts.timeoutMs
      ? setTimeout(() => {
          try {
            childProc.kill()
          } catch {
            /* ignore */
          }
        }, opts.timeoutMs)
      : null
    childProc.stdout?.on('data', (d) => {
      stdout += d.toString()
    })
    childProc.stderr?.on('data', (d) => {
      stderr += d.toString()
    })
    childProc.on('close', (code) => {
      if (t) clearTimeout(t)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    childProc.on('error', (err) => {
      if (t) clearTimeout(t)
      resolve({ code: 1, stdout, stderr: err.message })
    })
  })
}

export type MusicSetupProgress = {
  phase: 'uv' | 'sync' | 'models' | 'ready' | 'error'
  pct: number
  message: string
}

/**
 * Phase 2 setup: uv + uv sync in ACE dir. Models download on first API use or acestep-download.
 */
export async function ensureAceEnvironment(
  onProgress?: (p: MusicSetupProgress) => void
): Promise<{ ok: boolean; error?: string; aceDir?: string }> {
  const state = await loadMusicState()
  if (!state.eligibility.ace.eligible) {
    return { ok: false, error: state.eligibility.ace.reason }
  }
  if (!state.ace.present) {
    return {
      ok: false,
      error: 'Código ACE-Step no instalado. Ejecuta music:install primero (fase 1).'
    }
  }

  const aceDir = state.ace.path
  if (!existsSync(aceDir)) {
    return { ok: false, error: `Carpeta ACE no existe: ${aceDir}` }
  }

  const emit = (p: MusicSetupProgress) => {
    onProgress?.(p)
    broadcast('music:setup-progress', p)
  }

  emit({ phase: 'uv', pct: 5, message: 'Preparando uv…' })
  const uvRes = await ensureUv((msg, pct) =>
    emit({ phase: 'uv', pct: pct ?? 10, message: msg })
  )
  if (!uvRes.ok) {
    // Fallback: try portable python path note — uv is strongly preferred for ACE
    return { ok: false, error: `No se pudo instalar uv: ${uvRes.error}` }
  }

  // Persist job step
  state.ace.stage = 'venv'
  await saveMusicState(state)

  emit({ phase: 'sync', pct: 20, message: 'Instalando dependencias ACE-Step (uv sync)… esto puede tardar varios minutos' })
  const sync = await runCmd(uvRes.uv, ['sync'], {
    cwd: aceDir,
    timeoutMs: 45 * 60 * 1000
  })
  if (sync.code !== 0) {
    const err = (sync.stderr || sync.stdout || 'uv sync falló').slice(0, 800)
    state.ace.stage = 'error'
    state.ace.lastError = err
    await saveMusicState(state)
    emit({ phase: 'error', pct: 0, message: err })
    return { ok: false, error: err }
  }

  emit({ phase: 'models', pct: 70, message: 'Descargando modelos ACE (turbo)…' })
  // acestep-download — main/turbo weights; first run of API also downloads if needed
  const dl = await runCmd(
    uvRes.uv,
    ['run', 'acestep-download', '--model', 'acestep-v15-turbo'],
    { cwd: aceDir, timeoutMs: 60 * 60 * 1000 }
  )
  // Non-fatal if download CLI fails — API may still pull on start
  if (dl.code !== 0) {
    emit({
      phase: 'models',
      pct: 85,
      message: `Aviso descarga modelos: ${(dl.stderr || dl.stdout || '').slice(0, 200)}. Se reintentará al arrancar la API.`
    })
  }

  state.ace.stage = 'ready'
  state.ace.lastError = undefined
  await saveMusicState(state)
  emit({ phase: 'ready', pct: 100, message: 'Entorno ACE listo' })
  return { ok: true, aceDir }
}

function logPath(musicRoot: string): string {
  return join(musicRoot, 'ace-api.log')
}

export async function probeMusicHealth(
  baseUrl: string,
  timeoutMs = 5000
): Promise<{ ok: boolean; error?: string }> {
  const root = baseUrl.replace(/\/$/, '')
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${root}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    if (res.ok) return { ok: true }
    return { ok: false, error: `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function getMusicRuntimeStatus(): MusicRuntimeState {
  return { ...runtime }
}

export async function stopMusicRuntime(): Promise<MusicRuntimeState> {
  if (child) {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    child = null
  }
  setRuntime({
    state: 'stopped',
    port: null,
    baseUrl: null,
    pid: null,
    message: 'Detenido',
    backend: 'none',
    bootProgress: 0
  })
  return getMusicRuntimeStatus()
}

export async function startMusicRuntime(opts?: {
  preferredPort?: number
  skipSetup?: boolean
}): Promise<MusicRuntimeState> {
  if (runtime.state === 'running' && runtime.baseUrl) {
    const h = await probeMusicHealth(runtime.baseUrl)
    if (h.ok) return getMusicRuntimeStatus()
  }

  await stopMusicRuntime()

  const state = await loadMusicState()
  if (!state.eligibility.ace.eligible) {
    setRuntime({
      state: 'error',
      message: state.eligibility.ace.reason,
      backend: 'none'
    })
    return getMusicRuntimeStatus()
  }

  if (!opts?.skipSetup && state.ace.stage !== 'ready') {
    setRuntime({ state: 'starting', message: 'Preparando entorno ACE…', bootProgress: 10 })
    const setup = await ensureAceEnvironment((p) => {
      setRuntime({
        state: 'starting',
        message: p.message,
        bootProgress: p.pct,
        backend: 'ace-step'
      })
    })
    if (!setup.ok) {
      setRuntime({ state: 'error', message: setup.error || 'Setup falló', backend: 'ace-step' })
      return getMusicRuntimeStatus()
    }
  }

  const aceDir = state.ace.path
  const uvRes = await ensureUv()
  if (!uvRes.ok) {
    setRuntime({ state: 'error', message: uvRes.error, backend: 'ace-step' })
    return getMusicRuntimeStatus()
  }

  const port = await pickMusicPort(opts?.preferredPort ?? 8001)
  const { musicRoot } = await ensureMusicWorkspace()
  const logFile = logPath(musicRoot)

  // LM model by VRAM tier
  const tier = state.eligibility.ace.tier
  const lmArg =
    tier === 'turbo' || (state.eligibility.vramGB != null && state.eligibility.vramGB < 12)
      ? ['--lm_model_path', 'acestep-5Hz-lm-0.6B']
      : ['--lm_model_path', 'acestep-5Hz-lm-1.7B']

  const configArg = ['--config_path', 'acestep-v15-turbo']

  setRuntime({
    state: 'starting',
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    message: 'Arrancando ACE-Step API…',
    backend: 'ace-step',
    bootProgress: 40
  })

  const args = [
    'run',
    'acestep-api',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    ...configArg,
    ...lmArg
  ]

  try {
    await writeFile(logFile, `==== ACE API ${new Date().toISOString()} ====\ncmd=${uvRes.uv} ${args.join(' ')}\n`, 'utf-8')
  } catch {
    /* ignore */
  }

  child = spawn(uvRes.uv, args, {
    cwd: aceDir,
    windowsHide: true,
    env: {
      ...process.env,
      ACESTEP_API_HOST: '127.0.0.1',
      ACESTEP_API_PORT: String(port)
    }
  })

  setRuntime({ pid: child.pid ?? null })

  child.stdout?.on('data', (d) => {
    const line = d.toString().trim()
    if (line) {
      setRuntime({ lastLogLine: line.slice(0, 200) })
      appendFile(logFile, line + '\n').catch(() => {})
    }
  })
  child.stderr?.on('data', (d) => {
    const line = d.toString().trim()
    if (line) {
      setRuntime({ lastLogLine: line.slice(0, 200) })
      appendFile(logFile, line + '\n').catch(() => {})
    }
  })
  child.on('exit', (code) => {
    if (runtime.state === 'running' || runtime.state === 'starting') {
      setRuntime({
        state: 'error',
        message: `ACE API terminó (code ${code})`,
        pid: null
      })
    }
    child = null
  })

  // Poll health up to ~8 min (model load)
  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 8 * 60 * 1000
  let attempt = 0
  while (Date.now() < deadline) {
    attempt++
    const h = await probeMusicHealth(baseUrl, 4000)
    if (h.ok) {
      setRuntime({
        state: 'running',
        port,
        baseUrl,
        message: 'ACE-Step API lista',
        backend: 'ace-step',
        bootProgress: 100
      })
      return getMusicRuntimeStatus()
    }
    setRuntime({
      state: 'starting',
      bootProgress: Math.min(95, 40 + attempt * 2),
      message: `Cargando modelos ACE… (${h.error || 'esperando'})`
    })
    await new Promise((r) => setTimeout(r, 3000))
  }

  setRuntime({
    state: 'error',
    message: 'Timeout esperando /health de ACE-Step. Revisa ace-api.log en la carpeta music.',
    backend: 'ace-step'
  })
  return getMusicRuntimeStatus()
}

export async function ensureMusicReady(preferredPort?: number): Promise<MusicRuntimeState> {
  const cur = getMusicRuntimeStatus()
  if (cur.state === 'running' && cur.baseUrl) {
    const h = await probeMusicHealth(cur.baseUrl)
    if (h.ok) return cur
  }
  return startMusicRuntime({ preferredPort })
}

export type MusicGenerateRequest = {
  prompt: string
  lyrics?: string
  durationSec?: number
  vocalLanguage?: string
}

export type MusicGenerateResult = {
  ok: boolean
  path?: string
  taskId?: string
  error?: string
  baseUrl?: string
}

/**
 * Generate via ACE /release_task + poll /query_result, save to outputs/.
 */
export async function generateMusicTrack(
  req: MusicGenerateRequest
): Promise<MusicGenerateResult> {
  const rt = await ensureMusicReady()
  if (rt.state !== 'running' || !rt.baseUrl) {
    return { ok: false, error: rt.message || 'ACE-Step no está en ejecución' }
  }

  const base = rt.baseUrl.replace(/\/$/, '')
  const duration = Math.min(600, Math.max(15, req.durationSec ?? 60))
  const body = {
    prompt: req.prompt,
    caption: req.prompt,
    lyrics: req.lyrics || '',
    duration,
    audio_duration: duration,
    vocal_language: req.vocalLanguage || 'es',
    audio_format: 'mp3',
    inference_steps: 8,
    batch_size: 1
  }

  try {
    const createRes = await fetch(`${base}/release_task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const createJson = (await createRes.json().catch(() => ({}))) as Record<string, unknown>
    if (!createRes.ok) {
      return {
        ok: false,
        error: `release_task HTTP ${createRes.status}: ${JSON.stringify(createJson).slice(0, 300)}`,
        baseUrl: base
      }
    }

    // Extract task id from various response shapes
    let taskId =
      (createJson.task_id as string) ||
      (createJson.taskId as string) ||
      ((createJson.data as Record<string, unknown>)?.task_id as string) ||
      ''
    if (!taskId && Array.isArray((createJson.data as Record<string, unknown>)?.tasks)) {
      const tasks = (createJson.data as { tasks: Array<{ task_id?: string }> }).tasks
      taskId = tasks[0]?.task_id || ''
    }
    if (!taskId && typeof createJson.id === 'string') taskId = createJson.id

    // Some servers return task list at top level
    if (!taskId && Array.isArray(createJson.task_id_list)) {
      taskId = String((createJson.task_id_list as string[])[0] || '')
    }

    if (!taskId) {
      // Try nested data.id
      const data = createJson.data as Record<string, unknown> | undefined
      if (data && typeof data.id === 'string') taskId = data.id
    }

    if (!taskId) {
      return {
        ok: false,
        error: `No se obtuvo task_id: ${JSON.stringify(createJson).slice(0, 400)}`,
        baseUrl: base
      }
    }

    // Poll
    const deadline = Date.now() + 10 * 60 * 1000
    let audioPath: string | null = null
    while (Date.now() < deadline) {
      const q = await fetch(`${base}/query_result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id_list: [taskId] })
      })
      const qj = (await q.json().catch(() => ({}))) as Record<string, unknown>
      // Status: 0 processing, 1 success, 2 failed — shapes vary
      const data = qj.data ?? qj
      const list = Array.isArray(data)
        ? data
        : Array.isArray((data as Record<string, unknown>)?.results)
          ? ((data as Record<string, unknown>).results as unknown[])
          : [data]

      for (const item of list) {
        const it = item as Record<string, unknown>
        const status = it.status ?? it.state ?? it.code
        if (status === 2 || status === 'failed' || status === 'error') {
          return {
            ok: false,
            error: String(it.error || it.message || 'Generación fallida'),
            taskId,
            baseUrl: base
          }
        }
        const path =
          (it.audio_path as string) ||
          (it.path as string) ||
          (it.file_path as string) ||
          ((it.result as Record<string, unknown>)?.path as string) ||
          null
        if (status === 1 || status === 'success' || status === 'completed' || path) {
          if (path) audioPath = path
          if (status === 1 || status === 'success' || status === 'completed') {
            if (!audioPath && typeof it.audio_url === 'string') {
              // download from url
              audioPath = await downloadAudioToOutputs(String(it.audio_url), taskId)
            }
            break
          }
        }
      }
      if (audioPath) break
      await new Promise((r) => setTimeout(r, 2500))
    }

    if (!audioPath) {
      return { ok: false, error: 'Timeout esperando el audio', taskId, baseUrl: base }
    }

    // If path is local on ACE machine, copy to our outputs; if URL, download
    const localOut = await materializeAudio(audioPath, taskId, base)
    return { ok: true, path: localOut, taskId, baseUrl: base }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), baseUrl: base }
  }
}

async function downloadAudioToOutputs(url: string, taskId: string): Promise<string> {
  const { outputsDir } = await ensureMusicWorkspace()
  await mkdir(outputsDir, { recursive: true })
  const dest = join(outputsDir, `ace-${taskId.slice(0, 12)}-${Date.now()}.mp3`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download audio HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
  return dest
}

async function materializeAudio(
  audioPath: string,
  taskId: string,
  baseUrl: string
): Promise<string> {
  const { outputsDir } = await ensureMusicWorkspace()
  await mkdir(outputsDir, { recursive: true })
  const dest = join(outputsDir, `ace-${taskId.slice(0, 12)}-${Date.now()}.mp3`)

  if (audioPath.startsWith('http://') || audioPath.startsWith('https://')) {
    return downloadAudioToOutputs(audioPath, taskId)
  }

  // Try API download endpoint
  try {
    const q = new URLSearchParams({ path: audioPath })
    const res = await fetch(`${baseUrl}/v1/audio?${q}`)
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      await writeFile(dest, buf)
      return dest
    }
  } catch {
    /* fall through */
  }

  // Local file on disk
  if (existsSync(audioPath)) {
    const { copyFile } = await import('fs/promises')
    await copyFile(audioPath, dest)
    return dest
  }

  // Last resort: return original path
  return audioPath
}

/** Ensure portable python exists for future YuE / fallbacks (does not replace uv for ACE). */
export async function ensureMusicPythonFallback(): Promise<void> {
  try {
    const { profile } = await ensureMachineProfile()
    if (!isPortablePythonReady(profile.preferredDataRoot)) {
      await ensurePortablePython(profile.preferredDataRoot)
    }
  } catch {
    /* optional */
  }
}
