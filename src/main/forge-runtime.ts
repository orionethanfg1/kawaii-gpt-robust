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
  ensureForgeNumpySkimage,
} from './python-runtime'


// E-FORGE-RT: ports/health live in forge-ports.ts (re-export for existing imports)
export {
  FORGE_PORT_CANDIDATES,
  forgeCliArgs,
  forgeCliArgsString,
  freePortIfStale,
  isPortInUse,
  canBindPort,
  pickForgePort,
  probeForgeHealth,
  scanForgeApiPorts
} from './forge-ports'
import {
  FORGE_PORT_CANDIDATES,
  freePortIfStale,
  pickForgePort,
  probeForgeHealth,
  scanForgeApiPorts,
  forgeCliArgs,
  forgeCliArgsString
} from './forge-ports'

import {
  resolveForgeRoot,
  resolveForgePythonAndLaunch,
  writePortLauncher,
  ensureKawaiiWebuiUser
} from './forge-launch'

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

export async function startForgeRuntime(options?: {
  preferredPort?: number
  /** Max wait for API after spawn */
  readyTimeoutMs?: number
  /** Skip R2 unload (caller already did it) */
  skipUnload?: boolean
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

  // R2 — liberar VRAM de Ollama antes de CUDA/Forge (cubre forge:start e image-ipc)
  let unloadNote = ''
  if (!options?.skipUnload) {
    try {
      const { unloadLocalModelsForForge } = await import('../core/resources/unload-local')
      const ur = await unloadLocalModelsForForge({
        unloadAll: false,
        minSizeGB: 4
      })
      unloadNote = ur.detail
      if (ur.unloaded.length) {
        console.log('[forge] R2 unload:', ur.detail)
        setStatus({
          message: 'R2: ' + ur.detail,
          bootProgress: 2
        })
        broadcastForgeBoot({
          message: 'R2: ' + ur.detail,
          bootProgress: 2,
          state: 'starting'
        })
      }
    } catch (e) {
      unloadNote = e instanceof Error ? e.message : String(e)
      console.warn('[forge] R2 unload failed:', unloadNote)
    }
  }

  let hw = {}
  try {
    hw = (global as unknown as { __kawaiiHw?: object }).__kawaiiHw || {}
  } catch {
    /* ignore */
  }

  const { profile } = await ensureMachineProfile(hw as never)
  await ensureDataRootWorkspace(profile)

  const forgeRoot = await resolveForgeRoot(profile)

  // Prefer live API before any preflight gate (Forge may already be up)
  for (const p of [
    options?.preferredPort,
    ...FORGE_PORT_CANDIDATES
  ].filter((x): x is number => typeof x === 'number')) {
    for (const host of ['127.0.0.1', 'localhost'] as const) {
      const url = `http://${host}:${p}`
      const h = await probeForgeHealth(url, 2500)
      if (h.ok) {
        return setStatus({
          state: 'running',
          port: p,
          baseUrl: h.baseUrl || url,
          pid: null,
          forgeRoot: forgeRoot || profile.forgeInstallPath,
          message: `API ya activa en ${h.baseUrl || url}`,
          lastHealthAt: new Date().toISOString()
        })
      }
    }
  }

  // Preflight: never hard-block on GPU detection false negatives (cached profile may still list it)
  if (!profile.lastPreflight.ok) {
    const hard = (profile.lastPreflight.reasons || []).filter(
      (r) => !/GPU NVIDIA|Forge CUDA|Pollinations|generación cloud/i.test(r)
    )
    if (hard.length) {
      return setStatus({
        state: 'error',
        message: hard[0] || 'Preflight no apto para Forge local.'
      })
    }
  }

  if (!forgeRoot) {
    return setStatus({
      state: 'error',
      forgeRoot: profile.forgeInstallPath,
      message: 'Forge no instalado. Usa "Instalar Forge" en Ajustes primero.'
    })
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

  const npSki = await ensureForgeNumpySkimage(webuiDir, (p) => {
    setStatus({
      state: 'starting',
      message: p.message,
      bootProgress: p.percent ?? 96
    })
  })
  if (!npSki.ok) {
    return setStatus({
      state: 'error',
      forgeRoot,
      message: `numpy/skimage: ${npSki.error}. Reintenta Arrancar Forge API (repara el venv).`
    })
  }
  if (npSki.repaired) {
    setStatus({
      state: 'starting',
      message: 'numpy/scikit-image reparados — arrancando Forge…',
      bootProgress: 98
    })
  }

  const workRoot = resolved.cwd
  await ensureKawaiiWebuiUser(workRoot, port)
  const launcher = await writePortLauncher(workRoot, port)
  const baseUrl = `http://127.0.0.1:${port}`
  // Avoid zombie UI-only process answering on this port without /sdapi
  await freePortIfStale(port)
  await new Promise((r) => setTimeout(r, 400))

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
    // After "Startup time" / Gradio line: API may still load models for several minutes.
    // Do NOT kill at 90s — that was a regression when Forge was healthy but slow.
    // Only fail early if we get a hard /sdapi 404 (true missing --api) for a sustained period
    // AND the process already exited; otherwise keep polling until main timeout.
    if (nearReadySince != null && Date.now() - nearReadySince > 45_000) {
      const uiCheck = await probeForgeHealth(baseUrl, 4000)
      if (uiCheck.ok) {
        return setStatus({
          state: 'running',
          port,
          baseUrl: uiCheck.baseUrl || baseUrl,
          message: `Forge listo en ${uiCheck.baseUrl || baseUrl}`,
          lastHealthAt: new Date().toISOString(),
          bootProgress: 100,
          elapsedMs: Date.now() - start,
          apiOk: true
        })
      }
      const scan = await scanForgeApiPorts()
      if (scan.ok && scan.baseUrl) {
        return setStatus({
          state: 'running',
          port: scan.port,
          baseUrl: scan.baseUrl,
          message: `Forge listo en ${scan.baseUrl}`,
          lastHealthAt: new Date().toISOString(),
          bootProgress: 100,
          elapsedMs: Date.now() - start,
          apiOk: true
        })
      }
      // Sustained UI-only 404 after 6 min with process still up → likely wrong flags / zombie port
      const waited = Date.now() - nearReadySince
      const childAlive = Boolean(child && child.exitCode == null && !child.killed)
      if (
        uiCheck.uiOnly &&
        /404|sin --api/i.test(uiCheck.error || '') &&
        waited > 360_000 &&
        !childAlive
      ) {
        return setStatus({
          state: 'error',
          pid: null,
          message:
            'Forge mostró interfaz pero /sdapi nunca respondió (proceso cerrado). ' +
            'Cierra ventanas negras de Python, pulsa Detener Forge y Arrancar de nuevo.',
          bootProgress: 95,
          elapsedMs: Date.now() - start
        })
      }
      // Still starting: update message so UI is not silent
      if (waited > 60_000 && Date.now() - lastMsgAt > 15_000) {
        lastMsgAt = Date.now()
        setStatus({
          message: childAlive
            ? `Forge arrancando API… (${Math.floor(waited / 1000)}s). Modelos pueden tardar; no cierres.`
            : `Esperando /sdapi… (${Math.floor(waited / 1000)}s)`,
          bootProgress: Math.min(98, 70 + Math.floor(waited / 10000)),
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
  // Do not keep a dead baseUrl (e.g. :7890) or surface last probe fetch-failed as the message.
  const starting = status.state === 'starting'
  return setStatus({
    state: starting ? 'starting' : 'stopped',
    baseUrl: starting ? status.baseUrl : null,
    port: starting ? status.port : null,
    message: starting
      ? status.message || 'Forge arrancando…'
      : 'No hay API Forge en puertos conocidos (7860–7890). Usa Capas → Arrancar Forge.'
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
  /** When false, do not stop ACE (default true = free VRAM for SD) */
  releaseMusic?: boolean
}): Promise<{
  ok: boolean
  baseUrl: string | null
  port: number | null
  modelsCount: number
  synced: { copied: string[]; skipped: string[] }
  message: string
}> {
  if (options?.releaseMusic !== false) {
    try {
      const { prepareHeavyLayer } = await import('./layer-scheduler')
      // prepareHeavyLayer('image') stops music then we start forge below —
      // call release only path to avoid double start
      const { getMusicRuntimeStatus, stopMusicRuntime } = await import('./music-runtime')
      const ms = getMusicRuntimeStatus()
      if (ms.state === 'running' || ms.state === 'starting') {
        await stopMusicRuntime()
      }
    } catch {
      /* ignore */
    }
  }
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
  // Forge often returns 500 on /sd-models (pydantic); fall back to disk list.
  const h = await probeForgeHealth(st.baseUrl, 8000)
  let modelsCount = 0
  let modelsNote = ''
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
    if (modelsCount === 0) {
      try {
        const { listInstalledCheckpoints } = await import('./sd-workspace')
        const disk = await listInstalledCheckpoints()
        modelsCount = disk.length
        if (modelsCount > 0) modelsNote = ' (desde disco)'
      } catch {
        /* ignore */
      }
    }
    if (modelsCount === 0 && (synced.copied.length || synced.skipped.length)) {
      modelsCount = synced.copied.length + synced.skipped.length
      modelsNote = ' (sync)'
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
        ? `Forge listo en ${st.baseUrl} · ${modelsCount} checkpoint(s)${modelsNote}`
        : `Forge listo en ${st.baseUrl} · API OK (lista de modelos aún vacía; si falla txt2img, sincroniza checkpoints en Capas)`
  }
}
