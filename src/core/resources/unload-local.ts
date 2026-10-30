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

function sameOllamaName(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/:latest$/, '')
  const nb = b.toLowerCase().replace(/:latest$/, '')
  return na === nb || na.includes(nb) || nb.includes(na)
}

function isOllamaVisionName(id: string): boolean {
  return /moondream|llava|bakllava|minicpm-v|\bvision\b/i.test(id)
}

/**
 * Keep only `keepModel` resident in Ollama VRAM.
 * Unloads other chat models and vision auxiliaries (moondream) before a turn.
 */
export async function ensureOllamaSingleResident(
  keepModel: string,
  baseUrl = 'http://127.0.0.1:11434'
): Promise<{ ok: boolean; unloaded: string[]; detail: string }> {
  const keep = (keepModel || '').trim()
  if (!keep) return { ok: false, unloaded: [], detail: 'sin modelo' }
  const loaded = await listOllamaLoaded(baseUrl)
  if (!loaded.length) {
    return { ok: true, unloaded: [], detail: 'ningún residente previo' }
  }
  const unloaded: string[] = []
  const keepIsVision = isOllamaVisionName(keep)
  for (const m of loaded) {
    const name = m.name
    if (sameOllamaName(name, keep)) continue
    // Drop other chat models always; drop vision when keep is text LLM
    if (isOllamaVisionName(name) && keepIsVision) continue
    const r = await unloadOllamaModel(name, baseUrl)
    if (r.ok) unloaded.push(name)
  }
  return {
    ok: true,
    unloaded,
    detail: unloaded.length
      ? `Ollama liberó: ${unloaded.join(', ')} → keep «${keep}»`
      : `Ollama ya alineado con «${keep}»`
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


/**
 * Keep only `keepModel` resident in Ollama; unload every other loaded model.
 * Call when Auto switches model so two chat models never sit in VRAM at once.
 * LM Studio: no stable public unload API — detail notes user must eject in UI.
 */
export async function unloadAllExcept(
  keepModel: string,
  opts?: { ollamaBaseUrl?: string; openAIBaseUrl?: string }
): Promise<UnloadResult> {
  const base = opts?.ollamaBaseUrl || 'http://127.0.0.1:11434'
  const keep = (keepModel || '').trim()
  const loaded = await listOllamaLoaded(base)
  const unloaded: string[] = []
  const failed: Array<{ model: string; error: string }> = []
  const skipped: string[] = []
  let freed = 0

  if (!keep) {
    return {
      ok: true,
      unloaded: [],
      failed: [],
      skipped: loaded.map((m) => m.name),
      freedEstimateGB: 0,
      detail: 'Sin modelo keep — no se descarga nada'
    }
  }

  const matchesKeep = (name: string) => {
    const a = name.toLowerCase()
    const b = keep.toLowerCase()
    return (
      a === b ||
      a.includes(b) ||
      b.includes(a) ||
      a.split(':')[0] === b.split(':')[0] ||
      a.replace(/[^a-z0-9]/g, '').includes(b.replace(/[^a-z0-9]/g, '').slice(0, 16))
    )
  }

  // If keep looks like LM Studio / openai id and nothing in Ollama matches, do NOT
  // unload all Ollama residents (would leave the user with zero models by accident).
  if (loaded.length && !loaded.some((m) => matchesKeep(m.name))) {
    return {
      ok: true,
      unloaded: [],
      failed: [],
      skipped: loaded.map((m) => m.name + ' (keep no está en Ollama)'),
      freedEstimateGB: 0,
      detail:
        'Keep «' +
        keep +
        '» no coincide con modelos Ollama cargados; no se descargó nada. En LM Studio expulsa el modelo anterior a mano si hace falta.'
    }
  }

  for (const m of loaded) {
    if (matchesKeep(m.name)) {
      skipped.push(m.name + ' (keep)')
      continue
    }
    const est =
      m.sizeVram && m.sizeVram > 0
        ? m.sizeVram / (1024 ** 3)
        : estimateModelWeightGB(m.name)
    const r = await unloadOllamaModel(m.name, base)
    if (r.ok) {
      unloaded.push(m.name)
      freed += est
    } else {
      failed.push({ model: m.name, error: r.error || 'fail' })
    }
  }

  if (unloaded.length) {
    await new Promise((r) => setTimeout(r, 400))
  }

  let detail = ''
  if (unloaded.length) {
    detail = `Memoria: solo «${keep || '—'}»; liberados ${unloaded.join(', ')}`
  } else if (!loaded.length) {
    detail =
      'Ollama sin modelos residentes. Si usas LM Studio, expulsa manualmente el modelo anterior en su UI (no hay API de unload estable).'
  } else {
    detail = `Sin cambios de memoria Ollama (keep=${keep || '—'}; loaded=${loaded.map((m) => m.name).join(',')})`
  }

  return {
    ok: failed.length === 0 || unloaded.length > 0,
    unloaded,
    failed,
    skipped,
    freedEstimateGB: Math.round(freed * 10) / 10,
    detail
  }
}
