/**
 * ACE-Step 1.5 runtime: ensure env (uv), start API, health, generate.
 * Phase 2 — automatic, local, transparent.
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, appendFileSync } from 'fs'
import { mkdir, writeFile, readFile } from 'fs/promises'
import { spawn, type ChildProcess } from 'child_process'
import { createServer } from 'net'
import { platform } from 'os'
import {
  ensureMusicWorkspace,
  loadMusicState,
  saveMusicState
} from './music-workspace'

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

export type MusicSetupProgress = {
  phase: 'uv' | 'sync' | 'models' | 'ready' | 'error'
  pct: number
  message: string
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
let musicLogPath: string | null = null
let musicLogTail: string[] = []

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.webContents.send(channel, payload)
    } catch {
      /* ignore */
    }
  }
}

function appendMusicLog(line: string): void {
  const t = line.replace(/\r/g, '').trimEnd()
  if (!t) return
  musicLogTail.push(t)
  if (musicLogTail.length > 250) musicLogTail.shift()
  if (musicLogPath) {
    try {
      appendFileSync(musicLogPath, t + '\n', 'utf-8')
    } catch {
      /* ignore */
    }
  }
  broadcast('music:log-line', { line: t, tail: musicLogTail.slice(-120) })
}

export function getMusicLogTail(): string[] {
  return [...musicLogTail]
}

