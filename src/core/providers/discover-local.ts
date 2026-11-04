import { localHttp } from './local-http'
import { discoverLmStudioServer } from './lmstudio-ports'
export type LocalModelSource =
  | 'ollama'
  | 'openai-compatible'
  | 'ollama-disk'
  | 'lmstudio-disk'

export type LocalModelEntry = {
  id: string
  name: string
  source: LocalModelSource
  sizeHint?: string
  recommended?: boolean
  /** Present for openai-compatible live entries when known */
  baseUrl?: string
  paramsB?: number
  /** C2: disk-only weight (no live API id for this row) */
  diskOnly?: boolean
  /** C2: Auto router may select this id (false for solo-disco without map) */
  autoEligible?: boolean
  /** C4: LMS state when known */
  loadState?: string
}

export type LocalModelsSnapshot = {
  models: LocalModelEntry[]
  ollama: boolean
  openAI: null | { baseUrl: string; label: string }
  recommended?: LocalModelEntry
  /** Models found only on disk (server may be offline) */
  diskCount?: number
  /** LM Studio server probe (dynamic port) */
  lmStudio?: {
    ok: boolean
    port?: number
    baseUrl?: string
    message: string
  }
}

export type DiskModelHit = {
  id: string
  name: string
  source: 'ollama-disk' | 'lmstudio-disk'
  path?: string
  sizeBytes?: number
}

function scoreModel(id: string, ram: number): number {
  const x = id.toLowerCase()
  let s = 0
  if (/instruct|chat/.test(x)) s += 2
  if (ram < 16 && /(3b|3b-|1\.5b|1b)/.test(x)) s += 3
  if (ram >= 16 && ram < 32 && /(7b|8b|9b)/.test(x)) s += 3
  if (ram >= 32 && /(14b|13b|12b)/.test(x)) s += 3
  if (/embed|whisper|llava|vision/.test(x)) s -= 5
  // Prefer live over disk-only of the same family
  if (!x.includes('(disco)') && !x.includes('disk')) s += 1
  return s
}

function sortAndRecommend(models: LocalModelEntry[], ram: number): LocalModelEntry | undefined {
  models.sort((a, b) => scoreModel(b.id, ram) - scoreModel(a.id, ram))
  const recommended = models[0]
  if (recommended) recommended.recommended = true
  return recommended
}

/**
 * Live discovery: Ollama /api/tags + LM Studio /v1/models and /api/v0/models.
 * Does not touch the filesystem (safe in pure renderer without IPC).
 */
