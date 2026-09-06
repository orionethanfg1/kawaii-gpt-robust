/**
 * Phase 2c: start/stop Forge (A1111-compatible) with smart port allocation.
 * Avoids binding conflicts with other apps; polls /sdapi/v1/sd-models for readiness.
 */

import { BrowserWindow } from 'electron'
import { join } from 'path'
import { appendFileSync, existsSync, writeFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { platform } from 'os'
import {
  ensureMachineProfile,
  ensureDataRootWorkspace,
  detectForgePresent,
  type MachineProfile
} from './machine-profile'
import { syncCheckpointsToForge } from './sd-workspace'
import {
  ensureForgeVenvWithTorch,
  ensureForgeWebStack,
} from './python-runtime'

/** Preferred API ports — skip ones already in use */
export const FORGE_PORT_CANDIDATES = [
  7860, 7861, 7862, 7863, 7864, 7865, 7870, 7871, 7880, 7890
]

/**
 * Forge/A1111: --listen is a boolean flag (no host value).
 * Use --server-name 127.0.0.1 to bind localhost only.
 * Passing "--listen 127.0.0.1" makes argparse treat the IP as an unknown positional.
 */
export function forgeCliArgs(port: number): string[] {
  // --nowebui: only REST API (what KawaiiGPT needs). Skips Gradio UI create_ui()
  // which often crashes on pydantic/fastapi mismatches (FieldInfo.in_).
  return [
    '--api',
    '--nowebui',
    '--listen',
    '--port',
    String(port),
    '--server-name',
    '127.0.0.1',
    '--skip-python-version-check',
    '--skip-version-check'
  ]
}

export function forgeCliArgsString(port: number): string {
  return forgeCliArgs(port).join(' ')
}

export type ForgeRuntimeStatus = {
  state: 'stopped' | 'starting' | 'running' | 'error'
  port: number | null
  baseUrl: string | null
  pid: number | null
  forgeRoot: string | null
  message: string
  startedAt?: string
  lastHealthAt?: string
  /** Last line / progress hint from Forge console */
  lastLogLine?: string
  /** 0–100 estimated while starting (API not up yet) */
  bootProgress?: number
  elapsedMs?: number
  apiOk?: boolean
}

let child: ChildProcess | null = null
let forgeLogPath: string | null = null
let forgeExitedEarly = false
let forgeLogTail: string[] = []

function appendForgeLog(line: string): void {
  const t = line.replace(/\r/g, '').trimEnd()
  if (!t) return
  forgeLogTail.push(t)
  if (forgeLogTail.length > 200) forgeLogTail.shift()
  if (forgeLogPath) {
    try {
      appendFileSync(forgeLogPath, t + '\n', 'utf-8')
    } catch {
      /* ignore */
    }
  }
  status = { ...status, lastLogLine: t }
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('forge:log-line', { line: t, tail: forgeLogTail.slice(-120) })
      win.webContents.send('forge:boot-progress', { ...status })
    } catch {
      /* ignore */
    }
  }
}

export function getForgeLogTail(): string[] {
  return [...forgeLogTail]
}

let forgeNearReady = false
let status: ForgeRuntimeStatus = {
  state: 'stopped',
  port: null,
  baseUrl: null,
  pid: null,
  forgeRoot: null,
  message: 'Forge detenido'
}

function setStatus(patch: Partial<ForgeRuntimeStatus>): ForgeRuntimeStatus {
  status = { ...status, ...patch }
  // Keep renderer toasts/bars in sync (starting → error/running)
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('forge:boot-progress', { ...status })
      win.webContents.send('forge:status', { ...status })
    } catch {
      /* ignore */
    }
  }
  return status
}

export function getForgeLogPath(): string | null {
  return forgeLogPath
}

export function getForgeRuntimeStatus(): ForgeRuntimeStatus {
  return { ...status, lastLogLine: status.lastLogLine || forgeLogTail[forgeLogTail.length - 1] }
}

function broadcastForgeBoot(payload: {
  message: string
  bootProgress?: number
  lastLogLine?: string
  elapsedMs?: number
  state?: ForgeRuntimeStatus['state']
}): void {
  setStatus({
    message: payload.message,
    bootProgress: payload.bootProgress,
    lastLogLine: payload.lastLogLine,
    elapsedMs: payload.elapsedMs,
    ...(payload.state ? { state: payload.state } : {})
  })
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('forge:boot-progress', {
        ...getForgeRuntimeStatus(),
        ...payload
      })
    } catch {
      /* ignore */
    }
  }
}

function isPidAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Parse HF / pip / forge console for rough progress */
function parseForgeLogLine(line: string): { hint?: string; pct?: number } {
  const text = line.trim()
  if (!text) return {}
  // Noise — do not surface in UI
  if (
    /Environment vars changed/i.test(text) ||
    /FutureWarning/i.test(text) ||
    /DeprecationWarning/i.test(text) ||
    /UserWarning/i.test(text) ||
    /TRANSFORMERS_CACHE/i.test(text) ||
    /^$/i.test(text)
  ) {
    return {}
  }
  // tqdm: "4%|█ | 75.0M/1.99G" or " 45%|"
  const m = /(\d{1,3})\s*%\s*\|/.exec(text)
  if (m) {
    const pct = Math.min(92, Number(m[1]))
    // Prefer human-readable size part if present
    const size = /(\d+(?:\.\d+)?[kKmMgG]\/\d+(?:\.\d+)?[kKmMgG])/.exec(text)
    const hint = size
      ? `Descarga modelo ${pct}% (${size[1]})`
      : `Progreso ${pct}%`
    return { hint, pct }
  }
  const m2 = /Downloading:\s*"([^"]+)"/i.exec(text)
  if (m2) {
    const name = m2[1].split('/').pop() || m2[1]
    return { hint: `Descargando: ${name.slice(0, 55)}`, pct: 12 }
  }
  if (/Installing (clip|open_clip|requirements|forge)/i.test(text)) {
    return { hint: text.slice(0, 90), pct: 6 }
  }
  if (/Launching Web UI/i.test(text)) {
    return { hint: 'Lanzando WebUI…', pct: 20 }
  }
  if (/Total VRAM|Device: cuda/i.test(text)) {
    return { hint: 'GPU detectada, cargando…', pct: 18 }
  }
  if (/Running on local URL|Startup time|Model loaded|API server/i.test(text)) {
    return { hint: text.slice(0, 100), pct: 95 }
  }
  // Ignore other chatter
  return {}
}

/** True if something already accepts TCP connections on host:port */
export function isPortInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net') as typeof import('net')
    const socket = net.connect({ port, host })
    const done = (used: boolean) => {
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
      resolve(used)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(600, () => done(false))
  })
}

/** Can we bind this port? (more reliable for "free to use") */
export function canBindPort(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net') as typeof import('net')
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    try {
      server.listen(port, host)
    } catch {
      resolve(false)
    }
  })
}

/**
 * Pick first free port from candidates.
 * If preferred is free, use it; else next free.
 */
export async function pickForgePort(preferred?: number | null): Promise<number> {
  const ordered = [
    ...(preferred && Number.isFinite(preferred) ? [Number(preferred)] : []),
    ...FORGE_PORT_CANDIDATES
  ]
  const seen = new Set<number>()
  for (const p of ordered) {
    if (seen.has(p) || p < 1024 || p > 65535) continue
    seen.add(p)
    const bindable = await canBindPort(p)
    if (bindable) return p
  }
  // Last resort: ephemeral high port
  for (let p = 17960; p < 18000; p++) {
    if (await canBindPort(p)) return p
  }
  throw new Error('No hay puertos libres para Forge (7860–7890 / 17960+). Cierra otras apps o indica un puerto.')
}

/**
 * True API health: ONLY /sdapi/* counts.
 * Gradio UI on / or /docs without --api must NOT report ok (that caused false "API activa"
 * while txt2img returned 404).
 */
export async function probeForgeHealth(
  baseUrl: string,
  timeoutMs = 6000
): Promise<{
  ok: boolean
  status?: number
  error?: string
  baseUrl?: string
  /** UI responds but /sdapi is missing → need --api restart */
  uiOnly?: boolean
}> {
  const roots = new Set<string>()
  const raw = baseUrl.replace(/\/$/, '')
  roots.add(raw)
  if (raw.includes('127.0.0.1')) roots.add(raw.replace('127.0.0.1', 'localhost'))
  if (raw.includes('localhost')) roots.add(raw.replace('localhost', '127.0.0.1'))

  // Prefer progress/options: /sd-models often 500 on Forge+pydantic
  // (missing response field "config") even when API is fully up.
  const apiPaths = [
    '/sdapi/v1/progress',
    '/sdapi/v1/options',
    '/sdapi/v1/samplers'
  ]
  let lastErr = 'sin respuesta API'
  let sawUi = false
  let sawSdapiAlive = false

  for (const root of roots) {
    for (const path of apiPaths) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const res = await fetch(`${root}${path}`, {
          signal: ctrl.signal,
          headers: { Accept: 'application/json' }
        })
        // 200/401/403 = healthy. 500 on an /sdapi route still means API server is up
        // (Forge bug on sd-models serialization — progress usually works).
        if (res.ok || res.status === 401 || res.status === 403) {
          return { ok: true, status: res.status, baseUrl: root }
        }
        if (res.status === 404) {
          lastErr = `HTTP 404 ${path} @ ${root} (Forge sin --api)`
        } else if (res.status >= 500 && path.startsWith('/sdapi/')) {
          sawSdapiAlive = true
          lastErr = `HTTP ${res.status} ${path} @ ${root} (API viva, endpoint con error interno)`
          // Prefer confirming with progress if this was sd-models; else accept
          if (path !== '/sdapi/v1/sd-models') {
            return { ok: true, status: res.status, baseUrl: root }
          }
        } else {
          lastErr = `HTTP ${res.status} ${path} @ ${root}`
        }
      } catch (err) {
        lastErr = `${err instanceof Error ? err.message : String(err)} @ ${root}${path}`
      } finally {
        clearTimeout(timer)
      }
    }
    if (sawSdapiAlive) {
      return { ok: true, status: 500, baseUrl: root }
    }
    // Detect Gradio UI without API
    for (const path of ['/', '/docs']) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), Math.min(2000, timeoutMs))
      try {
        const res = await fetch(`${root}${path}`, { signal: ctrl.signal })
        if (res.ok) sawUi = true
      } catch {
        /* ignore */
      } finally {
        clearTimeout(timer)
      }
    }
  }

  return {
    ok: false,
    error: sawUi
      ? `${lastErr}. La UI de Forge responde pero /sdapi no: reinicia con --api (botón Arrancar Forge de la app).`
      : lastErr,
    uiOnly: sawUi
  }
}

