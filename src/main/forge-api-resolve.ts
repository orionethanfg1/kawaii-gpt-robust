/**
 * E1 — Resolve a live Forge / A1111 API base URL for image generation.
 *
 * Contract: status -> scan ports -> start runtime -> probe /sdapi (not Gradio-only).
 * Callers only map progress/errors to UI (lesson from face corrections r2: small modules).
 */

export type ResolveForgeApiOptions = {
  preferredBaseUrl?: string | null
  preferredPort?: number
  /** Attempt startForgeRuntime if nothing answers (default true) */
  startIfMissing?: boolean
  onProgress?: (pct: number, detail: string) => void
}

export type ResolveForgeApiResult = {
  ok: boolean
  baseUrl: string | null
  message: string
  started: boolean
}

function norm(url: string): string {
  return String(url || '').replace(/\/$/, '')
}

export async function resolveForgeApiForGeneration(
  opts: ResolveForgeApiOptions = {}
): Promise<ResolveForgeApiResult> {
  const onProgress = opts.onProgress || (() => {})
  const startIfMissing = opts.startIfMissing !== false
  let started = false

  const {
    getForgeRuntimeStatus,
    scanForgeApiPorts,
    refreshForgeHealth,
    startForgeRuntime,
    probeForgeHealth
  } = await import('./forge-runtime')

  let root: string | null = null
  const preferred = (opts.preferredBaseUrl || '').trim()
  if (preferred) root = norm(preferred)

  try {
    const st = getForgeRuntimeStatus()
    if (st.baseUrl && st.apiOk) {
      root = norm(st.baseUrl)
      onProgress(8, 'Forge ya en runtime: ' + root)
    }
  } catch {
    /* optional */
  }

  if (!root) {
    onProgress(8, 'Buscando API Forge en puertos...')
    try {
      const scan = await scanForgeApiPorts()
      if (scan.ok && scan.baseUrl) root = norm(scan.baseUrl)
    } catch {
      /* */
    }
  }

  if (!root && startIfMissing) {
    onProgress(10, 'Intentando arrancar Forge...')
    try {
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        baseUrl: null,
        message: 'No se pudo arrancar Forge: ' + msg.slice(0, 180),
        started
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

  let h = await probeForgeHealth(root, 5000)
  if (!h.ok) {
    const scan = await scanForgeApiPorts()
    if (scan.ok && scan.baseUrl) {
      root = norm(scan.baseUrl)
      h = await probeForgeHealth(root, 4000)
    }
  }

  if (!h.ok) {
    return {
      ok: false,
      baseUrl: root,
      message:
        h.error ||
        'No hay API Forge (--api). Cierra la ventana de Forge abierta a mano y usa Arrancar Forge en la app.',
      started
    }
  }

  root = norm(h.baseUrl || root)
  return {
    ok: true,
    baseUrl: root,
    message: 'Forge API lista en ' + root,
    started
  }
}