export function getMusicLogPath(): string | null {
  return musicLogPath
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

export async function ensureUv(
  onProgress?: (msg: string, pct?: number) => void
): Promise<{ ok: true; uv: string } | { ok: false; error: string }> {
  const uv = uvExePath()
  if (existsSync(uv)) {
    onProgress?.('uv listo', 100)
    return { ok: true, uv }
  }
  await mkdir(toolsDir(), { recursive: true })
  onProgress?.('Descargando uv…', 5)
  const isWin = platform() === 'win32'
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
      const { spawnSync } = await import('child_process')
      spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path '${destZip}' -DestinationPath '${toolsDir()}' -Force`
        ],
        { timeout: 120000, windowsHide: true }
      )
      const candidates = [
        join(toolsDir(), 'uv.exe'),
        join(toolsDir(), 'uv-x86_64-pc-windows-msvc', 'uv.exe')
      ]
      for (const c of candidates) {
        if (existsSync(c)) {
          onProgress?.('uv listo', 100)
          return { ok: true, uv: c }
        }
      }
    }
    return { ok: false, error: 'No se pudo extraer uv' }
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

function aceVenvPython(aceDir: string): string | null {
  const win = join(aceDir, '.venv', 'Scripts', 'python.exe')
  const nix = join(aceDir, '.venv', 'bin', 'python')
  if (existsSync(win)) return win
  if (existsSync(nix)) return nix
  return null
}

async function probeTorchAo(
  uv: string,
  aceDir: string,
  noSync: boolean
): Promise<{ torch: string; ao: string; raw: string }> {
  const script = join(aceDir, '_kawaii_probe_torch.py')
  const body =
    'import torch\n' +
    'import importlib.metadata as m\n' +
    'v = "missing"\n' +
    'try:\n' +
    '    v = m.version("torchao")\n' +
    'except Exception:\n' +
    '    pass\n' +
    'print(torch.__version__ + "|" + v)\n'
  try {
    await writeFile(script, body, 'utf-8')
  } catch (e) {
    return { torch: '?', ao: '?', raw: String(e) }
  }
  const args = noSync
    ? (['run', '--no-sync', 'python', script] as string[])
    : (['run', 'python', script] as string[])
  const r = await runCmd(uv, args, { cwd: aceDir, timeoutMs: 180_000 })
  const raw = `${r.stdout || ''}\n${r.stderr || ''}`.trim()
  const line =
    raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(
        (s) =>
          /\d+\.\d+/.test(s) &&
          s.includes('|') &&
          !/SyntaxError|File "/i.test(s)
      )
      .pop() || ''
  if (!line) {
    return { torch: '?', ao: '?', raw }
  }
  const parts = line.split('|').map((s) => s.trim())
  return { torch: parts[0] || '?', ao: parts[1] || '?', raw }
}

async function persistTorchaoOverride(
  aceDir: string,
  pin: string,
  emit: (p: MusicSetupProgress) => void
): Promise<void> {
  const pyproject = join(aceDir, 'pyproject.toml')
  if (!existsSync(pyproject)) return
  let raw = await readFile(pyproject, 'utf-8')
  const overrideItem = `"torchao==${pin}"`
  if (/override-dependencies\s*=/.test(raw)) {
    if (/torchao==/.test(raw)) {
      raw = raw.replace(/"torchao==[^"]+"/g, overrideItem)
    } else {
      raw = raw.replace(
        /override-dependencies\s*=\s*\[/,
        `override-dependencies = [\n    ${overrideItem},`
      )
    }
  } else if (/\[tool\.uv\]/.test(raw)) {
    raw = raw.replace(
      /\[tool\.uv\]/,
      `[tool.uv]\noverride-dependencies = [\n    ${overrideItem},\n]`
    )
  } else {
    raw += `\n\n[tool.uv]\noverride-dependencies = [\n    ${overrideItem},\n]\n`
  }
  await writeFile(pyproject, raw, 'utf-8')
  emit({ phase: 'sync', pct: 50, message: `pyproject: override torchao==${pin}` })
  appendMusicLog(`[torch] pyproject override torchao==${pin}`)
}

async function repairAceTorchCompat(
  uv: string,
  aceDir: string,
  emit: (p: MusicSetupProgress) => void
): Promise<{ ok: boolean; detail: string }> {
  emit({ phase: 'sync', pct: 46, message: 'Leyendo torch/torchao del entorno ACE…' })
  appendMusicLog('[torch] probe…')
  let probe = await probeTorchAo(uv, aceDir, false)
  appendMusicLog(`[torch] probe → torch=${probe.torch} torchao=${probe.ao}`)
  if (!probe.torch || probe.torch === '?') {
    probe = await probeTorchAo(uv, aceDir, true)
    appendMusicLog(`[torch] probe --no-sync → ${probe.torch}|${probe.ao}`)
  }

  const mm = (probe.torch.match(/^(\d+\.\d+)/) || [])[1] || ''
  let pin = '0.12.0'
  if (mm === '2.10' || mm === '2.11') pin = '0.16.0'
  else if (mm === '2.9' || mm === '2.8') pin = '0.15.0'
  else if (mm === '2.7') pin = '0.12.0'
  else if (mm === '2.6') pin = '0.13.0'

  if (mm === '2.7' && /^0\.1[2-5]/.test(probe.ao) && !/^0\.16/.test(probe.ao)) {
    return { ok: true, detail: `${probe.torch} + torchao ${probe.ao}` }
  }
  if ((mm === '2.10' || mm === '2.11') && /^0\.16/.test(probe.ao)) {
    return { ok: true, detail: `${probe.torch} + torchao ${probe.ao}` }
  }
  if ((mm === '2.8' || mm === '2.9') && /^0\.15/.test(probe.ao)) {
    return { ok: true, detail: `${probe.torch} + torchao ${probe.ao}` }
  }

  emit({
    phase: 'sync',
    pct: 50,
    message: `Corrigiendo torchao ${probe.ao} → ${pin} (torch ${probe.torch})…`
  })
  appendMusicLog(`[torch] fixing ${probe.ao} → ${pin}`)

  await persistTorchaoOverride(aceDir, pin, emit)

  emit({ phase: 'sync', pct: 54, message: 'uv lock (pin torchao)…' })
  appendMusicLog('[torch] uv lock…')
  const lock = await runCmd(uv, ['lock'], { cwd: aceDir, timeoutMs: 600_000 })
  appendMusicLog(`[torch] lock code=${lock.code}`)

  emit({ phase: 'sync', pct: 58, message: 'uv sync…' })
  appendMusicLog('[torch] uv sync…')
  const sync = await runCmd(uv, ['sync'], { cwd: aceDir, timeoutMs: 600_000 })
  appendMusicLog(
    `[torch] sync code=${sync.code} ${(sync.stderr || sync.stdout || '').slice(0, 200)}`
  )

  const venvPy = aceVenvPython(aceDir)
  // uv pip does not need the venv's pip module
  emit({ phase: 'sync', pct: 62, message: `uv pip install torchao==${pin}…` })
  appendMusicLog(`[torch] uv pip install torchao==${pin}`)
  const uvPipArgs = venvPy
    ? ['pip', 'install', '--python', venvPy, '--reinstall', '--force-reinstall', `torchao==${pin}`]
    : ['pip', 'install', '--reinstall', '--force-reinstall', `torchao==${pin}`]
  const uvPip = await runCmd(uv, uvPipArgs, { cwd: aceDir, timeoutMs: 600_000 })
  appendMusicLog(
    `[torch] uv pip code=${uvPip.code} ${(uvPip.stderr || uvPip.stdout || '').slice(-220)}`
  )
  if (uvPip.code !== 0 && venvPy) {
    appendMusicLog('[torch] ensurepip + retry…')
    await runCmd(venvPy, ['-m', 'ensurepip', '--upgrade'], {
      cwd: aceDir,
      timeoutMs: 120_000
    })
    const pip2 = await runCmd(
      venvPy,
      ['-m', 'pip', 'install', '--force-reinstall', '--no-cache-dir', `torchao==${pin}`],
      { cwd: aceDir, timeoutMs: 600_000 }
    )
    appendMusicLog(`[torch] pip2 code=${pip2.code} ${(pip2.stderr || pip2.stdout || '').slice(-160)}`)
  }

  const after = await probeTorchAo(uv, aceDir, true)
  appendMusicLog(`[torch] after → ${after.torch}|${after.ao}`)
  if (after.torch === '?' || /SyntaxError/i.test(after.raw)) {
    return {
      ok: false,
      detail: `No se pudo leer torch/torchao. ${after.raw.slice(0, 180)}`
    }
  }

  if (mm === '2.7' || mm === '2.6') {
    if (/^0\.16/.test(after.ao)) {
      return {
        ok: false,
        detail: `torchao sigue en ${after.ao} con torch ${after.torch}. Pin ${pin} no aplicó — mira la consola.`
      }
    }
    if (/^0\.1[2-5]/.test(after.ao)) {
      return { ok: true, detail: `${after.torch} + torchao ${after.ao}` }
    }
  }
  if ((mm === '2.10' || mm === '2.11') && /^0\.16/.test(after.ao)) {
    return { ok: true, detail: `${after.torch} + torchao ${after.ao}` }
  }
  if ((mm === '2.8' || mm === '2.9') && /^0\.1[45]/.test(after.ao)) {
    return { ok: true, detail: `${after.torch} + torchao ${after.ao}` }
  }
  if (after.ao && after.ao !== 'missing' && !(mm === '2.7' && /^0\.16/.test(after.ao))) {
    return { ok: true, detail: `${after.torch} + torchao ${after.ao}` }
  }
  return { ok: false, detail: `torch=${after.torch} torchao=${after.ao} (objetivo ${pin})` }
}

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
    appendMusicLog(`[setup ${p.phase} ${p.pct}%] ${p.message}`)
  }

  emit({ phase: 'uv', pct: 5, message: 'Preparando uv…' })
  const uvRes = await ensureUv((msg, pct) => emit({ phase: 'uv', pct: pct ?? 10, message: msg }))
  if (!uvRes.ok) return { ok: false, error: `No se pudo instalar uv: ${uvRes.error}` }

  state.ace.stage = 'venv'
  await saveMusicState(state)

  emit({
    phase: 'sync',
    pct: 20,
    message: 'Instalando dependencias ACE-Step (uv sync)… esto puede tardar'
  })
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

  const torchFix = await repairAceTorchCompat(uvRes.uv, aceDir, emit)
  if (!torchFix.ok) {
    state.ace.stage = 'error'
    state.ace.lastError = torchFix.detail
    await saveMusicState(state)
    emit({ phase: 'error', pct: 0, message: `torch/torchao: ${torchFix.detail}` })
    return { ok: false, error: `torch/torchao: ${torchFix.detail}` }
  }
  emit({ phase: 'sync', pct: 65, message: `torch/torchao OK · ${torchFix.detail}` })

  emit({
    phase: 'models',
    pct: 70,
    message: 'Descargando modelos ACE (turbo)… no cierres'
  })
  const dl = await runCmd(
    uvRes.uv,
    ['run', '--no-sync', 'acestep-download', '--model', 'acestep-v15-turbo'],
    { cwd: aceDir, timeoutMs: 90 * 60 * 1000 }
  )
  if (dl.code !== 0) {
    const err = (dl.stderr || dl.stdout || 'descarga modelos falló').slice(0, 500)
    state.ace.lastError = err
    appendMusicLog(`[models] incomplete: ${err.slice(0, 200)}`)
  } else {
    state.ace.lastError = undefined
  }

  state.ace.stage = 'ready'
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
  const paths = ['/health', '/v1/models', '/docs']
  let last = 'sin respuesta'
  for (const path of paths) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      const res = await fetch(`${root}${path}`, { signal: ctrl.signal })
      clearTimeout(t)
      if (res.ok) {
        if (path === '/docs') {
          last = 'uvicorn up (/docs); esperando /health'
          continue
        }
        return { ok: true }
      }
      last = `HTTP ${res.status} ${path}`
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
  }
  return { ok: false, error: last }
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

  const torchBroken = /torchao|incompatible torch/i.test(state.ace.lastError || '')
  const needSetup = !opts?.skipSetup && (state.ace.stage !== 'ready' || torchBroken)
  if (needSetup) {
    setRuntime({ state: 'starting', message: 'Preparando entorno ACE…', bootProgress: 10 })
    const setup = await ensureAceEnvironment((p) => {
      setRuntime({
        state: 'starting',
        message: p.message,
        bootProgress: Math.min(70, p.pct || 10),
        backend: 'ace-step'
      })
    })
    if (!setup.ok) {
      setRuntime({
        state: 'error',
        message: setup.error || 'Setup falló',
        backend: 'ace-step'
      })
      return getMusicRuntimeStatus()
    }
  } else {
    setRuntime({
      state: 'starting',
      message: 'Arranque rápido ACE…',
      bootProgress: 35,
      backend: 'ace-step'
    })
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
  musicLogPath = logFile
  musicLogTail = []
  appendMusicLog(`==== ACE ${new Date().toISOString()} ====`)

  setRuntime({
    state: 'starting',
    message: 'Comprobando torch/torchao…',
    bootProgress: 38,
    backend: 'ace-step'
  })
  const compat = await repairAceTorchCompat(uvRes.uv, aceDir, (p) => {
    setRuntime({
      state: 'starting',
      message: p.message,
      bootProgress: Math.min(44, 38 + (p.pct || 0) / 20),
      backend: 'ace-step'
    })
  })
  if (!compat.ok) {
    setRuntime({
      state: 'error',
      message: `torch/torchao: ${compat.detail}`,
      backend: 'ace-step'
    })
    state.ace.lastError = compat.detail
    await saveMusicState(state)
    return getMusicRuntimeStatus()
  }
  appendMusicLog(`[torch] OK ${compat.detail}`)

  // acestep-api CLI (1.5): --host --port --api-key --download-source --init-llm --lm-model-path --no-init
  // NO --config_path (causes "unrecognized arguments" and process exit)
  const tier = state.eligibility.ace.tier
  // Prefer 0.6B: 12GB VRAM + Forge/Ollama often OOMs or Windows pagefile (os error 1455) with 1.7B.
  const vram = state.eligibility.vramGB
  const useSmallLm =
    tier === 'turbo' ||
    platform() === 'win32' ||
    vram == null ||
    vram <= 16
  const lmName = 'acestep-5Hz-lm-0.6B'
  appendMusicLog(`[lm] forced=${lmName} (small=${useSmallLm} vram=${vram ?? '?'} tier=${tier})`)

  const args = [
    'run',
    '--no-sync',
    'acestep-api',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--download-source',
    'huggingface',
    '--lm-model-path',
    lmName,
    '--no-init'
  ]

  try {
    await writeFile(
      logFile,
      `==== ACE API ${new Date().toISOString()} ====\ncmd=${uvRes.uv} ${args.join(' ')}\n`,
      'utf-8'
    )
  } catch {
    /* ignore */
  }

  const baseUrl = `http://127.0.0.1:${port}`
  let exitedEarly: { code: number | null } | null = null
  const logTailLocal: string[] = []

  const pushLog = (line: string) => {
    const t = line.replace(/\r/g, '').trim()
    if (!t) return
    logTailLocal.push(t)
    if (logTailLocal.length > 40) logTailLocal.shift()
    setRuntime({ lastLogLine: t.slice(0, 220), message: t.slice(0, 120) })
    appendMusicLog(t)
  }

  child = spawn(uvRes.uv, args, {
    cwd: aceDir,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      UV_NO_SYNC: '1',
      ACESTEP_API_HOST: '127.0.0.1',
      ACESTEP_API_PORT: String(port),
      HF_HUB_DISABLE_TELEMETRY: '1'
    }
  })

  setRuntime({
    pid: child.pid ?? null,
    port,
    baseUrl,
    message: `ACE PID ${child.pid ?? '?'} · cargando…`,
    bootProgress: 45
  })

  child.stdout?.on('data', (d) => {
    for (const line of d.toString().split(/\r?\n/)) pushLog(line)
  })
  child.stderr?.on('data', (d) => {
    for (const line of d.toString().split(/\r?\n/)) pushLog(line)
  })
  child.on('exit', (code) => {
    exitedEarly = { code: code ?? null }
    if (runtime.state === 'running' || runtime.state === 'starting') {
      const meaningful = logTailLocal.filter(
        (l) =>
          !/Skipping import of cpp extensions/i.test(l) &&
          !/Redirects are currently not supported/i.test(l)
      )
      const tail = (meaningful.length ? meaningful : logTailLocal).slice(-10).join(' | ')
      setRuntime({
        state: 'error',
        message:
          `ACE API salió (code ${code}). ` +
          (tail ? `Log: ${tail.slice(0, 320)}` : `Sin salida. Revisa ${logFile}`),
        pid: null,
        bootProgress: 0
      })
    }
    child = null
  })
  child.on('error', (err) => {
    exitedEarly = { code: -1 }
    setRuntime({
      state: 'error',
      message: `No se pudo lanzar uv/ACE: ${err.message}`,
      pid: null
    })
  })

  const deadline = Date.now() + 20 * 60 * 1000
  let attempt = 0
  while (Date.now() < deadline) {
    if (exitedEarly) return getMusicRuntimeStatus()
    attempt++
    const h = await probeMusicHealth(baseUrl, 5000)
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
    const hint = logTailLocal.length
      ? logTailLocal[logTailLocal.length - 1].slice(0, 100)
      : h.error || 'esperando'
    setRuntime({
      state: 'starting',
      port,
      baseUrl,
      backend: 'ace-step',
      bootProgress: Math.min(96, 45 + attempt),
      message: `Arrancando ACE… ${hint}`
    })
    await new Promise((r) => setTimeout(r, 2500))
  }

  try {
    if (child && !child.killed) child.kill()
  } catch {
    /* ignore */
  }
  child = null
  setRuntime({
    state: 'error',
    message: `Timeout 20 min. Último log: ${(logTailLocal.slice(-3).join(' | ') || 'vacío').slice(0, 300)}`,
    backend: 'ace-step',
    bootProgress: 0
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

/** Normalize any ACE file field into /v1/audio?path=... or absolute path */
function normalizeAceFileRef(file: string): { fileUrlPath?: string; localPath?: string } {
  const f = String(file || '').trim()
  if (!f) return {}
  if (f.startsWith('/v1/audio')) return { fileUrlPath: f }
  if (f.startsWith('http://') || f.startsWith('https://')) {
    try {
      const u = new URL(f)
      if (u.pathname.includes('/v1/audio')) return { fileUrlPath: u.pathname + u.search }
      return { fileUrlPath: f }
    } catch {
      return { fileUrlPath: f }
    }
  }
  // Absolute server path → wrap for download endpoint
  if (
    f.startsWith('/') ||
    (f.length >= 3 && f[1] === ':' && (f[2] === '\\' || f[2] === '/')) ||
    f.includes('api_audio') ||
    f.endsWith('.mp3') ||
    f.endsWith('.wav') ||
    f.endsWith('.flac')
  ) {
    if (f.includes('://')) return { fileUrlPath: f }
    // Windows path from ACE on same machine
    if ((f.length >= 3 && f[1] === ':' && (f[2] === '\\' || f[2] === '/')) || f.startsWith('\\\\'))
      return { localPath: f }
    // Unix-style absolute under ACE outputs
    return { fileUrlPath: `/v1/audio?path=${encodeURIComponent(f)}` }
  }
  return { localPath: f }
}

/** Parse ACE query_result item → local filesystem path or API file URL path */
function extractAceAudioRef(item: Record<string, unknown>): {
  fileUrlPath?: string
  localPath?: string
  error?: string
} {
  const tryRow = (row: Record<string, unknown> | null | undefined) => {
    if (!row || typeof row !== 'object') return null
    const file =
      (typeof row.file === 'string' && row.file) ||
      (typeof row.audio_path === 'string' && row.audio_path) ||
      (typeof row.path === 'string' && row.path) ||
      (typeof row.url === 'string' && row.url) ||
      ''
    if (file) return normalizeAceFileRef(file)
    if (typeof row.error === 'string' && row.error) return { error: row.error }
    // base64 inline
    if (typeof row.wave === 'string' && row.wave.length > 1000) {
      return { error: 'inline-wave' } // signal special
    }
    return null
  }

  // Top-level fields
  const top = tryRow(item as Record<string, unknown>)
  if (top && !('error' in top && top.error === 'inline-wave')) {
    if (top.fileUrlPath || top.localPath) return top
  }

  let resultRaw: unknown = item.result
  // result may already be array/object
  if (Array.isArray(resultRaw)) {
    for (const row of resultRaw) {
      const r = tryRow(row as Record<string, unknown>)
      if (r && (r.fileUrlPath || r.localPath)) return r
      if (r && r.error && r.error !== 'inline-wave') return { error: r.error }
    }
  } else if (resultRaw && typeof resultRaw === 'object') {
    const r = tryRow(resultRaw as Record<string, unknown>)
    if (r && (r.fileUrlPath || r.localPath)) return r
  } else if (typeof resultRaw === 'string' && resultRaw.trim()) {
    let s = resultRaw.trim()
    // Unwrap nested quotes / double encoding
    for (let i = 0; i < 3; i++) {
      try {
        const parsed = JSON.parse(s) as unknown
        if (Array.isArray(parsed)) {
          for (const row of parsed) {
            const r = tryRow(row as Record<string, unknown>)
            if (r && (r.fileUrlPath || r.localPath)) return r
            if (r && r.error && r.error !== 'inline-wave') return { error: r.error }
          }
          break
        }
        if (parsed && typeof parsed === 'object') {
          const r = tryRow(parsed as Record<string, unknown>)
          if (r && (r.fileUrlPath || r.localPath)) return r
          // maybe { data: [ { file } ] }
          const data = (parsed as { data?: unknown }).data
          if (Array.isArray(data)) {
            for (const row of data) {
              const r2 = tryRow(row as Record<string, unknown>)
              if (r2 && (r2.fileUrlPath || r2.localPath)) return r2
            }
          }
          break
        }
        if (typeof parsed === 'string') {
          s = parsed
          continue
        }
        break
      } catch {
        break
      }
    }
    // Regex fallback
    const m =
      /\/v1\/audio\?path=[^"'\s}]+/.exec(resultRaw) ||
      /"file"\s*:\s*"([^"]+)"/.exec(resultRaw)
    if (m) {
      const f = m[1] || m[0]
      return normalizeAceFileRef(f.startsWith('/v1') ? f : m[0].startsWith('/v1') ? m[0] : f)
    }
        // Absolute path in plain text (avoid brittle Windows regex)
    {
      const mMp3 = resultRaw.match(/([A-Za-z]:[\\/][^\s"'<>]+\.(?:mp3|wav|flac))/i)
      const mUnix = resultRaw.match(/(\/(?:tmp|app|home|Users)[^\s"'<>]+\.(?:mp3|wav|flac))/i)
      const hit = (mMp3 && mMp3[1]) || (mUnix && mUnix[1])
      if (hit) return normalizeAceFileRef(hit)
    }
  }

  // Scan entire item JSON as last resort
  try {
    const blob = JSON.stringify(item)
    const m = /\/v1\/audio\?path=[^"'\s}]+/.exec(blob)
    if (m) return { fileUrlPath: m[0] }
  } catch {
    /* ignore */
  }
  return {}
}

async function downloadAceAudioToWorkspace(
  base: string,
  fileUrlPath: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const url = fileUrlPath.startsWith('http')
      ? fileUrlPath
      : `${base}${fileUrlPath.startsWith('/') ? '' : '/'}${fileUrlPath}`
    const buf = await new Promise<Buffer>((resolve, reject) => {
      try {
        const http = require('http') as typeof import('http')
        const https = require('https') as typeof import('https')
        const u = new URL(url)
        const lib = u.protocol === 'https:' ? https : http
        const req = lib.get(u, { timeout: 120_000 }, (res) => {
          if ((res.statusCode || 0) >= 400) {
            reject(new Error(`Descarga audio HTTP ${res.statusCode}`))
            return
          }
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
          res.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.on('error', reject)
        req.on('timeout', () => {
          req.destroy()
          reject(new Error('timeout descarga audio'))
        })
      } catch (e) {
        reject(e)
      }
    })
    if (buf.length < 1000) return { ok: false, error: 'Audio vacío o demasiado corto' }
    const { ensureMusicWorkspace } = await import('./music-workspace')
    const { join } = await import('path')
    const { writeFile, mkdir } = await import('fs/promises')
    const ws = await ensureMusicWorkspace()
    const outDir = join(ws.musicRoot, 'outputs')
    await mkdir(outDir, { recursive: true })
    const name = `ace_${Date.now()}.mp3`
    const dest = join(outDir, name)
    await writeFile(dest, buf)
    return { ok: true, path: dest }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}


/** Stable HTTP to ACE (Node fetch often throws opaque "fetch failed" on long / reset gens). */
function aceHttpJson(
  base: string,
  path: string,
  opts?: {
    method?: string
    body?: unknown
    timeoutMs?: number
  }
): Promise<{ ok: boolean; status: number; json: unknown; text: string; error?: string }> {
  return new Promise((resolve) => {
    try {
      const http = require('http') as typeof import('http')
      const https = require('https') as typeof import('https')
      const u = new URL(path.startsWith('http') ? path : `${base.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`)
      const isHttps = u.protocol === 'https:'
      const lib = isHttps ? https : http
      const payload =
        opts?.body === undefined || opts?.body === null
          ? null
          : typeof opts.body === 'string'
            ? opts.body
            : JSON.stringify(opts.body)
      const timeoutMs = opts?.timeoutMs ?? 120_000
      const req = lib.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname + u.search,
          method: opts?.method || (payload ? 'POST' : 'GET'),
          headers: {
            Accept: 'application/json',
            ...(payload
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload)
                }
              : {})
          },
          timeout: timeoutMs
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            let json: unknown = null
            try {
              json = text ? JSON.parse(text) : null
            } catch {
              json = null
            }
            const status = res.statusCode || 0
            resolve({
              ok: status >= 200 && status < 300,
              status,
              json,
              text,
              error: status >= 400 ? text.slice(0, 200) : undefined
            })
          })
        }
      )
      req.on('timeout', () => {
        req.destroy()
        resolve({
          ok: false,
          status: 0,
          json: null,
          text: '',
          error: `timeout ${timeoutMs}ms`
        })
      })
      req.on('error', (e: Error & { code?: string; cause?: unknown }) => {
        const cause =
          e.cause && typeof e.cause === 'object' && 'code' in (e.cause as object)
            ? String((e.cause as { code?: string }).code)
            : ''
        resolve({
          ok: false,
          status: 0,
          json: null,
          text: '',
          error: `${e.message}${e.code ? ` [${e.code}]` : ''}${cause ? ` cause=${cause}` : ''}`
        })
      })
      if (payload) req.write(payload)
      req.end()
    } catch (e) {
      resolve({
        ok: false,
        status: 0,
        json: null,
        text: '',
        error: e instanceof Error ? e.message : String(e)
      })
    }
  })
}

async function warmAceModels(base: string): Promise<void> {
  // Light warm: DiT only first; LM optional (sample_mode). Avoids pagefile 1455 with Forge up.
  try {
    await aceHttpJson(base, '/v1/init', {
      method: 'POST',
      body: {
        init_llm: false,
        lm_model_path: 'acestep-5Hz-lm-0.6B'
      },
      timeoutMs: 300_000
    })
  } catch {
    /* ignore */
  }
}


async function releaseAndWait(
  base: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<{
  ok: boolean
  error?: string
  path?: string
  audioPath?: string
  taskId?: string
  rawFail?: string
}> {
  let createRes = await aceHttpJson(base, '/release_task', {
    method: 'POST',
    body,
    timeoutMs: 180_000
  })
  if (!createRes.ok) {
    // one retry after short pause (ACE may reset while lazy-loading weights)
    await new Promise((r) => setTimeout(r, 4000))
    createRes = await aceHttpJson(base, '/release_task', {
      method: 'POST',
      body,
      timeoutMs: 180_000
    })
  }
  if (!createRes.ok) {
    return {
      ok: false,
      error: `release_task ${createRes.error || `HTTP ${createRes.status}`} ${(createRes.text || '').slice(0, 120)}`
    }
  }
  const created = (createRes.json || {}) as {
    data?: { task_id?: string; task_ids?: string[] }
    task_id?: string
    error?: string
  }
  const taskId =
    created?.data?.task_id || created?.data?.task_ids?.[0] || created?.task_id || ''
  if (!taskId) {
    return {
      ok: false,
      error: `Sin task_id (${created?.error || JSON.stringify(created).slice(0, 120)})`
    }
  }

  const deadline = Date.now() + timeoutMs
  let lastRaw = ''
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500))
    const q = await aceHttpJson(base, '/query_result', {
      method: 'POST',
      body: { task_id_list: [taskId] },
      timeoutMs: 60_000
    })
    if (!q.ok) continue
    const data = (q.json || {}) as {
      data?: Array<Record<string, unknown>>
      error?: string
    }
    const item = data?.data?.[0]
    if (!item) continue
    lastRaw = JSON.stringify(item).slice(0, 400)
    const status = Number(item.status)
    // 0 / "queued" / "running" → wait
    if (status !== 1 && status !== 2 && status !== 1.0) {
      const st = String(item.status || '')
      if (st === 'queued' || st === 'running' || st === 'pending') continue
      if (status === 0 || Number.isNaN(status)) continue
    }
    if (status === 2) {
      const ref = extractAceAudioRef(item)
      return {
        ok: false,
        error: ref.error || 'Generación fallida (ACE status=2)',
        taskId,
        rawFail: lastRaw
      }
    }
    if (status === 1) {
      const ref = extractAceAudioRef(item)
      if (ref.localPath) {
        return { ok: true, path: ref.localPath, audioPath: ref.localPath, taskId }
      }
      if (ref.fileUrlPath) {
        const dl = await downloadAceAudioToWorkspace(base, ref.fileUrlPath)
        if (!dl.ok) return { ok: false, error: dl.error, taskId, rawFail: lastRaw }
        return { ok: true, path: dl.path, audioPath: dl.path, taskId }
      }
      return {
        ok: false,
        error: 'status=1 pero sin ruta de audio en result',
        taskId,
        rawFail: lastRaw
      }
    }
  }
  return { ok: false, error: 'Timeout esperando el audio', taskId, rawFail: lastRaw }
}


/** Find a live ACE API among known ports; update runtime state if found. */
export async function discoverLiveMusicBaseUrl(): Promise<string | null> {
  const ports: number[] = []
  const seen = new Set<number>()
  const push = (p: number) => {
    if (!seen.has(p) && p > 0) {
      seen.add(p)
      ports.push(p)
    }
  }
  const st = getMusicRuntimeStatus()
  if (st.port) push(st.port)
  for (const p of MUSIC_API_PORTS) push(p)
  for (let p = 8001; p <= 8030; p++) push(p)
  for (let p = 18001; p <= 18030; p++) push(p)

  for (const p of ports) {
    const url = `http://127.0.0.1:${p}`
    try {
      const h = await probeMusicHealth(url, 2500)
      if (h.ok) {
        setRuntime({
          state: 'running',
          port: p,
          baseUrl: url,
          pid: st.pid,
          message: `ACE detectado en :${p}`,
          backend: 'ace-step',
          bootProgress: 100
        })
        return url
      }
    } catch {
      /* try next */
    }
  }
  return null
}

async function resolveMusicBaseForGenerate(): Promise<{ base: string; error?: string }> {
  const st = getMusicRuntimeStatus()
  if (st.state === 'running' && st.baseUrl) {
    const h = await probeMusicHealth(st.baseUrl, 4000)
    if (h.ok) return { base: st.baseUrl.replace(/\/$/, '') }
  }
  const found = await discoverLiveMusicBaseUrl()
  if (found) return { base: found.replace(/\/$/, '') }

  const ready = await ensureMusicReady()
  if (ready.state === 'running' && ready.baseUrl) {
    const h2 = await probeMusicHealth(ready.baseUrl, 5000)
    if (h2.ok) return { base: ready.baseUrl.replace(/\/$/, '') }
  }
  // Last chance scan after start
  const found2 = await discoverLiveMusicBaseUrl()
  if (found2) return { base: found2.replace(/\/$/, '') }

  return {
    base: '',
    error:
      ready.message ||
      'ACE no responde en puertos 8001–8030 / 18001+. Arranca la capa Música o revisa la consola ACE.'
  }
}

export async function generateMusic(
  req: MusicGenerateRequest
): Promise<{
  ok: boolean
  error?: string
  audioPath?: string
  path?: string
  taskId?: string
  baseUrl?: string
}> {
  // Free Forge VRAM before loading ACE weights (Windows pagefile / 12GB cards)
  try {
    const { prepareHeavyLayer } = await import('./layer-scheduler')
    const prep = await prepareHeavyLayer('music', { reason: 'generar música' })
    if (!prep.ok) {
      // still try generate — ACE may already be up
    }
  } catch {
    /* scheduler optional */
  }
  const resolved = await resolveMusicBaseForGenerate()
  if (!resolved.base) {
    return { ok: false, error: resolved.error || 'ACE no está en marcha' }
  }
  let base = resolved.base
  const duration = Math.max(15, Math.min(120, req.durationSec ?? 30))
  const prompt = String(req.prompt || '').trim() || 'soft instrumental piano, calm mood'

  try {
    // Re-check right before warm (port may have died)
    let live = await probeMusicHealth(base, 3000)
    if (!live.ok) {
      const again = await discoverLiveMusicBaseUrl()
      if (!again) {
        return { ok: false, error: live.error || 'ACE perdió la conexión antes de generar', baseUrl: base }
      }
      base = again.replace(/\/$/, '')
    }
    await warmAceModels(base)


// Prefer caption/instrumental FIRST (no LM) — avoids loading 1.7B/0.6B under low RAM+pagefile
    // when Forge already holds VRAM. sample_mode (LM) is fallback.
    const captionBody: Record<string, unknown> = {
      sample_mode: false,
      prompt,
      caption: prompt,
      lyrics: req.lyrics || '[Instrumental]',
      thinking: false,
      vocal_language: req.vocalLanguage || 'en',
      audio_format: 'mp3',
      duration,
      param_obj: JSON.stringify({
        duration,
        language: req.vocalLanguage || 'en'
      })
    }
    const sampleBody: Record<string, unknown> = {
      sample_mode: true,
      sample_query: prompt,
      thinking: false,
      batch_size: 1,
      audio_format: 'mp3',
      duration,
      vocal_language: req.vocalLanguage || 'en',
      param_obj: JSON.stringify({
        duration,
        language: req.vocalLanguage || 'en'
      })
    }

    let first = await releaseAndWait(base, captionBody, 12 * 60 * 1000)
    if (
      !first.ok &&
      /ECONNREFUSED|ECONNRESET|fetch failed|socket hang up|timeout|pagefile|1455|paging file|paginación/i.test(
        first.error || ''
      )
    ) {
      const recovered = await discoverLiveMusicBaseUrl()
      if (recovered) {
        base = recovered.replace(/\/$/, '')
        await warmAceModels(base)
        first = await releaseAndWait(base, captionBody, 12 * 60 * 1000)
      } else {
        try {
          await stopMusicRuntime()
        } catch {
          /* ignore */
        }
        const ready = await ensureMusicReady()
        if (ready.baseUrl) {
          base = ready.baseUrl.replace(/\/$/, '')
          await warmAceModels(base)
          first = await releaseAndWait(base, captionBody, 12 * 60 * 1000)
        }
      }
    }
    if (first.ok && first.path) {
      return {
        ok: true,
        path: first.path,
        audioPath: first.path,
        taskId: first.taskId,
        baseUrl: base
      }
    }

    // Attempt B: sample_mode with 0.6B LM (may still OOM if pagefile tiny)
    let second = await releaseAndWait(base, sampleBody, 12 * 60 * 1000)
    if (second.ok && second.path) {
      return {
        ok: true,
        path: second.path,
        audioPath: second.path,
        taskId: second.taskId,
        baseUrl: base
      }
    }

    // Attempt C: OpenRouter-compatible    // Attempt C: OpenRouter-compatible /v1/chat/completions (returns base64 audio)
    try {
      const chatRes = await aceHttpJson(base, '/v1/chat/completions', {
        method: 'POST',
        body: {
          messages: [{ role: 'user', content: prompt }],
          sample_mode: true,
          stream: false,
          thinking: false,
          audio_config: { vocal_language: req.vocalLanguage || 'en', duration }
        },
        timeoutMs: 600_000
      })
      if (chatRes.ok) {
        const chatJson = (chatRes.json || {}) as {
          choices?: Array<{
            message?: {
              audio?: Array<{ audio_url?: { url?: string }; url?: string }>
              content?: string
            }
          }>
        }
        const aud = chatJson?.choices?.[0]?.message?.audio?.[0]
        const dataUrl =
          aud?.audio_url?.url ||
          aud?.url ||
          ''
        if (dataUrl.startsWith('data:audio')) {
          const b64 = dataUrl.split(',')[1] || ''
          const buf = Buffer.from(b64, 'base64')
          if (buf.length > 1000) {
            const { ensureMusicWorkspace } = await import('./music-workspace')
            const { join } = await import('path')
            const { writeFile, mkdir } = await import('fs/promises')
            const ws = await ensureMusicWorkspace()
            const outDir = join(ws.musicRoot, 'outputs')
            await mkdir(outDir, { recursive: true })
            const dest = join(outDir, `ace_chat_${Date.now()}.mp3`)
            await writeFile(dest, buf)
            return { ok: true, path: dest, audioPath: dest, baseUrl: base }
          }
        }
      }
    } catch {
      /* optional path */
    }

    const rawErr = `${second.error || ''} ${first.error || ''} ${first.rawFail || ''} ${second.rawFail || ''}`
    const pagefileHint = /1455|pagefile|paginación|paging file/i.test(rawErr)
      ? ' · Windows: archivo de paginación pequeño o poca RAM libre. Cierra Forge/Ollama temporalmente, aumenta pagefile, o genera música sin Forge en VRAM.'
      : /CUDA|out of memory|oom/i.test(rawErr)
        ? ' · Sin VRAM libre: detén Forge u Ollama vision y reintenta.'
        : ''
    return {
      ok: false,
      error:
        (second.error ||
          first.error ||
          'Generación fallida' +
            (first.rawFail || second.rawFail
              ? ` · ${String(first.rawFail || second.rawFail).slice(0, 180)}`
              : '')) + pagefileHint,
      taskId: second.taskId || first.taskId,
      baseUrl: base
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), baseUrl: base }
  }
}

/** Alias used by IPC music:generate */
export const generateMusicTrack = generateMusic
