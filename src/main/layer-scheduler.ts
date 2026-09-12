/**
 * Dynamic heavy-layer scheduler: only one GPU-heavy backend "hot" at a time.
 * Chat stays always-on (Ollama/cloud). Image (Forge) and Music (ACE) swap VRAM.
 */

import { BrowserWindow } from 'electron'

export type HeavyLayer = 'none' | 'image' | 'music'

export type LayerScheduleEvent = {
  phase: 'preparing' | 'ready' | 'released' | 'error'
  target: HeavyLayer
  released?: HeavyLayer
  message: string
  ms?: number
}

let activeHeavy: HeavyLayer = 'none'
let lastEvent: LayerScheduleEvent | null = null
let chain: Promise<unknown> = Promise.resolve()
/** Keep Forge warm briefly between image jobs to avoid slow cold starts */
let stickyImageUntil = 0
const STICKY_IMAGE_MS = 8 * 60 * 1000


function broadcast(ev: LayerScheduleEvent): void {
  lastEvent = ev
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.webContents.send('layers:schedule', ev)
    } catch {
      /* ignore */
    }
  }
}

export function getActiveHeavyLayer(): HeavyLayer {
  return activeHeavy
}

export function getLastLayerEvent(): LayerScheduleEvent | null {
  return lastEvent
}

/** Serialize layer switches so concurrent image+music don't fight. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

async function releaseImage(reason: string): Promise<void> {
  try {
    const { getForgeRuntimeStatus, stopForgeRuntime } = await import('./forge-runtime')
    const st = getForgeRuntimeStatus()
    if (st.state === 'running' || st.state === 'starting') {
      broadcast({
        phase: 'released',
        target: 'music',
        released: 'image',
        message: `Liberando Forge (VRAM) · ${reason}`
      })
      await stopForgeRuntime()
    }
  } catch {
    /* ignore */
  }
}

async function releaseMusic(reason: string): Promise<void> {
  try {
    const { getMusicRuntimeStatus, stopMusicRuntime } = await import('./music-runtime')
    const st = getMusicRuntimeStatus()
    if (st.state === 'running' || st.state === 'starting') {
      broadcast({
        phase: 'released',
        target: 'image',
        released: 'music',
        message: `Pausando ACE música · ${reason}`
      })
      await stopMusicRuntime()
    }
  } catch {
    /* ignore */
  }
}

/**
 * Ensure the requested heavy layer can use the GPU.
 * Releases the other heavy layer first when needed.
 */
export async function prepareHeavyLayer(
  target: HeavyLayer,
  opts?: { reason?: string; skipRelease?: boolean }
): Promise<{ ok: boolean; active: HeavyLayer; message: string }> {
  return enqueue(async () => {
    const reason = opts?.reason || 'solicitud del usuario'
    const t0 = Date.now()

    if (target === 'none') {
      if (!opts?.skipRelease) {
        await releaseImage(reason)
        await releaseMusic(reason)
      }
      activeHeavy = 'none'
      broadcast({
        phase: 'ready',
        target: 'none',
        message: 'Capas pesadas en reposo (chat listo)',
        ms: Date.now() - t0
      })
      return { ok: true, active: 'none', message: 'idle' }
    }

    broadcast({
      phase: 'preparing',
      target,
      message:
        target === 'music'
          ? 'Preparando música (puede liberar Forge un momento)…'
          : 'Preparando imagen (puede pausar ACE un momento)…',
      ms: 0
    })

    if (target === 'music') {
      if (!opts?.skipRelease) {
        // Always free VRAM for music; sticky only helps consecutive image jobs
        await releaseImage(reason)
      }
      try {
        const { ensureMusicReady, getMusicRuntimeStatus } = await import('./music-runtime')
        const st = await ensureMusicReady()
        const ok = st.state === 'running' && Boolean(st.baseUrl)
        activeHeavy = ok ? 'music' : activeHeavy
        const message = ok
          ? `Música lista (${st.baseUrl})`
          : st.message || 'ACE no listo'
        broadcast({
          phase: ok ? 'ready' : 'error',
          target: 'music',
          message,
          ms: Date.now() - t0
        })
        return { ok, active: activeHeavy, message }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        broadcast({ phase: 'error', target: 'music', message, ms: Date.now() - t0 })
        return { ok: false, active: activeHeavy, message }
      }
    }

    // image
    try {
      const { ensureLocalImagePipeline, getForgeRuntimeStatus, refreshForgeHealth } =
        await import('./forge-runtime')
      // Fast path: Forge already hot
      const live = getForgeRuntimeStatus()
      if (live.state === 'running') {
        try {
          await refreshForgeHealth()
        } catch {
          /* ignore */
        }
        const st2 = getForgeRuntimeStatus()
        if (st2.state === 'running') {
          activeHeavy = 'image'
          stickyImageUntil = Date.now() + STICKY_IMAGE_MS
          const message = `Imagen lista (ya activa · ${st2.baseUrl || 'API'})`
          broadcast({
            phase: 'ready',
            target: 'image',
            message,
            ms: Date.now() - t0
          })
          return { ok: true, active: 'image', message }
        }
      }
    } catch {
      /* fall through to full start */
    }
    if (!opts?.skipRelease) await releaseMusic(reason)
    try {
      const { ensureLocalImagePipeline, getForgeRuntimeStatus } = await import('./forge-runtime')
      const pipe = await ensureLocalImagePipeline({})
      const st = getForgeRuntimeStatus()
      const ok = Boolean(pipe.ok && st.state === 'running')
      activeHeavy = ok ? 'image' : activeHeavy
      if (ok) stickyImageUntil = Date.now() + STICKY_IMAGE_MS
      const message = ok
        ? `Imagen lista (${pipe.baseUrl || st.baseUrl}) · primera carga puede tardar`
        : pipe.message || st.message || 'Forge no listo'
      broadcast({
        phase: ok ? 'ready' : 'error',
        target: 'image',
        message,
        ms: Date.now() - t0
      })
      return { ok, active: activeHeavy, message }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      broadcast({ phase: 'error', target: 'image', message, ms: Date.now() - t0 })
      return { ok: false, active: activeHeavy, message }
    }
  })
}

/** Boot policy: do NOT start Forge+ACE together. Prefer Ollama only; heavy on demand. */
export async function scheduleBootLayers(opts?: {
  autoImage?: boolean
}): Promise<void> {
  // Default: leave heavy layers cold at boot to keep chat fast and RAM free.
  activeHeavy = 'none'
  broadcast({
    phase: 'ready',
    target: 'none',
    message: 'Capas imagen/música bajo demanda (VRAM libre para el chat)'
  })
  if (opts?.autoImage) {
    // Explicit only — default boot keeps GPU free
    void prepareHeavyLayer('image', { reason: 'arranque solicitado' })
  }
}
