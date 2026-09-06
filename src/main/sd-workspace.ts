/**
 * Local Stable Diffusion workspace under Electron userData.
 * We prepare folders + optional checkpoint download.
 * Forge/A1111 portable is large: we stage a launcher script in the workspace
 * rather than embedding multi‑GB runtimes inside the Electron asar.
 */

import { app, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, writeFile, readdir } from 'fs/promises'
import { resumableDownload } from './resumable-download'
import { ensureMachineProfile, detectForgePresent } from './machine-profile'

export function getSdWorkspaceRoot(): string {
  return join(app.getPath('userData'), 'sd-workspace')
}

export function getSdModelsDir(): string {
  return join(getSdWorkspaceRoot(), 'models', 'Stable-diffusion')
}

export async function ensureSdWorkspace(): Promise<{
  root: string
  modelsDir: string
  created: boolean
}> {
  const root = getSdWorkspaceRoot()
  const modelsDir = getSdModelsDir()
  const created = !existsSync(root)
  await mkdir(modelsDir, { recursive: true })
  await mkdir(join(root, 'outputs'), { recursive: true })

  // Helper scripts for Windows users
  const readme = `KawaiiGPT — workspace Stable Diffusion
=====================================

Esta carpeta la gestiona KawaiiGPT Robust.

1) MODELOS
   Pon checkpoints .safetensors en:
   ${modelsDir}

2) FORGE / A1111 (API)
   Instala Forge portable en una subcarpeta "forge" (ruta corta recomendada).
   Arranca con: --api --api-log
   En KawaiiGPT → Ajustes → URL local: http://127.0.0.1:7860

3) RECOMENDADO
   - GPU < 8 GB VRAM: SD 1.5 (~2 GB)
   - GPU >= 8 GB: SDXL

KawaiiGPT puede descargar un checkpoint de prueba desde el Asistente.
`
  await writeFile(join(root, 'LEEME.txt'), readme, 'utf-8')

  const bat = `@echo off
REM Abre esta carpeta de modelos
explorer "${modelsDir.replace(/\//g, '\\')}"
`
  await writeFile(join(root, 'Abrir-modelos.bat'), bat, 'utf-8')

  return { root, modelsDir, created }
}

export async function listLocalCheckpoints(): Promise<string[]> {
  const dir = getSdModelsDir()
  if (!existsSync(dir)) return []
  const files = await readdir(dir)
  return files.filter((f) => f.endsWith('.safetensors') || f.endsWith('.ckpt'))
}

export async function openSdWorkspace(): Promise<void> {
  const { root } = await ensureSdWorkspace()
  await shell.openPath(root)
}

/**
 * Catalog of downloadable SD 1.5-class checkpoints (Hugging Face public resolves).
 * One checkpoint is active at a time in Forge; “combinar” = cambiar de modelo o usar LoRA (no se mezclan al vuelo como un solo peso).
 */
export type CheckpointStyle = 'general' | 'photo' | 'anime' | 'art'
export type CheckpointSafety = 'safe' | 'flexible'

export type CheckpointCatalogEntry = {
  id: string
  filename: string
  /** Primary download URL */
  url: string
  /** Extra mirrors tried on HTTP 404/403 */
  mirrors?: string[]
  approxGB: number
  label: string
  /** safe ≈ sesgo SFW / base; flexible ≈ comunidad, menos restricción de estilo */
  safety: CheckpointSafety
  styles: CheckpointStyle[]
  notes: string
  /** Short compare blurb for UI */
  bestFor: string
  /** True if model is a known merge / good with LoRAs (community practice) */
  mergeFriendly?: boolean
}

