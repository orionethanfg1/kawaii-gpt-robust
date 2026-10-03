/**
 * P0.2 — single path to get a healthy Forge/A1111 API before image gen.
 * Prefer imageEnsureLocalPipeline (main waits for API); fall back to forgeStart + port scan.
 */

export type EnsureForgeResult = {
  ok: boolean
  baseUrl: string | null
  message: string
  modelsCount?: number
}

const PORTS = [7860, 7861, 7862, 3000, 7863, 7864]

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function healthAt(url?: string | null): Promise<{ ok: boolean; baseUrl?: string }> {
  if (!url || !window.kawaii?.imageA1111Health) return { ok: false }
  try {
    const h = await window.kawaii.imageA1111Health(url)
    if (h?.ok) return { ok: true, baseUrl: url.replace(/\/$/, '') }
  } catch {
    /* */
  }
  return { ok: false }
}

async function scanPorts(): Promise<string | null> {
  for (const p of PORTS) {
    for (const host of ['127.0.0.1', 'localhost']) {
      const url = `http://${host}:${p}`
      const h = await healthAt(url)
      if (h.ok) return h.baseUrl || url
    }
  }
  return null
}

export type EnsureForgeProgress = (msg: string) => void

/**
 * Ensures Forge API is reachable. Call before imageGenerate.
 */
export async function ensureForgeReady(opts: {
  preferredBaseUrl?: string
  preferredPort?: number
  onProgress?: EnsureForgeProgress
  /** max extra wait after pipeline returns not-ready (ms) */
  extraWaitMs?: number
}): Promise<EnsureForgeResult> {
  const preferred =
    (opts.preferredBaseUrl || '').trim() || 'http://127.0.0.1:7860'
  const onProgress = opts.onProgress || (() => {})

  // 1) Already healthy?
  let h = await healthAt(preferred)
  if (h.ok) {
    return { ok: true, baseUrl: h.baseUrl || preferred, message: 'Forge ya respondía' }
  }
  const scanned = await scanPorts()
  if (scanned) {
    return { ok: true, baseUrl: scanned, message: `Forge detectado en ${scanned}` }
  }

  // R2 — liberar LLM local antes de arrancar Forge (VRAM)
  onProgress('R2: liberando modelos locales en memoria…')
  try {
    const ur = await window.kawaii?.unloadLocalModels?.({
      unloadAll: false,
      minSizeGB: 4
    })
    if (ur?.detail) {
      onProgress('R2: ' + String(ur.detail).slice(0, 160))
    }
  } catch {
    /* main también hace unload al start */
  }

  // 2) Full pipeline (starts process + waits API in main)
  onProgress('Arrancando Forge/SD (pipeline local)…')
  try {
    const pipe = await window.kawaii?.imageEnsureLocalPipeline?.(opts.preferredPort)
    if (pipe?.ok && pipe.baseUrl) {
      const h2 = await healthAt(pipe.baseUrl)
      if (h2.ok) {
        return {
          ok: true,
          baseUrl: pipe.baseUrl,
          message: pipe.message || `Forge listo en ${pipe.baseUrl}`,
          modelsCount: pipe.modelsCount
        }
      }
    }
    if (pipe && !pipe.ok && pipe.message) {
      onProgress(pipe.message)
    }
  } catch (e) {
    onProgress(
      'Pipeline: ' + (e instanceof Error ? e.message : String(e)).slice(0, 100)
    )
  }

  // 3) forgeStart + poll
  onProgress('Invocando forge:start…')
  let startBase: string | null = null
  try {
    const started = await window.kawaii?.forgeStart?.(opts.preferredPort)
    startBase =
      (started as { baseUrl?: string } | undefined)?.baseUrl ||
      (typeof (started as { port?: number })?.port === 'number'
        ? 'http://127.0.0.1:' + String((started as { port: number }).port)
        : null)
    const st0 = started as { state?: string; message?: string } | undefined
    if (st0?.state === 'error') {
      return {
        ok: false,
        baseUrl: startBase,
        message:
          String(st0.message || '').trim() ||
          'Forge no pudo arrancar (error en forge:start). Revisa Ajustes > Capas.'
      }
    }
    if (st0?.message) onProgress(String(st0.message).slice(0, 180))
  } catch (e) {
    return {
      ok: false,
      baseUrl: null,
      message:
        'forgeStart falló: ' +
        (e instanceof Error ? e.message : String(e)).slice(0, 160)
    }
  }

  const deadline = Date.now() + (opts.extraWaitMs ?? 180_000)
  let lastPct = 0
  const off = window.kawaii?.onForgeBootProgress?.((p) => {
    if (typeof p?.bootProgress === 'number') lastPct = Math.max(lastPct, p.bootProgress)
    if (typeof (p as { pct?: number }).pct === 'number') {
      lastPct = Math.max(lastPct, (p as { pct: number }).pct)
    }
  })

  try {
    while (Date.now() < deadline) {
      try {
        const st = await window.kawaii?.forgeStatus?.()
        const bp = (st as { bootProgress?: number })?.bootProgress
        if (typeof bp === 'number') lastPct = Math.max(lastPct, bp)
        const state = (st as { state?: string })?.state
        const bu = (st as { baseUrl?: string })?.baseUrl
        const stMsg = String(
          (st as { message?: string })?.message ||
            (st as { lastLogLine?: string })?.lastLogLine ||
            ''
        ).trim()
        onProgress(
          'Arrancando Forge... ' +
            Math.min(99, Math.round(Number(lastPct) || 0)) +
            '% · ' +
            String(state || '?') +
            (stMsg ? ' — ' + stMsg.slice(0, 140) : '')
        )
        if (state === 'error') {
          return {
            ok: false,
            baseUrl: bu || startBase,
            message:
              stMsg ||
              'Forge en error. Revisa Ajustes > Capas > consola Forge.'
          }
        }
        if (bu) {
          const hh = await healthAt(bu)
          if (hh.ok) {
            return {
              ok: true,
              baseUrl: hh.baseUrl || bu,
              message: `Forge listo en ${bu}`
            }
          }
        }
      } catch {
        /* */
      }

      for (const u of [startBase, preferred].filter(Boolean) as string[]) {
        const hh = await healthAt(u)
        if (hh.ok) {
          return { ok: true, baseUrl: hh.baseUrl || u, message: `Forge listo en ${u}` }
        }
      }
      const again = await scanPorts()
      if (again) {
        return { ok: true, baseUrl: again, message: `Forge listo en ${again}` }
      }
      await sleep(2500)
    }
  } finally {
    try {
      off?.()
    } catch {
      /* */
    }
  }

  return {
    ok: false,
    baseUrl: startBase || preferred,
    message:
      'Forge no respondió a tiempo. Ajustes → Capas → Arrancar Forge API y espera Health OK.'
  }
}
