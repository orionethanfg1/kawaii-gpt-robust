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