export const CHECKPOINT_CATALOG: CheckpointCatalogEntry[] = [
  {
    id: 'v1-5-pruned-emaonly',
    filename: 'v1-5-pruned-emaonly.safetensors',
    url: 'https://huggingface.co/Comfy-Org/stable-diffusion-v1-5-archive/resolve/main/v1-5-pruned-emaonly.safetensors',
    mirrors: [
      'https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors',
      'https://huggingface.co/Comfy-Org/stable-diffusion-v1-5-archive/resolve/main/v1-5-pruned-emaonly-fp16.safetensors'
    ],
    approxGB: 4,
    label: 'SD 1.5 oficial (base)',
    safety: 'safe',
    styles: ['general'],
    notes: 'Checkpoint base archivado (mismo hash que el histórico Runway). Máxima compatibilidad.',
    bestFor: 'Pruebas, prompts simples, máxima compatibilidad',
    mergeFriendly: true
  },
  {
    id: 'realistic-vision-v51',
    filename: 'Realistic_Vision_V5.1_fp16-no-ema.safetensors',
    url: 'https://huggingface.co/SG161222/Realistic_Vision_V5.1_noVAE/resolve/main/Realistic_Vision_V5.1_fp16-no-ema.safetensors',
    mirrors: [
      'https://huggingface.co/SG161222/Realistic_Vision_V5.1_noVAE/resolve/main/Realistic_Vision_V5.1.safetensors',
      'https://hf-mirror.com/SG161222/Realistic_Vision_V5.1_noVAE/resolve/main/Realistic_Vision_V5.1_fp16-no-ema.safetensors',
      'https://hf-mirror.com/SG161222/Realistic_Vision_V5.1_noVAE/resolve/main/Realistic_Vision_V5.1.safetensors'
    ],
    approxGB: 2,
    label: 'Realistic Vision 5.1 (foto)',
    safety: 'flexible',
    styles: ['photo'],
    notes: 'Fotorrealismo (formato .ckpt aceptado por Forge). Bueno en retratos.',
    bestFor: 'Fotos realistas, retratos',
    mergeFriendly: true
  },
  {
    id: 'dreamshaper-8',
    filename: 'DreamShaper_8_pruned.safetensors',
    url: 'https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors',
    mirrors: [
      'https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8.safetensors',
      'https://hf-mirror.com/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors',
      'https://hf-mirror.com/Lykon/DreamShaper/resolve/main/DreamShaper_8.safetensors'
    ],
    approxGB: 2,
    label: 'DreamShaper 8 (arte/anime)',
    safety: 'flexible',
    styles: ['art', 'anime', 'general'],
    notes: 'Híbrido arte / semi-real / algo de anime.',
    bestFor: 'Arte digital, fantasy, semi-anime',
    mergeFriendly: true
  },
  {
    id: 'counterfeit-v30',
    filename: 'Counterfeit-V3.0_fp16.safetensors',
    url: 'https://huggingface.co/gsdf/Counterfeit-V3.0/resolve/main/Counterfeit-V3.0_fp16.safetensors',
    mirrors: [
      'https://hf-mirror.com/gsdf/Counterfeit-V3.0/resolve/main/Counterfeit-V3.0_fp16.safetensors'
    ],
    approxGB: 2,
    label: 'Counterfeit V3 (anime)',
    safety: 'flexible',
    styles: ['anime'],
    notes: 'Anime nítido y colorido.',
    bestFor: 'Anime detallado',
    mergeFriendly: true
  },
  {
    id: 'deliberate-v2',
    filename: 'Deliberate_v2.safetensors',
    url: 'https://huggingface.co/XpucT/Deliberate/resolve/main/Deliberate_v2.safetensors',
    mirrors: [
      'https://hf-mirror.com/XpucT/Deliberate/resolve/main/Deliberate_v2.safetensors'
    ],
    approxGB: 2,
    label: 'Deliberate v2',
    safety: 'flexible',
    styles: ['art', 'photo', 'general'],
    notes: 'Todoterreno creativo (arte + algo de realismo).',
    bestFor: 'Uso general creativo',
    mergeFriendly: true
  }
]

export const DEFAULT_CHECKPOINT = CHECKPOINT_CATALOG[0]

export function getCheckpointCatalog(): CheckpointCatalogEntry[] {
  return CHECKPOINT_CATALOG
}

export type CheckpointPrefs = {
  style?: CheckpointStyle | 'any'
  safety?: CheckpointSafety | 'any'
}

