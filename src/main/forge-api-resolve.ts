/**
 * E1 / I2 — Resolve a live Forge / A1111 API base URL for image generation.
 *
 * Contract: unload LLM → status → scan ports → start runtime → probe /sdapi
 * (not Gradio-only) → optional one controlled restart on soft failure.
 */

export type ResolveForgeApiOptions = {
  preferredBaseUrl?: string | null
  preferredPort?: number
  /** Attempt startForgeRuntime if nothing answers (default true) */
  startIfMissing?: boolean
  /** I2: unload large local LLMs before start (default true) */
  unloadLocalModels?: boolean
  /** I2: one stop+start if health fails after first start (default true) */
  allowOneRestart?: boolean
  onProgress?: (pct: number, detail: string) => void
}

export type ResolveForgeApiResult = {
  ok: boolean
  baseUrl: string | null
  message: string
  started: boolean
  restarted?: boolean
  /** True when /sdapi/v1/sd-models or options responded */
  sdapiOk?: boolean
}

function norm(url: string): string {
  return String(url || '').replace(/\/$/, '')
}

/** I2 — Prefer real sdapi over Gradio-only HTTP 200 */
async function verifySdApi(baseUrl: string, timeoutMs = 6000): Promise<{ ok: boolean; detail: string }> {
  const root = norm(baseUrl)
  const paths = ['/sdapi/v1/sd-models', '/sdapi/v1/options', '/sdapi/v1/samplers']
  for (const path of paths) {
    try {
      const res = await fetch(`${root}${path}`, {
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (res.ok) {
        return { ok: true, detail: `sdapi ok (${path})` }
      }
      // Forge sometimes 500 on sd-models but options works
      if (res.status >= 500 && path.includes('sd-models')) continue
    } catch {
      /* try next */
    }
  }
  return { ok: false, detail: 'sdapi no respondió (¿Forge sin --api?)' }
}

export async function resolveForgeApiForGeneration(
  opts: ResolveForgeApiOptions = {}
): Promise<ResolveForgeApiResult> {
  const onProgress = opts.onProgress || (() => {})
  const startIfMissing = opts.startIfMissing !== false
  const doUnload = opts.unloadLocalModels !== false
  const allowRestart = opts.allowOneRestart !== false
  let started = false
  let restarted = false

  const {
    getForgeRuntimeStatus,
    scanForgeApiPorts,
    refreshForgeHealth,
    startForgeRuntime,
    stopForgeRuntime,
    probeForgeHealth
  } = await import('./forge-runtime')

  // I2 — free VRAM before heavy image stack
  if (doUnload) {
    onProgress(3, 'I2: liberando modelos LLM locales (VRAM)…')
    try {
      const { unloadLocalModelsForForge } = await import('../core/resources/unload-local')
      const ur = await unloadLocalModelsForForge({ minSizeGB: 4 })
      if (ur?.detail) onProgress(4, 'I2: ' + String(ur.detail).slice(0, 140))
    } catch {
      /* forge-runtime start may also unload */
    }
  }

  let root: string | null = null
  const preferred = (opts.preferredBaseUrl || '').trim()
  if (preferred) root = norm(preferred)

  try {
    const st = getForgeRuntimeStatus()
    if (st.baseUrl && (st.apiOk || st.state === 'running')) {
      root = norm(st.baseUrl)
      onProgress(8, 'Forge ya en runtime: ' + root)
    }
  } catch {
    /* optional */
  }

  if (!root) {
    onProgress(8, 'Buscando API Forge en puertos…')
    try {
      const scan = await scanForgeApiPorts()
      if (scan.ok && scan.baseUrl) root = norm(scan.baseUrl)
    } catch {
      /* */
    }
  }

  async function tryStart(): Promise<void> {
    onProgress(10, 'Arrancando Forge…')
    await startForgeRuntime({
      preferredPort: opts.preferredPort
    })
    started = true
    const st2 = getForgeRuntimeStatus()
    if (st2.baseUrl) root = norm(st2.baseUrl)
    else {
      const scan2 = await scanForgeApiPorts()
      if (scan2.ok && scan2.baseUrl) root = norm(scan2.baseUrl)
    }
  }

  if (!root && startIfMissing) {
    try {
      await tryStart()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        baseUrl: null,
        message: 'No se pudo arrancar Forge: ' + msg.slice(0, 180),
        started,
        restarted
      }
    }
  }

  try {
    await refreshForgeHealth()
  } catch {
    /* */
  }

  if (!root) root = 'http://127.0.0.1:7860'
  onProgress(12, 'Forge en ' + root)

  let h = await probeForgeHealth(root, 6000)
  if (!h.ok) {
    const scan = await scanForgeApiPorts()
    if (scan.ok && scan.baseUrl) {
      root = norm(scan.baseUrl)
      h = await probeForgeHealth(root, 5000)
    }
  }

  // I2 — one controlled restart if soft-fail after we believe it should be up
  if (!h.ok && allowRestart && startIfMissing) {
    onProgress(14, 'I2: reinicio controlado de Forge (1 intento)…')
    try {
      await stopForgeRuntime()
      await new Promise((r) => setTimeout(r, 1500))
      await tryStart()
      restarted = true
      try {
        await refreshForgeHealth()
      } catch {
        /* */
      }
      if (!root) root = 'http://127.0.0.1:7860'
      const st3 = getForgeRuntimeStatus()
      if (st3.baseUrl) root = norm(st3.baseUrl)
      h = await probeForgeHealth(root, 8000)
      if (!h.ok) {
        const scan = await scanForgeApiPorts()
        if (scan.ok && scan.baseUrl) {
          root = norm(scan.baseUrl)
          h = await probeForgeHealth(root, 6000)
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        baseUrl: root,
        message: 'Reinicio Forge falló: ' + msg.slice(0, 160),
        started,
        restarted: true
      }
    }
  }

  if (!h.ok) {
    return {
      ok: false,
      baseUrl: root,
      message:
        h.error ||
        'No hay API Forge (--api). Cierra la ventana de Forge abierta a mano y usa Arrancar Forge en la app.',
      started,
      restarted,
      sdapiOk: false
    }
  }

  root = norm(h.baseUrl || root)
  onProgress(16, 'Verificando /sdapi…')
  const sd = await verifySdApi(root, 7000)
  if (!sd.ok) {
    // soft: probe said ok but sdapi flaky — still return ok with warning (Forge 500 on models)
    onProgress(17, sd.detail + ' · se intentará generar igual')
  } else {
    onProgress(18, sd.detail)
  }

  return {
    ok: true,
    baseUrl: root,
    message: 'Forge API lista en ' + root + (restarted ? ' (tras reinicio)' : ''),
    started,
    restarted,
    sdapiOk: sd.ok
  }
}
