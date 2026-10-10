/**
 * Automatic vision stack: detect → cloud → install local (Ollama) with recovery.
 */

import {
  CLOUD_VISION_CANDIDATES,
  isVisionModelName,
  pickLocalVisionTags,
  type LocalVisionCandidate
} from './catalog'

export type VisionEnsureResult = {
  ok: boolean
  source: 'local' | 'cloud' | 'none'
  model?: string
  label?: string
  message: string
  /** Tags recommended to pull if local missing */
  suggestedPulls: LocalVisionCandidate[]
  installedVision: string[]
  cloudAvailable: boolean
}

export type VisionEnsureDeps = {
  ollamaBaseUrl?: string
  openRouterKey?: string
  openRouterBase?: string
  vramGB?: number | null
  /** Injected for tests / Electron */
  listOllamaModels?: (baseUrl: string) => Promise<string[]>
  ollamaReachable?: (baseUrl: string) => Promise<boolean>
}

async function defaultListModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`)
    if (!res.ok) return []
    const data = (await res.json()) as { models?: Array<{ name?: string }> }
    return (data.models || []).map((m) => String(m.name || '')).filter(Boolean)
  } catch {
    return []
  }
}

async function defaultReachable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(4000)
    })
    return res.ok
  } catch {
    return false
  }
}

export async function probeVisionStack(deps: VisionEnsureDeps = {}): Promise<VisionEnsureResult> {
  const base = (deps.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
  const list = deps.listOllamaModels || defaultListModels
  const reach = deps.ollamaReachable || defaultReachable
  const suggested = pickLocalVisionTags(deps.vramGB)

  const cloudAvailable = Boolean((deps.openRouterKey || '').trim())

  let installed: string[] = []
  let ollamaUp = false
  try {
    ollamaUp = await reach(base)
    if (ollamaUp) {
      const names = await list(base)
      installed = names.filter(isVisionModelName)
    }
  } catch {
    /* ignore */
  }

  if (installed.length) {
    return {
      ok: true,
      source: 'local',
      model: installed[0],
      label: installed[0],
      message: `Visión local lista: ${installed.slice(0, 3).join(', ')}`,
      suggestedPulls: suggested.filter((s) => !installed.some((i) => i.startsWith(s.tag.split(':')[0]))),
      installedVision: installed,
      cloudAvailable
    }
  }

  if (cloudAvailable) {
    const c = CLOUD_VISION_CANDIDATES[0]
    return {
      ok: true,
      source: 'cloud',
      model: c.model,
      label: c.label,
      message:
        'Sin modelo vision local. Usando cloud (OpenRouter). Puedes instalar uno local para privacidad y offline.',
      suggestedPulls: suggested,
      installedVision: [],
      cloudAvailable: true
    }
  }

  return {
    ok: false,
    source: 'none',
    message:
      'No hay visión disponible. Instala un modelo local (Ollama) o configura OpenRouter. Se recomienda: ' +
      suggested
        .slice(0, 3)
        .map((s) => s.tag)
        .join(', '),
    suggestedPulls: suggested,
    installedVision: [],
    cloudAvailable: false
  }
}

/**
 * Pick best local tag to install next given VRAM and already installed names.
 */
export function nextVisionPullTag(
  vramGB: number | null | undefined,
  installed: string[]
): LocalVisionCandidate | null {
  const candidates = pickLocalVisionTags(vramGB)
  for (const c of candidates) {
    const base = c.tag.split(':')[0].toLowerCase()
    if (installed.some((i) => i.toLowerCase().includes(base))) continue
    return c
  }
  return null
}