/** Rank models for the UI “recomendados” row */
export function recommendCheckpoints(prefs: CheckpointPrefs): CheckpointCatalogEntry[] {
  const style = prefs.style || 'any'
  const safety = prefs.safety || 'any'
  const scored = CHECKPOINT_CATALOG.map((m) => {
    let score = 0
    if (style !== 'any' && m.styles.includes(style)) score += 10
    if (style === 'any') score += 2
    if (safety !== 'any' && m.safety === safety) score += 5
    if (safety === 'safe' && m.safety === 'safe') score += 3
    if (m.id === 'v1-5-pruned-emaonly') score += 1 // always ok starter
    return { m, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.map((x) => x.m)
}


/** Active SD download control (pause from UI) */
let activeSdControl: import('./resumable-download').DownloadControl | null = null

export function pauseSdDownload(): { ok: boolean } {
  if (activeSdControl) {
    activeSdControl.pause()
    return { ok: true }
  }
  return { ok: false }
}

export function getActiveSdControl() {
  return activeSdControl
}

export function setActiveSdControl(
  c: import('./resumable-download').DownloadControl | null
) {
  activeSdControl = c
}

/** Incomplete checkpoint downloads in the SD models folder */
export async function listInstalledCheckpoints(): Promise<
  Array<{ id: string; filename: string; path: string; sizeBytes: number }>
> {
  const modelsDir = await resolveSdModelsDir()
  const { readdir, stat } = await import('fs/promises')
  const { existsSync } = await import('fs')
  const out: Array<{ id: string; filename: string; path: string; sizeBytes: number }> = []
  if (!existsSync(modelsDir)) return out
  let names: string[] = []
  try {
    names = await readdir(modelsDir)
  } catch {
    return out
  }
  for (const entry of CHECKPOINT_CATALOG) {
    const loose = names.find(
      (n) =>
        n.toLowerCase() === entry.filename.toLowerCase() ||
        n.toLowerCase().includes(entry.id.replace(/-/g, '').slice(0, 10).toLowerCase())
    )
    const fileName = existsSync(join(modelsDir, entry.filename))
      ? entry.filename
      : loose
    if (!fileName) continue
    const fp = join(modelsDir, fileName)
    try {
      const stt = await stat(fp)
      if (stt.isFile() && stt.size > 50_000_000) {
        out.push({
          id: entry.id,
          filename: fileName,
          path: fp,
          sizeBytes: stt.size
        })
      }
    } catch {
      /* skip */
    }
  }
  return out
}

export async function listSdDownloadRecovery(): Promise<
  Array<{
    id: string
    label: string
    dest: string
    status: string
    received: number
    total: number | null
    pct: number
    updatedAt: string
    error?: string
  }>
> {
  const { listRecoveryJobs } = await import('./resumable-download')
  const modelsDir = await resolveSdModelsDir()
  const jobs = await listRecoveryJobs(modelsDir)
  return jobs
    .filter(
      (j) =>
        j.status === 'downloading' ||
        j.status === 'paused' ||
        j.status === 'failed' ||
        (j.received > 0 && j.status !== 'completed')
    )
    .map((j) => {
      const total = j.total
      const pct =
        total && total > 0
          ? Math.min(99, (j.received / total) * 100)
          : j.received > 0
            ? 5
            : 0
      return {
        id: j.id,
        label: j.label || j.id,
        dest: j.dest,
        status: j.status,
        received: j.received,
        total: j.total,
        pct,
        updatedAt: j.updatedAt,
        error: j.error
      }
    })
}

export async function downloadCheckpoint(
  onProgress?: (pct: number, received: number, total: number | null) => void,
  signal?: AbortSignal,
  onControl?: (ctrl: import('./resumable-download').DownloadControl) => void,
  modelId?: string
): Promise<
  | { ok: true; path: string; id: string }
  | { ok: false; error: string; paused?: boolean; cancelled?: boolean }
> {
  try {
    await ensureSdWorkspace()
    const modelsDir = await resolveSdModelsDir()
    await mkdir(modelsDir, { recursive: true })
    const entry =
      CHECKPOINT_CATALOG.find((c) => c.id === modelId) || DEFAULT_CHECKPOINT
    const dest = join(modelsDir, entry.filename)
    try {
      const { existsSync } = await import('fs')
      const { stat } = await import('fs/promises')
      if (existsSync(dest)) {
        const sz = (await stat(dest)).size
        if (sz > 50_000_000) {
          onProgress?.(100, sz, sz)
          return { ok: true, path: dest, id: entry.id }
        }
      }
    } catch {
      /* continue */
    }
    const { loadDownloadJob } = await import('./resumable-download')
    const prior = await loadDownloadJob(dest)
    const urls = [
      ...(prior?.url ? [prior.url] : []),
      entry.url,
      ...(entry.mirrors || [])
    ].filter((u, i, a) => a.indexOf(u) === i)
    let lastFail: { ok: false; error: string; paused?: boolean; cancelled?: boolean } | null =
      null
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]
      const result = await resumableDownload({
        id: entry.id,
        url,
        dest,
        label: entry.filename,
        signal,
        onControl: (ctrl) => {
          setActiveSdControl(ctrl)
          onControl?.(ctrl)
        },
        maxRetries: i === 0 ? 14 : 8,
        retryBaseMs: 2000,
        onProgress: (received, total) => {
          // When HF omits Content-Length, estimate from known approx size (~GB * 1e9)
          let pct = 0
          if (total && total > 0) {
            pct = Math.min(99, (received / total) * 100)
          } else if (entry.approxGB > 0) {
            const approx = entry.approxGB * 1_000_000_000
            pct = Math.min(95, (received / approx) * 100)
          } else if (received > 0) {
            pct = Math.min(90, 5 + Math.log10(received + 1) * 8)
          }
          onProgress?.(pct, received, total)
        }
      })
      if (result.ok) {
        setActiveSdControl(null)
        onProgress?.(100, 0, 0)
        return { ok: true, path: dest, id: entry.id }
      }
      lastFail = result
      setActiveSdControl(null)
      if (result.paused || result.cancelled) return result
      // Network or HTTP error: keep .partial and try next mirror
      console.warn('[sd-download] fallo', entry.id, url, result.error)
      continue
    }
    return lastFail || { ok: false, error: 'Descarga fallida en todos los mirrors' }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** Prefer machine-profile SD models path when available */
export async function resolveSdModelsDir(): Promise<string> {
  try {
    const { profile } = await ensureMachineProfile({})
    if (profile.sdModelsPath) {
      await mkdir(profile.sdModelsPath, { recursive: true })
      return profile.sdModelsPath
    }
  } catch {
    /* fallback */
  }
  const { modelsDir } = await ensureSdWorkspace()
  return modelsDir
}

/**
 * Copy checkpoints into Forge's models folder so the WebUI sees them.
 * Forge layout: <forgeRoot>/models/Stable-diffusion/*.safetensors
 */
export async function syncCheckpointsToForge(): Promise<{
  ok: boolean
  copied: string[]
  skipped: string[]
  forgeModelsDir: string | null
  error?: string
}> {
  try {
    const { profile } = await ensureMachineProfile({})
    const forgeRoot = profile.forgeInstallPath
    if (!(await detectForgePresent(forgeRoot))) {
      // nested extract
      let resolved = forgeRoot
      if (existsSync(forgeRoot)) {
        const names = await readdir(forgeRoot)
        for (const n of names) {
          const sub = join(forgeRoot, n)
          if (await detectForgePresent(sub)) {
            resolved = sub
            break
          }
        }
      }
      if (!(await detectForgePresent(resolved))) {
        return {
          ok: false,
          copied: [],
          skipped: [],
          forgeModelsDir: null,
          error: 'Forge no instalado todavía.'
        }
      }
      return syncInto(resolved, profile.sdModelsPath)
    }
    return syncInto(forgeRoot, profile.sdModelsPath)
  } catch (err) {
    return {
      ok: false,
      copied: [],
      skipped: [],
      forgeModelsDir: null,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

async function syncInto(
  forgeRoot: string,
  sourceModels: string
): Promise<{
  ok: boolean
  copied: string[]
  skipped: string[]
  forgeModelsDir: string | null
  error?: string
}> {
  const { copyFile } = await import('fs/promises')
  const destDir = join(forgeRoot, 'models', 'Stable-diffusion')
  await mkdir(destDir, { recursive: true })
  const sources: string[] = []
  for (const dir of [sourceModels, getSdModelsDir()]) {
    if (!existsSync(dir)) continue
    try {
      const files = await readdir(dir)
      for (const f of files) {
        if (f.endsWith('.safetensors') || f.endsWith('.ckpt')) {
          sources.push(join(dir, f))
        }
      }
    } catch {
      /* ignore */
    }
  }
  // unique by filename
  const byName = new Map<string, string>()
  for (const p of sources) {
    const name = p.split(/[/\\]/).pop() || p
    if (!byName.has(name)) byName.set(name, p)
  }
  const copied: string[] = []
  const skipped: string[] = []
  for (const [name, src] of byName) {
    const dest = join(destDir, name)
    if (existsSync(dest)) {
      skipped.push(name)
      continue
    }
    try {
      await copyFile(src, dest)
      copied.push(name)
    } catch (e) {
      return {
        ok: false,
        copied,
        skipped,
        forgeModelsDir: destDir,
        error: e instanceof Error ? e.message : String(e)
      }
    }
  }
  return { ok: true, copied, skipped, forgeModelsDir: destDir }
}
