/**
 * Scan disk for Ollama + LM Studio models even when servers are down.
 * Windows / macOS / Linux home-dir conventions.
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { homedir } from 'node:os'

export type DiskModelHit = {
  id: string
  name: string
  source: 'ollama-disk' | 'lmstudio-disk'
  path?: string
  sizeBytes?: number
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function fileSize(p: string): number | undefined {
  try {
    return statSync(p).size
  } catch {
    return undefined
  }
}

/** Ollama library manifests → tags like qwen2.5:14b */
function scanOllamaManifests(home: string): DiskModelHit[] {
  const roots = [
    join(home, '.ollama', 'models', 'manifests'),
    process.env.OLLAMA_MODELS
      ? join(process.env.OLLAMA_MODELS, 'manifests')
      : ''
  ].filter(Boolean)

  const hits: DiskModelHit[] = []
  const seen = new Set<string>()

  for (const root of roots) {
    if (!root || !existsSync(root)) continue
    // registry.ollama.ai/library/<model>/<tag>
    const walk = (dir: string, depth: number) => {
      if (depth > 8) return
      for (const name of safeReaddir(dir)) {
        const full = join(dir, name)
        if (!isDir(full)) {
          // file manifest at .../library/model/tag
          const parts = full.replace(/\\/g, '/').split('/')
          const libIdx = parts.lastIndexOf('library')
          if (libIdx >= 0 && parts.length >= libIdx + 3) {
            const model = parts[libIdx + 1]
            const tag = parts[libIdx + 2]
            if (model && tag && !tag.includes('.')) {
              const id = `${model}:${tag}`
              if (!seen.has(id)) {
                seen.add(id)
                hits.push({ id, name: id, source: 'ollama-disk', path: full })
              }
            }
          }
          continue
        }
        walk(full, depth + 1)
      }
    }
    walk(root, 0)
  }
  return hits
}

/** LM Studio GGUF tree under common defaults */
function scanLmStudio(home: string): DiskModelHit[] {
  const roots = [
    join(home, '.cache', 'lm-studio', 'models'),
    join(home, '.lmstudio', 'models'),
    join(home, '.cache', 'lm-studio', 'hub'),
    join(home, '.cache', 'lmstudio', 'models'),
    // Windows default downloads under user profile
    join(home, 'Documents', 'LM Studio', 'models'),
    join(home, 'LM Studio', 'models'),
    process.env.LM_STUDIO_MODELS || '',
    process.env.LMS_MODELS || ''
  ].filter(Boolean)

  // Try read models path from LM Studio config
  const configCandidates = [
    join(home, 'AppData', 'Roaming', 'LM Studio', 'config.json'),
    join(home, 'AppData', 'Roaming', 'lm-studio', 'config.json'),
    join(home, 'AppData', 'Local', 'lm-studio', 'config.json'),
    join(home, 'AppData', 'Local', 'LM Studio', 'config.json'),
    join(home, '.config', 'LMStudio', 'config.json'),
    join(home, '.config', 'lm-studio', 'config.json'),
    join(home, 'Library', 'Application Support', 'LM Studio', 'config.json')
  ]
  for (const cfg of configCandidates) {
    try {
      if (!existsSync(cfg)) continue
      const j = JSON.parse(readFileSync(cfg, 'utf8')) as Record<string, unknown>
      const dir =
        (typeof j.modelsDir === 'string' && j.modelsDir) ||
        (typeof j.models_dir === 'string' && j.models_dir) ||
        (typeof (j as { paths?: { models?: string } }).paths?.models === 'string'
          ? (j as { paths: { models: string } }).paths.models
          : '')
      if (dir) roots.push(dir)
    } catch {
      /* ignore */
    }
  }

  const hits: DiskModelHit[] = []
  const seen = new Set<string>()

  const walkGguf = (dir: string, depth: number) => {
    if (depth > 6) return
    for (const name of safeReaddir(dir)) {
      const full = join(dir, name)
      if (isDir(full)) {
        walkGguf(full, depth + 1)
        continue
      }
      if (!/\.gguf$/i.test(name)) continue
      const base = basename(name, '.gguf')
      // Prefer parent folder as model family id when nested publisher/model/file.gguf
      const parent = basename(dirname(full))
      const id =
        parent && parent !== 'models' && !/\.gguf$/i.test(parent)
          ? `${parent}/${base}`
          : base
      if (seen.has(id)) continue
      seen.add(id)
      hits.push({
        id,
        name: base,
        source: 'lmstudio-disk',
        path: full,
        sizeBytes: fileSize(full)
      })
    }
  }

  for (const root of roots) {
    if (!root || !existsSync(root)) continue
    walkGguf(root, 0)
  }
  return hits
}

