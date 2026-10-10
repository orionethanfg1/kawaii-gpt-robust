/**
 * Free local LLM VRAM/RAM before heavy layers (Forge / SD).
 * Ollama: POST /api/generate { model, keep_alive: 0 } for each loaded model (/api/ps).
 * LM Studio: best-effort (no public unload API) — report only.
 */

import { estimateModelWeightGB, isLargeLocalModel } from './governor'

export type UnloadResult = {
  ok: boolean
  unloaded: string[]
  failed: Array<{ model: string; error: string }>
  skipped: string[]
  freedEstimateGB: number
  detail: string
}

export type LoadedOllamaModel = {
  name: string
  sizeVram?: number
  size?: number
}

/** List models currently resident in Ollama */
export async function listOllamaLoaded(
  baseUrl = 'http://127.0.0.1:11434'
): Promise<LoadedOllamaModel[]> {
  const root = baseUrl.replace(/\/+$/, '')
  try {
    const res = await fetch(`${root}/api/ps`, { signal: AbortSignal.timeout(4_000) })
    if (!res.ok) return []
    const json = (await res.json()) as {
      models?: Array<{ name?: string; model?: string; size_vram?: number; size?: number }>
    }
    return (json.models || [])
      .map((m) => ({
        name: (m.name || m.model || '').trim(),
        sizeVram: m.size_vram,
        size: m.size
      }))
      .filter((m) => m.name)
  } catch {
    return []
  }
}

/** Unload one Ollama model immediately (keep_alive: 0) */
export async function unloadOllamaModel(
  model: string,
  baseUrl = 'http://127.0.0.1:11434'
): Promise<{ ok: boolean; error?: string }> {
  const root = baseUrl.replace(/\/+$/, '')
  const name = model.trim()
  if (!name) return { ok: false, error: 'empty model' }
  try {
    const res = await fetch(`${root}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, keep_alive: 0 }),
      signal: AbortSignal.timeout(30_000)
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: t.slice(0, 120) || `HTTP ${res.status}` }
    }
    // Response may stream; drain briefly
    try {
      await res.text()
    } catch {
      /* ignore */
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Unload all (or large-only) Ollama-resident models to free VRAM for Forge.
 */
export async function unloadLocalModelsForForge(opts?: {
  ollamaBaseUrl?: string
  /** Only unload models estimated ≥ this GB (default 6) */
  minSizeGB?: number
  /** Unload everything resident, not only large */
  unloadAll?: boolean
  /** Optional preferred model id — always unload if resident and large */
  preferUnload?: string
}): Promise<UnloadResult> {
  const base = opts?.ollamaBaseUrl || 'http://127.0.0.1:11434'
  const minGB = opts?.minSizeGB ?? 6
  const loaded = await listOllamaLoaded(base)
  if (!loaded.length) {
    return {
      ok: true,
      unloaded: [],
      failed: [],
      skipped: [],
      freedEstimateGB: 0,
      detail: 'Ningún modelo Ollama residente en VRAM/RAM'
    }
  }

  const unloaded: string[] = []
  const failed: Array<{ model: string; error: string }> = []
  const skipped: string[] = []
  let freed = 0

  for (const m of loaded) {
    const est =
      m.sizeVram && m.sizeVram > 0
        ? m.sizeVram / (1024 ** 3)
        : estimateModelWeightGB(m.name)
    const force =
      opts?.preferUnload &&
      (m.name === opts.preferUnload ||
        m.name.includes(opts.preferUnload) ||
        opts.preferUnload.includes(m.name.split(':')[0]))
    const should =
      opts?.unloadAll ||
      force ||
      isLargeLocalModel(m.name) ||
      est >= minGB

    if (!should) {
      skipped.push(`${m.name} (~${est.toFixed(1)}GB)`)
      continue
    }
    const r = await unloadOllamaModel(m.name, base)
    if (r.ok) {
      unloaded.push(m.name)
      freed += est
    } else {
      failed.push({ model: m.name, error: r.error || 'fail' })
    }
  }

  // Brief settle so GPU driver releases pages before Forge CUDA init
  if (unloaded.length) {
    await new Promise((r) => setTimeout(r, 600))
  }

  const ok = failed.length === 0 || unloaded.length > 0
  return {
    ok,
    unloaded,
    failed,
    skipped,
    freedEstimateGB: Math.round(freed * 10) / 10,
    detail: unloaded.length
      ? `Descargados de memoria: ${unloaded.join(', ')} (~${freed.toFixed(1)} GB estimados)`
      : failed.length
        ? `No se pudo liberar: ${failed.map((f) => f.model).join(', ')}`
        : `Sin unload (saltar: ${skipped.join(', ') || 'ninguno'})`
  }
}