export async function discoverLocalModels(opts: {
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
  ramGB?: number
}): Promise<LocalModelsSnapshot> {
  const models: LocalModelEntry[] = []
  let ollama = false
  let openAI: LocalModelsSnapshot['openAI'] = null
  const ollamaBase = (opts.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')

  try {
    const res = await localHttp(`${ollamaBase}/api/tags`, { timeoutMs: 4_000 })
    if (res.ok) {
      ollama = true
      const json = (await res.json()) as {
        models?: Array<{ name?: string; model?: string; size?: number }>
      }
      for (const m of json.models || []) {
        const id = m.name || m.model || ''
        if (!id) continue
        models.push({
          id,
          name: id,
          source: 'ollama',
          sizeHint: m.size ? `${(m.size / 1e9).toFixed(1)} GB` : undefined
        })
      }
    }
  } catch {
    /* offline */
  }

  // Dynamic LM Studio port discovery (not hardcoded 1234)
  const lmProbe = await discoverLmStudioServer({
    preferredBaseUrl: opts.openAIBaseUrl,
    timeoutMs: 2_000,
    force: true
  })
  let lmStudioStatus: LocalModelsSnapshot['lmStudio'] = {
    ok: lmProbe.ok,
    port: lmProbe.port,
    baseUrl: lmProbe.baseUrl,
    message: lmProbe.message
  }

  if (lmProbe.ok && lmProbe.baseUrl) {
    const baseV1 = lmProbe.baseUrl.replace(/\/+$/, '')
    const root = baseV1.replace(/\/v1$/i, '')
    openAI = { baseUrl: baseV1, label: 'LM Studio / OpenAI-compatible' }
    try {
      const res = await localHttp(`${baseV1}/models`, { timeoutMs: 3_000 })
      if (res.ok) {
        const json = (await res.json()) as { data?: Array<{ id?: string }> }
        for (const m of json.data || []) {
          const id = m.id || ''
          if (!id) continue
          if (models.some((x) => x.id === id)) continue
          models.push({
            id,
            name: id,
            source: 'openai-compatible',
            baseUrl: baseV1
          })
        }
      }
    } catch {
      /* */
    }
    try {
      const res1 = await localHttp(`${root}/api/v1/models`, {
        timeoutMs: 3_500,
        headers: { Authorization: 'Bearer lm-studio' }
      })
      if (res1.ok) {
        const json1 = (await res1.json()) as {
          models?: Array<{ key?: string; id?: string; display_name?: string }>
        }
        for (const m of json1.models || []) {
          const id = m.key || m.id || ''
          if (!id || models.some((x) => x.id === id)) continue
          models.push({
            id,
            name: m.display_name || id,
            source: 'openai-compatible',
            baseUrl: baseV1
          })
        }
      }
    } catch {
      /* */
    }
    try {
      const res0 = await localHttp(`${root}/api/v0/models`, { timeoutMs: 3_000 })
      if (res0.ok) {
        const json0 = (await res0.json()) as {
          data?: Array<{ id?: string; state?: string }>
        }
        for (const m of json0.data || []) {
          const id = m.id || ''
          if (!id) continue
          if (models.some((x) => x.id === id)) continue
          models.push({
            id,
            name: id + (m.state === 'not-loaded' ? ' (descargado)' : ''),
            source: 'openai-compatible',
            baseUrl: baseV1
          })
        }
      }
    } catch {
      /* */
    }
  }

  const ram = opts.ramGB ?? 16
  const recommended = sortAndRecommend(models, ram)
  return { models, ollama, openAI, recommended, diskCount: 0, lmStudio: lmStudioStatus }
}

/**
 * Fingerprint so API id and disk filename map to the same logical model.
 * Order matters: strip quant / publisher / format BEFORE removing separators,
 * otherwise `…-Q6_K_L` never matches `…abliterated` (bug: duplicate rows in UI).
 *
 * Examples that must collide:
 * - mlabonne_qwen3-14b-abliterated
 * - mlabonne_Qwen3-14B-abliterated-Q6_K_L
 * - bartowski/mlabonne_Qwen3-14B-abliterated-GGUF
 */
export function modelFingerprint(id: string): string {
  let s = String(id || '').toLowerCase().replace(/\\/g, '/')
  // last path segment only (publisher/repo noise)
  const slash = s.lastIndexOf('/')
  if (slash >= 0) s = s.slice(slash + 1)
  s = s
    .replace(/\.gguf$/i, '')
    .replace(/-gguf$/i, '')
    // quant & precision tokens (with separators still present)
    .replace(
      /[-_]?q[2-8]([._-]?k([._-]?[msl])?)?[-_]?/gi,
      ''
    )
    .replace(/[-_]?(iq[1-4][_-]?xs|f16|fp16|bf16|gguf)[-_]?/gi, '')
    .replace(/[-_]?(instruct|chat)[-_]?/gi, '')
    // normalize abliterated variants
    .replace(/abliterated/g, 'ablit')
    .replace(/uncensored/g, 'uncen')
    // drop remaining separators
    .replace(/[_.\s-]+/g, '')
    .replace(/[^a-z0-9]/g, '')
  return s
}

/**
 * Merge disk hits (from main-process scan) into a live snapshot.
 * Live (API) entries win; disk-only models are appended.
 * Same fingerprint as a live row → attach sizeHint, do not duplicate.
 */
export function mergeDiskIntoSnapshot(
  snap: LocalModelsSnapshot,
  disk: DiskModelHit[] | undefined | null,
  ramGB?: number
): LocalModelsSnapshot {
  if (!disk?.length) {
    const models = enrichCatalogForAuto([...(snap.models || [])])
    const recommended = sortAndRecommend(models, ramGB ?? 16)
    return { ...snap, models, recommended, diskCount: 0 }
  }
  const models = [...snap.models]
  const seenExact = new Set(models.map((m) => m.id.toLowerCase()))
  const liveByFp = new Map<string, LocalModelEntry>()
  for (const m of models) {
    const fp = modelFingerprint(m.id)
    if (fp.length >= 6 && !liveByFp.has(fp)) liveByFp.set(fp, m)
  }
  let added = 0
  for (const d of disk) {
    const id = (d.id || d.name || '').trim()
    if (!id) continue
    const key = id.toLowerCase()
    if (seenExact.has(key)) {
      // Enrich size on exact match
      const hit = models.find((m) => m.id.toLowerCase() === key)
      if (hit && !hit.sizeHint && d.sizeBytes) {
        hit.sizeHint = `${(d.sizeBytes / 1e9).toFixed(1)} GB`
      }
      continue
    }
    const fp = modelFingerprint(id)
    const live = fp.length >= 6 ? liveByFp.get(fp) : undefined
    if (live) {
      // Same weights already listed via LM Studio / Ollama API — only fill size
      if (!live.sizeHint && d.sizeBytes) {
        live.sizeHint = `${(d.sizeBytes / 1e9).toFixed(1)} GB`
      }
      if (live.name === live.id && d.name) live.name = d.name
      seenExact.add(key)
      continue
    }
    seenExact.add(key)
    if (fp.length >= 6) liveByFp.set(fp, { id, name: d.name || id, source: d.source })
    const sizeHint =
      typeof d.sizeBytes === 'number' && d.sizeBytes > 0
        ? `${(d.sizeBytes / 1e9).toFixed(1)} GB`
        : undefined
    models.push({
      id,
      name: d.name || id,
      source: d.source,
      sizeHint
    })
    added++
  }
  const ram = ramGB ?? 16
  for (const m of models) m.recommended = false
  const flagged = enrichCatalogForAuto(models)
  const recommended = sortAndRecommend(flagged, ram)
  return {
    ...snap,
    models: flagged,
    recommended,
    diskCount: added,
    lmStudio: snap.lmStudio
  }
}

/** C1/C2 — flag disk-only rows; live wins for Auto eligibility. */
export function enrichCatalogForAuto(models: LocalModelEntry[]): LocalModelEntry[] {
  const liveFps = new Set<string>()
  for (const m of models) {
    if (m.source === 'ollama' || m.source === 'openai-compatible') {
      const fp = modelFingerprint(m.id)
      if (fp.length >= 6) liveFps.add(fp)
    }
  }
  return models.map((m) => {
    const disk = m.source === 'ollama-disk' || m.source === 'lmstudio-disk'
    const fp = modelFingerprint(m.id)
    if (disk) {
      // If a live sibling exists, merge should have dropped this; still mark ineligible
      const hasLive = fp.length >= 6 && liveFps.has(fp)
      return {
        ...m,
        diskOnly: true,
        autoEligible: false,
        name: hasLive ? m.name : m.name
      }
    }
    return { ...m, diskOnly: false, autoEligible: m.autoEligible !== false }
  })
}

/**
 * C1 — UI list: one row per fingerprint; prefer live over disk.
 */
export function dedupeCatalogByFingerprint(models: LocalModelEntry[]): LocalModelEntry[] {
  const byFp = new Map<string, LocalModelEntry>()
  const noFp: LocalModelEntry[] = []
  for (const m of models) {
    const fp = modelFingerprint(m.id)
    if (fp.length < 6) {
      noFp.push(m)
      continue
    }
    const prev = byFp.get(fp)
    if (!prev) {
      byFp.set(fp, m)
      continue
    }
    const prevDisk = prev.source === 'ollama-disk' || prev.source === 'lmstudio-disk'
    const curDisk = m.source === 'ollama-disk' || m.source === 'lmstudio-disk'
    // Prefer live
    if (prevDisk && !curDisk) {
      byFp.set(fp, {
        ...m,
        sizeHint: m.sizeHint || prev.sizeHint,
        diskOnly: false,
        autoEligible: true
      })
    } else if (!prevDisk && curDisk) {
      byFp.set(fp, {
        ...prev,
        sizeHint: prev.sizeHint || m.sizeHint
      })
    } else {
      // same class: keep first, merge size
      byFp.set(fp, {
        ...prev,
        sizeHint: prev.sizeHint || m.sizeHint
      })
    }
  }
  return [...byFp.values(), ...noFp]
}

/**
 * Full discovery for the renderer: live APIs + disk scan via IPC.
 * Safe no-op disk part if window.kawaii is unavailable.
 */
export async function discoverLocalModelsFull(opts: {
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
  ramGB?: number
}): Promise<LocalModelsSnapshot> {
  // Prefer main-process discovery (no CORS) when IPC is available
  let live: LocalModelsSnapshot
  try {
    if (typeof window !== 'undefined' && window.kawaii?.discoverLocalModelsLive) {
      const snap = await window.kawaii.discoverLocalModelsLive(opts)
      live = {
        models: (snap.models || []).map((m) => ({
          id: m.id,
          name: m.name,
          source: m.source as LocalModelSource,
          sizeHint: m.sizeHint,
          recommended: m.recommended,
          baseUrl: m.baseUrl,
          paramsB: m.paramsB
        })),
        ollama: Boolean(snap.ollama),
        openAI: snap.openAI,
        recommended: snap.recommended
          ? {
              id: snap.recommended.id,
              name: snap.recommended.name,
              source: snap.recommended.source as LocalModelSource
            }
          : undefined,
        diskCount: 0,
        lmStudio: (snap as { lmStudio?: LocalModelsSnapshot['lmStudio'] }).lmStudio
      }
    } else {
      live = await discoverLocalModels(opts)
    }
  } catch {
    live = await discoverLocalModels(opts)
  }
  let disk: DiskModelHit[] = []
  try {
    if (typeof window !== 'undefined' && window.kawaii?.scanLocalModels) {
      const res = await window.kawaii.scanLocalModels()
      if (res?.ok && Array.isArray(res.models)) {
        disk = res.models.map((m) => ({
          id: m.id,
          name: m.name,
          source: m.source,
          path: m.path,
          sizeBytes: m.sizeBytes
        }))
      }
    }
  } catch {
    /* offline / no IPC */
  }
  return mergeDiskIntoSnapshot(live, disk, opts.ramGB)
}