export function scanLocalModelsOnDisk(): {
  models: DiskModelHit[]
  ollamaHome: string
  scannedRoots: string[]
} {
  const home = homedir()
  const ollama = scanOllamaManifests(home)
  const lms = scanLmStudio(home)
  const scannedRoots = [
    join(home, '.ollama', 'models'),
    join(home, '.cache', 'lm-studio', 'models'),
    join(home, '.lmstudio', 'models')
  ]
  return {
    models: [...ollama, ...lms],
    ollamaHome: join(home, '.ollama'),
    scannedRoots
  }
}

/** Prefer dir that exists; honor OLLAMA_MODELS. */
export function resolveOllamaModelsDir(): {
  path: string
  exists: boolean
  note: string
} {
  const home = homedir()
  const candidates = [
    process.env.OLLAMA_MODELS || '',
    join(home, '.ollama', 'models'),
    // Windows sometimes keeps blobs under LocalAppData
    join(home, 'AppData', 'Local', 'Ollama', 'models'),
  ].filter(Boolean)
  for (const p of candidates) {
    if (existsSync(p)) {
      return {
        path: p,
        exists: true,
        note: p === process.env.OLLAMA_MODELS ? 'OLLAMA_MODELS' : 'default ~/.ollama/models'
      }
    }
  }
  const fallback = join(home, '.ollama', 'models')
  return {
    path: fallback,
    exists: false,
    note: 'Ollama no tiene carpeta de modelos aún (¿instalado / primer pull?)'
  }
}

export function resolveOllamaHomeDir(): { path: string; exists: boolean } {
  const home = homedir()
  const p = join(home, '.ollama')
  return { path: p, exists: existsSync(p) }
}

/** Best LM Studio models root (config first, then common defaults that exist). */
export function resolveLmStudioModelsDir(): {
  path: string
  exists: boolean
  note: string
} {
  const home = homedir()
  const configCandidates = [
    join(home, 'AppData', 'Roaming', 'LM Studio', 'config.json'),
    join(home, 'AppData', 'Roaming', 'lm-studio', 'config.json'),
    join(home, 'AppData', 'Local', 'lm-studio', 'config.json'),
    join(home, 'AppData', 'Local', 'LM Studio', 'config.json'),
    join(home, '.config', 'LMStudio', 'config.json'),
    join(home, '.config', 'lm-studio', 'config.json'),
    join(home, 'Library', 'Application Support', 'LM Studio', 'config.json')
  ]
  for (const cfg of configCandidates) {
    try {
      if (!existsSync(cfg)) continue
      const j = JSON.parse(readFileSync(cfg, 'utf8')) as Record<string, unknown>
      const dir =
        (typeof j.modelsDir === 'string' && j.modelsDir) ||
        (typeof j.models_dir === 'string' && j.models_dir) ||
        (typeof (j as { paths?: { models?: string } }).paths?.models === 'string'
          ? (j as { paths: { models: string } }).paths.models
          : '')
      if (dir && existsSync(dir)) {
        return { path: dir, exists: true, note: 'config LM Studio' }
      }
      if (dir) {
        return { path: dir, exists: false, note: 'config LM Studio (carpeta aún no creada)' }
      }
    } catch {
      /* ignore */
    }
  }
  const roots = [
    process.env.LM_STUDIO_MODELS || '',
    process.env.LMS_MODELS || '',
    join(home, '.cache', 'lm-studio', 'models'),
    join(home, '.lmstudio', 'models'),
    join(home, '.cache', 'lm-studio', 'hub'),
    join(home, 'Documents', 'LM Studio', 'models'),
    join(home, 'LM Studio', 'models')
  ].filter(Boolean)
  for (const p of roots) {
    if (existsSync(p)) return { path: p, exists: true, note: 'ruta común' }
  }
  const fallback = join(home, '.cache', 'lm-studio', 'models')
  return {
    path: fallback,
    exists: false,
    note: 'LM Studio no detectado en disco (abre LM Studio una vez o descarga un modelo ahí)'
  }
}

export type ModelLayerPathInfo = {
  layer: 'ollama' | 'lmstudio' | 'forge' | 'music'
  path: string
  exists: boolean
  note: string
  /** true when software/workspace exists but feature not fully installed */
  pendingSetup?: boolean
}