/** Scan preferred ports for any live A1111/Forge API */
export async function scanForgeApiPorts(): Promise<{
  ok: boolean
  baseUrl: string | null
  port: number | null
  error?: string
}> {
  let lastErr = 'ningún puerto respondió'
  for (const p of FORGE_PORT_CANDIDATES) {
    for (const host of ['127.0.0.1', 'localhost'] as const) {
      const url = `http://${host}:${p}`
      const h = await probeForgeHealth(url, 3500)
      if (h.ok) {
        return { ok: true, baseUrl: h.baseUrl || url, port: p }
      }
      lastErr = h.error || lastErr
    }
  }
  return { ok: false, baseUrl: null, port: null, error: lastErr }
}

async function resolveForgeRoot(profile: MachineProfile): Promise<string | null> {
  const base = profile.forgeInstallPath
  if (!(await detectForgePresent(base))) {
    // nested folder after extract
    try {
      const { readdir, stat } = await import('fs/promises')
      if (!existsSync(base)) return null
      const names = await readdir(base)
      for (const n of names) {
        const sub = join(base, n)
        try {
          if (!(await stat(sub)).isDirectory()) continue
          if (await detectForgePresent(sub)) return sub
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    return null
  }
  // Prefer directory that has run.bat
  if (existsSync(join(base, 'run.bat')) || existsSync(join(base, 'webui-user.bat'))) {
    return base
  }
  return base
}




/** Run `python -c` and parse major.minor; null if fails. */
function probePythonVersion(pythonExe: string, cwd?: string): { major: number; minor: number; raw: string } | null {
  try {
    const r = spawnSync(pythonExe, ['-c', 'import sys; print("%d.%d"%sys.version_info[:2])'], {
      cwd,
      encoding: 'utf-8',
      timeout: 8000,
      windowsHide: true
    })
    const raw = (r.stdout || '').trim()
    const m = /^(\d+)\.(\d+)/.exec(raw)
    if (!m) return null
    return { major: Number(m[1]), minor: Number(m[2]), raw }
  } catch {
    return null
  }
}

/**
 * Forge pins old torch (e.g. 2.3.1) → needs CPython 3.10 or 3.11 (max 3.12 in some builds).
 * System Python 3.13/3.14 will always fail pip install torch==2.3.1.
 */
function isForgeCompatiblePython(v: { major: number; minor: number } | null): boolean {
  if (!v) return false
  if (v.major !== 3) return false
  return v.minor >= 10 && v.minor <= 12
}

/** Find launch.py and a usable Windows Python under forge root (nested installs). */
async function resolveForgePythonAndLaunch(
  forgeRoot: string
): Promise<{ python: string; launchPy: string; cwd: string; version?: string } | null> {
  const { readdir, stat } = await import('fs/promises')
  const candidates: string[] = [forgeRoot]
  try {
    const names = await readdir(forgeRoot)
    for (const n of names) {
      const sub = join(forgeRoot, n)
      try {
        if ((await stat(sub)).isDirectory()) candidates.push(sub)
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  const pyRel = [
    ['venv', 'Scripts', 'python.exe'],
    ['system', 'python', 'python.exe'],
    ['python', 'python.exe'],
    ['py', 'python.exe'],
    ['Python310', 'python.exe'],
    ['Python311', 'python.exe'],
    ['portable', 'python', 'python.exe']
  ]

  type Hit = { python: string; launchPy: string; cwd: string; version: string; score: number }
  const hits: Hit[] = []

  for (const cwd of candidates) {
    const launchPy = join(cwd, 'launch.py')
    if (!existsSync(launchPy)) continue
    for (const parts of pyRel) {
      const python = join(cwd, ...parts)
      if (!existsSync(python)) continue
      const ver = probePythonVersion(python, cwd)
      const score = isForgeCompatiblePython(ver) ? 100 : ver ? 10 : 0
      // Prefer venv over embedded
      const bonus = parts[0] === 'venv' ? 20 : parts[0] === 'system' ? 15 : 0
      hits.push({
        python,
        launchPy,
        cwd,
        version: ver?.raw || '?',
        score: score + bonus
      })
    }
  }

  hits.sort((a, b) => b.score - a.score)
  const best = hits.find((h) => h.score >= 100)
  if (best) return best

  // Prefer app-managed portable Python if already provisioned (any data root guess)
  // Caller also runs ensurePortablePython when resolve returns null.

  // Do NOT fall back to PATH python 3.14 — that caused torch==2.3.1 install failure
  // Try py -3.11 / py -3.10 launcher on Windows
  const pyLaunchers = [
    ['py', '-3.11'],
    ['py', '-3.10'],
    ['py', '-3.12']
  ]
  for (const cwd of candidates) {
    const launchPy = join(cwd, 'launch.py')
    if (!existsSync(launchPy)) continue
    for (const [cmd, flag] of pyLaunchers) {
      try {
        const r = spawnSync(cmd, [flag, '-c', 'import sys; print("%d.%d"%sys.version_info[:2])'], {
          encoding: 'utf-8',
          timeout: 8000,
          windowsHide: true
        })
        const raw = (r.stdout || '').trim()
        const m = /^(\d+)\.(\d+)/.exec(raw)
        if (!m) continue
        const ver = { major: Number(m[1]), minor: Number(m[2]), raw }
        if (!isForgeCompatiblePython(ver)) continue
        // Use `py -3.11` as executable via cmd wrapper path: store as special
        return {
          python: cmd,
          launchPy,
          cwd,
          version: ver.raw + ' (py launcher ' + flag + ')'
        }
      } catch {
        /* ignore */
      }
    }
  }

  return null
}

/** Human message when no compatible Python is found. */

/**
 * Force webui-user.bat to keep --api (stock file often sets COMMANDLINE_ARGS= empty).
 * Backup once as webui-user.bat.kawaii-bak
 */
async function ensureKawaiiWebuiUser(forgeRoot: string, port: number): Promise<void> {
  const userBat = join(forgeRoot, 'webui-user.bat')
  const bak = join(forgeRoot, 'webui-user.bat.kawaii-bak')
  try {
    if (existsSync(userBat) && !existsSync(bak)) {
      const { copyFile } = await import('fs/promises')
      await copyFile(userBat, bak)
    }
  } catch {
    /* ignore */
  }
  const content = `@echo off
REM === Managed by KawaiiGPT Robust — do not clear COMMANDLINE_ARGS ===
REM Original backed up as webui-user.bat.kawaii-bak (if present)
set PYTHONUNBUFFERED=1
set COMMANDLINE_ARGS=--api --nowebui --listen --port ${port} --server-name 127.0.0.1 --skip-version-check --skip-python-version-check
`
  try {
    await writeFile(userBat, content, 'utf-8')
  } catch {
    /* ignore — non-fatal if root is nested */
  }
  // Also write into nested dirs that have launch.py
  try {
    const { readdir, stat } = await import('fs/promises')
    const names = await readdir(forgeRoot)
    for (const n of names) {
      const sub = join(forgeRoot, n)
      try {
        if (!(await stat(sub)).isDirectory()) continue
        if (!existsSync(join(sub, 'launch.py')) && !existsSync(join(sub, 'webui.bat'))) continue
        const subUser = join(sub, 'webui-user.bat')
        const subBak = join(sub, 'webui-user.bat.kawaii-bak')
        if (existsSync(subUser) && !existsSync(subBak)) {
          const { copyFile } = await import('fs/promises')
          await copyFile(subUser, subBak)
        }
        await writeFile(subUser, content, 'utf-8')
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Hardened .bat: logs to disk, prefers venv+launch.py, never silent success without python.
 * Used only as fallback when direct Node spawn is unavailable.
 */
async function writePortLauncher(forgeRoot: string, port: number): Promise<string> {
  await ensureKawaiiWebuiUser(forgeRoot, port)
  const bat = `@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set PYTHONUNBUFFERED=1
set HF_HUB_DISABLE_TELEMETRY=1
set "LOG=%~dp0kawaii-forge-launch.log"
echo ==== KawaiiGPT Forge launch %DATE% %TIME% ====>> "%LOG%"
echo [KawaiiGPT] cwd=%CD%>> "%LOG%"
echo [KawaiiGPT] Starting Forge API on port ${port}...
echo [KawaiiGPT] Starting Forge API on port ${port}...>> "%LOG%"

set "KAWAII_ARGS=--api --nowebui --listen --port ${port} --server-name 127.0.0.1 --skip-version-check --skip-python-version-check"
set COMMANDLINE_ARGS=%KAWAII_ARGS%

REM --- Locate launch.py (this folder or one level deep) ---
set "LAUNCH="
if exist "%CD%\\launch.py" set "LAUNCH=%CD%\\launch.py"
if not defined LAUNCH if exist "%CD%\\webui\\launch.py" set "LAUNCH=%CD%\\webui\\launch.py"
for /d %%D in ("%CD%\\*") do (
  if not defined LAUNCH if exist "%%~fD\\launch.py" set "LAUNCH=%%~fD\\launch.py"
)

REM --- Locate python ---
set "PY="
if exist "%CD%\\venv\\Scripts\\python.exe" set "PY=%CD%\\venv\\Scripts\\python.exe"
if not defined PY if exist "%CD%\\system\\python\\python.exe" set "PY=%CD%\\system\\python\\python.exe"
if not defined PY if exist "%CD%\\python\\python.exe" set "PY=%CD%\\python\\python.exe"
if not defined PY (
  for /d %%D in ("%CD%\\*") do (
    if not defined PY if exist "%%~fD\\venv\\Scripts\\python.exe" set "PY=%%~fD\\venv\\Scripts\\python.exe"
  )
)

if defined LAUNCH if defined PY (
  echo [KawaiiGPT] PY=%PY%>> "%LOG%"
  echo [KawaiiGPT] LAUNCH=%LAUNCH%>> "%LOG%"
  echo [KawaiiGPT] Using direct: "%PY%" "%LAUNCH%" %KAWAII_ARGS%
  echo [KawaiiGPT] Using direct python+launch.py>> "%LOG%"
  "%PY%" "%LAUNCH%" %KAWAII_ARGS%
  echo [KawaiiGPT] python exit=%ERRORLEVEL%>> "%LOG%"
  exit /b %ERRORLEVEL%
)

if defined LAUNCH (
  where python >nul 2>&1
  if %ERRORLEVEL%==0 (
    echo [KawaiiGPT] Using PATH python + launch.py>> "%LOG%"
    python "%LAUNCH%" %KAWAII_ARGS%
    echo [KawaiiGPT] python exit=%ERRORLEVEL%>> "%LOG%"
    exit /b %ERRORLEVEL%
  )
)

REM --- Fallback webui.bat (webui-user.bat already forced by ensureKawaiiWebuiUser) ---
echo [KawaiiGPT] WARNING: fallback webui.bat / run.bat>> "%LOG%"
if exist "%CD%\\webui.bat" (
  call "%CD%\\webui.bat"
  echo [KawaiiGPT] webui.bat exit=%ERRORLEVEL%>> "%LOG%"
  exit /b %ERRORLEVEL%
)
if exist "%CD%\\run.bat" (
  call "%CD%\\run.bat"
  echo [KawaiiGPT] run.bat exit=%ERRORLEVEL%>> "%LOG%"
  exit /b %ERRORLEVEL%
)

echo [KawaiiGPT] ERROR: no launch.py / python / webui.bat found in %CD%
echo [KawaiiGPT] ERROR: no launch.py / python / webui.bat>> "%LOG%"
exit /b 1
`
  const path = join(forgeRoot, 'run-kawaii-api.bat')
  await writeFile(path, bat, 'utf-8')
  // Also nested roots
  try {
    const resolved = await resolveForgePythonAndLaunch(forgeRoot)
    if (resolved && resolved.cwd !== forgeRoot) {
      await writeFile(join(resolved.cwd, 'run-kawaii-api.bat'), bat, 'utf-8')
      await ensureKawaiiWebuiUser(resolved.cwd, port)
    }
  } catch {
    /* ignore */
  }
  return path
}

export async function startForgeRuntime(options?: {
  preferredPort?: number
  /** Max wait for API after spawn */
  readyTimeoutMs?: number
}): Promise<ForgeRuntimeStatus> {
  if (platform() !== 'win32') {
    return setStatus({
      state: 'error',
      message: 'Arranque automático de Forge solo en Windows.'
    })
  }

  // Already running our child
  if (child && !child.killed && status.state === 'running' && status.baseUrl) {
    const h = await probeForgeHealth(status.baseUrl)
    if (h.ok) return getForgeRuntimeStatus()
  }

  let hw = {}
  try {
    hw = (global as unknown as { __kawaiiHw?: object }).__kawaiiHw || {}
  } catch {
    /* ignore */
  }

  const { profile } = await ensureMachineProfile(hw as never)
  await ensureDataRootWorkspace(profile)

  if (!profile.lastPreflight.ok) {
    return setStatus({
      state: 'error',
      message: profile.lastPreflight.reasons[0] || 'Preflight no apto para Forge local.'
    })
  }

  const forgeRoot = await resolveForgeRoot(profile)
  if (!forgeRoot) {
    return setStatus({
      state: 'error',
      forgeRoot: profile.forgeInstallPath,
      message: 'Forge no instalado. Usa "Instalar Forge" en Ajustes primero.'
    })
  }

  // Reuse external instance if preferred/default ports already serve API
  for (const p of [
    options?.preferredPort,
    ...FORGE_PORT_CANDIDATES
  ].filter((x): x is number => typeof x === 'number')) {
    const url = `http://127.0.0.1:${p}`
    const h = await probeForgeHealth(url, 2500)
    if (h.ok) {
      return setStatus({
        state: 'running',
        port: p,
        baseUrl: url,
        pid: null,
        forgeRoot,
        message: `API ya activa en ${url} (proceso externo o previo).`,
        lastHealthAt: new Date().toISOString()
      })
    }
  }

  let port: number
  try {
    port = await pickForgePort(options?.preferredPort ?? 7860)
  } catch (err) {
    return setStatus({
      state: 'error',
      message: err instanceof Error ? err.message : String(err)
    })
  }

  // Always prefer app-managed 3.11 venv under Forge (never system 3.14)
  let resolved = await resolveForgePythonAndLaunch(forgeRoot)
  const dataRoot = profile.preferredDataRoot || profile.forgeInstallPath

  // Locate webui dir (launch.py)
  let webuiDir = forgeRoot
  if (!existsSync(join(webuiDir, 'launch.py'))) {
    try {
      const { readdir, stat } = await import('fs/promises')
      for (const n of await readdir(forgeRoot)) {
        const sub = join(forgeRoot, n)
        try {
          if ((await stat(sub)).isDirectory() && existsSync(join(sub, 'launch.py'))) {
            webuiDir = sub
            break
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  setStatus({
    state: 'starting',
    forgeRoot,
    message: 'Comprobando Python 3.11 + venv + torch para Forge…',
    bootProgress: 2
  })
  const envReady = await ensureForgeVenvWithTorch(dataRoot, webuiDir, (p) => {
    setStatus({
      state: 'starting',
      message: p.message,
      bootProgress: p.percent ?? 5
    })
  })
  if (!envReady.ok) {
    const hint = (envReady as { resumable?: boolean }).resumable
      ? ' Puedes pulsar otra vez «Arrancar Forge API» para reanudar (no empieza de cero).'
      : ''
    return setStatus({
      state: 'error',
      forgeRoot,
      message: `Entorno Forge: ${envReady.error}.${hint}`
    })
  }

  resolved = {
    python: envReady.python,
    launchPy: join(webuiDir, 'launch.py'),
    cwd: webuiDir,
    version: '3.11 (venv KawaiiGPT + torch)'
  }
  if (!existsSync(resolved.launchPy)) {
    return setStatus({
      state: 'error',
      forgeRoot,
      message: 'No se encontró launch.py de Forge. Reinstala Forge en la carpeta de datos.'
    })
  }

  const webStack = await ensureForgeWebStack(webuiDir, (p) => {
    setStatus({
      state: 'starting',
      message: p.message,
      bootProgress: p.percent ?? 93
    })
  })
  if (!webStack.ok) {
    return setStatus({
      state: 'error',
      forgeRoot,
      message: `Stack web Forge: ${webStack.error}. Puedes reintentar Arrancar Forge API.`
    })
  }

  const workRoot = resolved.cwd
  await ensureKawaiiWebuiUser(workRoot, port)
  const launcher = await writePortLauncher(workRoot, port)
  const baseUrl = `http://127.0.0.1:${port}`

  forgeNearReady = false
  forgeExitedEarly = false
  forgeLogTail = []
  forgeLogPath = join(workRoot, 'kawaii-forge-launch.log')
  try {
    writeFileSync(
      forgeLogPath,
      `==== KawaiiGPT Forge ${new Date().toISOString()} ====\n` +
        `workRoot=${workRoot}\n` +
        `python=${resolved?.python || 'bat'}\n` +
        `launchPy=${resolved?.launchPy || 'n/a'}\n` +
        `port=${port}\n`,
      'utf-8'
    )
  } catch {
    forgeLogPath = join(forgeRoot, 'kawaii-forge-launch.log')
  }

  setStatus({
    state: 'starting',
    port,
    baseUrl,
    forgeRoot,
    pid: null,
    message: resolved
      ? `Arrancando Forge (python directo) puerto ${port}…`
      : `Arrancando Forge (bat) puerto ${port}…`,
    startedAt: new Date().toISOString()
  })

  try {
    // Prefer spawning Python + launch.py directly (bat via cmd often exits 0 if the script returns early)
    if (resolved) {
      // Minimal known-good flags (Forge/A1111).
      // --listen is boolean; host goes in --server-name (not after --listen)
      const forgeArgs = forgeCliArgs(port)
      // py -3.11 launcher: executable is `py`, args start with -3.11
      const isPyLauncher = resolved.python === 'py' || /\bpy\.exe$/i.test(resolved.python)
      let cmd = resolved.python
      let args: string[]
      if (isPyLauncher && resolved.version?.includes('py launcher')) {
        const flag = resolved.version.includes('3.11')
          ? '-3.11'
          : resolved.version.includes('3.10')
            ? '-3.10'
            : '-3.12'
        args = [flag, resolved.launchPy, ...forgeArgs]
      } else {
        args = [resolved.launchPy, ...forgeArgs]
      }
      appendForgeLog(`spawn cmd=${cmd} args=${args.join(' ')} ver=${resolved.version || '?'}`)
      child = spawn(cmd, args, {
        cwd: resolved.cwd,
        windowsHide: false,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONNOUSERSITE: '1',
          PYTHON: cmd === 'py' ? '' : cmd,
          // Same pins as A1111 launch_utils (correct commit hashes)
          CLIP_PACKAGE:
            'https://github.com/openai/CLIP/archive/d50d76daa670286dd6cacf3bcd80b5e4823fc8e1.zip',
          OPENCLIP_PACKAGE:
            'https://github.com/mlfoundations/open_clip/archive/bb6e834e9c70d9c27d0dc3ecedeebeaeb1ffad6b.zip',
          // Args already on argv — empty COMMANDLINE_ARGS to avoid duplicate/invalid "--listen 127.0.0.1"
          COMMANDLINE_ARGS: ''
        }
      })
      setStatus({
        message: `Forge: Python ${resolved.version || '?'} · --api · puerto ${port}`
      })
    } else {
      child = spawn('cmd.exe', ['/c', launcher], {
        cwd: workRoot,
        windowsHide: false,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          COMMANDLINE_ARGS: forgeCliArgsString(port),
          PYTHONUNBUFFERED: '1'
        }
      })
    }
    const pid = child.pid ?? null
    setStatus({
      pid,
      state: 'starting',
      message: `Forge PID ${pid ?? '?'} · primer arranque puede descargar modelos (varios minutos)`,
      bootProgress: 5
    })
    broadcastForgeBoot({
      message: status.message,
      bootProgress: 5,
      state: 'starting'
    })

    let logBuffer = ''
    const onChunk = (buf: Buffer) => {
      logBuffer += buf.toString('utf8')
      const lines = logBuffer.split(/\r?\n/)
      logBuffer = lines.pop() ?? ''
      for (const line of lines) {
        appendForgeLog(line)
        const parsed = parseForgeLogLine(line)
        if (parsed.hint) {
          const elapsed = Date.now() - Date.parse(status.startedAt || new Date().toISOString())
          const prevPct = status.bootProgress ?? 0
          const nextPct =
            typeof parsed.pct === 'number'
              ? Math.max(prevPct, parsed.pct)
              : prevPct
          // Forge finished internal boot — API should appear soon (or UI-only without --api)
          if (
            /Startup time|Running on local URL|API server|Model loaded/i.test(parsed.hint)
          ) {
            forgeNearReady = true
          }
          broadcastForgeBoot({
            message: parsed.hint,
            lastLogLine: parsed.hint,
            bootProgress: nextPct,
            elapsedMs: elapsed,
            state: 'starting'
          })
        }
      }
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)

    child.on('exit', (code) => {
      appendForgeLog(`[exit] code=${code} state=${status.state}`)
      if (status.pid === pid && (status.state === 'starting' || status.state === 'error')) {
        forgeExitedEarly = true
        const logPath = forgeLogPath || join(workRoot || forgeRoot, 'kawaii-forge-launch.log')
        const tail = forgeLogTail.slice(-12).join(' | ')
        const hint = tail
          ? ` Salida: ${tail.slice(0, 280)}`
          : ' Sin salida capturada (¿Python no arrancó?).'
        setStatus({
          state: 'error',
          pid: null,
          message: `Forge se cerró antes de abrir la API (código ${code}).${hint} Archivo: ${logPath}`
        })
        child = null
      } else if (status.pid === pid) {
        setStatus({
          state: 'stopped',
          pid: null,
          message: `Forge terminó (código ${code}).`
        })
        child = null
      }
    })
  } catch (err) {
    child = null
    return setStatus({
      state: 'error',
      message: err instanceof Error ? err.message : String(err)
    })
  }

  // First boot may download models; cap wait so the UI does not sit on "starting" for 20+ min
  const timeout = options?.readyTimeoutMs ?? 1_200_000 // 20 min (torch/CLIP first boot)
  const start = Date.now()
  let lastMsgAt = 0
  let nearReadySince: number | null = null
  // forgeNearReady may already be true from log parser
  while (Date.now() - start < timeout) {
    if (forgeExitedEarly) {
      return getForgeRuntimeStatus()
    }
    // Also detect "Startup time" from lastLogLine if parser raced
    if (
      !forgeNearReady &&
      status.lastLogLine &&
      /Startup time|Running on local URL|API server/i.test(status.lastLogLine)
    ) {
      forgeNearReady = true
    }
    if (forgeNearReady && nearReadySince == null) nearReadySince = Date.now()
    // After Startup time, if /sdapi never appears for 90s → stop (UI without --api or stuck)
    if (nearReadySince != null && Date.now() - nearReadySince > 90_000) {
      const uiCheck = await probeForgeHealth(baseUrl, 3000)
      if (!uiCheck.ok) {
        // scan once more
        const scan = await scanForgeApiPorts()
        if (scan.ok && scan.baseUrl) {
          return setStatus({
            state: 'running',
            port: scan.port,
            baseUrl: scan.baseUrl,
            message: `Forge listo en ${scan.baseUrl}`,
            lastHealthAt: new Date().toISOString(),
            bootProgress: 100,
            elapsedMs: Date.now() - start
          })
        }
        // Stop our child so we don't leave UI-only Gradio blocking the port
        try {
          if (child && !child.killed) {
            child.kill()
          }
        } catch {
          /* ignore */
        }
        child = null
        return setStatus({
          state: 'error',
          pid: null,
          message:
            'Forge abrió la interfaz (Running on local URL) pero /sdapi no responde — suele faltar --api. ' +
            'Cierra cualquier ventana negra de Python y pulsa otra vez «Arrancar Forge API». ' +
            'La app ahora usa launch.py --api (no webui-user.bat).',
          bootProgress: 95,
          elapsedMs: Date.now() - start
        })
      }
    }
    const elapsed = Date.now() - start
    // Prefer configured URL, then scan all candidate ports (Forge may bind another)
    const urls = [
      baseUrl,
      ...FORGE_PORT_CANDIDATES.map((p) => `http://127.0.0.1:${p}`)
    ]
    const seen = new Set<string>()
    for (const url of urls) {
      const u = url.replace(/\/$/, '')
      if (seen.has(u)) continue
      seen.add(u)
      const h = await probeForgeHealth(u, forgeNearReady ? 4000 : 3500)
      if (h.ok) {
        const port = Number(u.split(':').pop()) || status.port
        forgeNearReady = false
        return setStatus({
          state: 'running',
          port,
          baseUrl: u,
          message: `Forge listo en ${u}`,
          lastHealthAt: new Date().toISOString(),
          bootProgress: 100,
          elapsedMs: elapsed
        })
      }
      // Early exit: UI up + explicit 404 on /sdapi after nearReady ≥ 45s
      if (
        forgeNearReady &&
        nearReadySince != null &&
        Date.now() - nearReadySince > 45_000 &&
        (h as { uiOnly?: boolean }).uiOnly
      ) {
        try {
          if (child && !child.killed) child.kill()
        } catch {
          /* ignore */
        }
        child = null
        return setStatus({
          state: 'error',
          pid: null,
          message:
            `UI en ${u} sin /sdapi (404). Reinicia con «Arrancar Forge API» (launch.py --api).`,
          bootProgress: 95,
          elapsedMs: elapsed
        })
      }
    }

    if (elapsed - lastMsgAt > (forgeNearReady ? 4000 : 10_000)) {
      lastMsgAt = elapsed
      const mins = Math.floor(elapsed / 60_000)
      const secs = Math.floor((elapsed % 60_000) / 1000)
      const hint =
        status.lastLogLine ||
        (forgeNearReady
          ? 'Arranque interno OK — esperando que la API acepte conexiones…'
          : 'Cargando entorno / modelos. Si ya viste «Startup time» en Python, pulsa Health API.')
      const timePct = forgeNearReady
        ? Math.min(99, 96)
        : Math.min(85, 5 + Math.floor(elapsed / 12_000))
      const prevPct = status.bootProgress ?? 0
      broadcastForgeBoot({
        message: `Arrancando… ${mins}m ${secs}s — ${hint}`,
        bootProgress: Math.max(prevPct, timePct),
        elapsedMs: elapsed,
        lastLogLine: status.lastLogLine,
        state: 'starting'
      })
    }

    // Faster polls after Startup time; still gentle before that
    await new Promise((r) => setTimeout(r, forgeNearReady ? 1200 : 3000))
  }

  // Timeout: if something might still be loading, soft status (not hard error)
  const still = isPidAlive(status.pid)
  for (const p of FORGE_PORT_CANDIDATES) {
    const url = `http://127.0.0.1:${p}`
    const h = await probeForgeHealth(url, 3000)
    if (h.ok) {
      return setStatus({
        state: 'running',
        port: p,
        baseUrl: url,
        message: `Forge listo en ${url}`,
        lastHealthAt: new Date().toISOString(),
        bootProgress: 100
      })
    }
  }

  return setStatus({
    state: still || status.pid ? 'starting' : 'error',
    message: still || status.pid
      ? `Tras varios minutos la API aún no responde en ${baseUrl}. Mira la ventana de Python: si ya dice «Startup time», cierra Python y vuelve a «Arrancar Forge API».`
      : `Timeout esperando API en ${baseUrl}. Cierra procesos Python de Forge y reintenta.`
  })

}

export async function stopForgeRuntime(): Promise<ForgeRuntimeStatus> {
  if (child && child.pid) {
    try {
      // Kill process tree on Windows
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    } catch {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
    child = null
  }
  return setStatus({
    state: 'stopped',
    pid: null,
    message: 'Forge detenido (si era proceso de esta app).'
  })
}

export async function refreshForgeHealth(): Promise<ForgeRuntimeStatus> {
  // 1) Try known baseUrl
  if (status.baseUrl) {
    const h = await probeForgeHealth(status.baseUrl, 6000)
    if (h.ok) {
      const url = h.baseUrl || status.baseUrl
      return setStatus({
        state: 'running',
        baseUrl: url,
        port: Number(url.split(':').pop()) || status.port,
        lastHealthAt: new Date().toISOString(),
        message: `Forge listo en ${url}`
      })
    }
  }
  // 2) Full port scan (covers main-process restart while Python still runs)
  const scan = await scanForgeApiPorts()
  if (scan.ok && scan.baseUrl) {
    return setStatus({
      state: 'running',
      port: scan.port,
      baseUrl: scan.baseUrl,
      message: `API detectada en ${scan.baseUrl}`,
      lastHealthAt: new Date().toISOString()
    })
  }
  return setStatus({
    state: status.state === 'starting' ? 'starting' : 'stopped',
    message: scan.error || 'No hay API Forge en puertos conocidos.',
    // keep baseUrl if starting so UI can still show target
  })
}

/** Suggest settings.a1111BaseUrl after runtime is up */
export function runtimeBaseUrlOrDefault(): string {
  return status.baseUrl || 'http://127.0.0.1:7860'
}

/**
 * A3: make local image path ready — start Forge if needed, sync checkpoints, health.
 */
export async function ensureLocalImagePipeline(options?: {
  preferredPort?: number
  readyTimeoutMs?: number
}): Promise<{
  ok: boolean
  baseUrl: string | null
  port: number | null
  modelsCount: number
  synced: { copied: string[]; skipped: string[] }
  message: string
}> {
  const sync = await syncCheckpointsToForge()
  const synced = { copied: sync.copied || [], skipped: sync.skipped || [] }

  // Start or detect runtime
  let st = getForgeRuntimeStatus()
  if (st.state !== 'running' || !st.baseUrl) {
    st = await startForgeRuntime({
      preferredPort: options?.preferredPort,
      readyTimeoutMs: options?.readyTimeoutMs ?? 1_200_000
    })
  } else {
    st = await refreshForgeHealth()
  }

  if (st.state !== 'running' || !st.baseUrl) {
    return {
      ok: false,
      baseUrl: st.baseUrl,
      port: st.port,
      modelsCount: 0,
      synced,
      message: st.message || 'Forge no está listo'
    }
  }

  // Health + model count
  const h = await probeForgeHealth(st.baseUrl, 8000)
  let modelsCount = 0
  if (h.ok) {
    try {
      const res = await fetch(`${st.baseUrl.replace(/\/$/, '')}/sdapi/v1/sd-models`)
      if (res.ok) {
        const arr = (await res.json()) as unknown[]
        modelsCount = Array.isArray(arr) ? arr.length : 0
      }
    } catch {
      /* ignore */
    }
  }

  if (!h.ok) {
    return {
      ok: false,
      baseUrl: st.baseUrl,
      port: st.port,
      modelsCount,
      synced,
      message: h.error || 'API no responde'
    }
  }

  return {
    ok: true,
    baseUrl: st.baseUrl,
    port: st.port,
    modelsCount,
    synced,
    message:
      modelsCount > 0
        ? `Forge listo en ${st.baseUrl} · ${modelsCount} checkpoint(s)`
        : `Forge listo en ${st.baseUrl} · sin checkpoints visibles (sincroniza o descarga SD 1.5)`
  }
}
