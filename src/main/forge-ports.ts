/**
 * E-FORGE-RT: port allocation + API health probe (extracted from forge-runtime).
 * Keeps forge-runtime focused on process lifecycle (start/stop/status).
 */
import { spawnSync } from 'child_process'
import { platform } from 'os'

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


export async function freePortIfStale(port: number): Promise<void> {
  if (platform() !== 'win32') return
  try {
    const r = spawnSync(
      'cmd.exe',
      [
        '/c',
        `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port} ^| findstr LISTENING') do taskkill /F /PID %a`
      ],
      { timeout: 8000, windowsHide: true }
    )
    void r
  } catch {
    /* ignore */
  }
}

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