export async function resolveAllModelLayerPaths(): Promise<ModelLayerPathInfo[]> {
  const out: ModelLayerPathInfo[] = []
  const o = resolveOllamaModelsDir()
  out.push({ layer: 'ollama', path: o.path, exists: o.exists, note: o.note })
  const l = resolveLmStudioModelsDir()
  out.push({ layer: 'lmstudio', path: l.path, exists: l.exists, note: l.note })
  try {
    const { resolveBestSdModelsOpenPath } = await import('./sd-workspace')
    const f = await resolveBestSdModelsOpenPath()
    out.push({
      layer: 'forge',
      path: f.path,
      exists: f.fileCount > 0 || existsSync(f.path),
      note:
        f.fileCount > 0
          ? `Forge/SD · ${f.fileCount} checkpoint(s) · ${f.kind}`
          : f.kind === 'workspace'
            ? 'Workspace app vacío — los pesos suelen estar en la instalación de Forge'
            : 'Carpeta Forge sin .safetensors aún'
    })
  } catch (e) {
    out.push({
      layer: 'forge',
      path: '',
      exists: false,
      note: e instanceof Error ? e.message : String(e)
    })
  }
  try {
    const { ensureMusicWorkspace, detectAcePresent } = await import('./music-workspace')
    // detectAcePresent may not be exported — inline
    const ws = await ensureMusicWorkspace()
    const aceDir = ws.aceDir
    const aceOk =
      existsSync(join(aceDir, 'pyproject.toml')) ||
      existsSync(join(aceDir, 'README.md')) ||
      existsSync(join(aceDir, '.installed'))
    out.push({
      layer: 'music',
      path: ws.musicRoot,
      exists: existsSync(ws.musicRoot),
      pendingSetup: !aceOk,
      note: aceOk
        ? 'Workspace música + ACE detectado'
        : 'Workspace música listo; ACE aún no instalado (Capas → Música o di «instala ACE»)'
    })
  } catch (e) {
    out.push({
      layer: 'music',
      path: '',
      exists: false,
      pendingSetup: true,
      note: e instanceof Error ? e.message : String(e)
    })
  }
  return out
}

export async function openModelLayerFolder(
  layer: 'ollama' | 'lmstudio' | 'forge' | 'music'
): Promise<{ ok: boolean; path?: string; note?: string; error?: string }> {
  const { shell } = await import('electron')
  if (layer === 'forge') {
    const { openSdWorkspace } = await import('./sd-workspace')
    const opened = await openSdWorkspace()
    return {
      ok: true,
      path: opened.path,
      note: `${opened.kind} · ${opened.fileCount} archivo(s)`
    }
  }
  if (layer === 'ollama') {
    const o = resolveOllamaModelsDir()
    const home = resolveOllamaHomeDir()
    const target = o.exists ? o.path : home.exists ? home.path : o.path
    if (!existsSync(target)) {
      return {
        ok: false,
        path: target,
        error:
          'No existe la carpeta de Ollama. Instala Ollama y haz un pull, o revisa OLLAMA_MODELS.'
      }
    }
    await shell.openPath(target)
    return { ok: true, path: target, note: o.note }
  }
  if (layer === 'lmstudio') {
    const l = resolveLmStudioModelsDir()
    if (!l.exists && !existsSync(l.path)) {
      return {
        ok: false,
        path: l.path,
        error: l.note
      }
    }
    // parent if models subfolder missing
    let target = l.path
    if (!existsSync(target)) {
      const parent = join(homedir(), '.cache', 'lm-studio')
      if (existsSync(parent)) target = parent
    }
    if (!existsSync(target)) {
      return { ok: false, path: l.path, error: l.note }
    }
    await shell.openPath(target)
    return { ok: true, path: target, note: l.note }
  }
  if (layer === 'music') {
    const { ensureMusicWorkspace } = await import('./music-workspace')
    const ws = await ensureMusicWorkspace()
    await shell.openPath(ws.musicRoot)
    const aceOk =
      existsSync(join(ws.aceDir, 'pyproject.toml')) ||
      existsSync(join(ws.aceDir, '.installed')) ||
      existsSync(join(ws.aceDir, 'README.md'))
    return {
      ok: true,
      path: ws.musicRoot,
      note: aceOk
        ? 'Workspace ACE'
        : 'Carpeta de música creada; ACE aún no instalado (normal hasta que lo configures)'
    }
  }
  return { ok: false, error: 'capa desconocida' }
}
