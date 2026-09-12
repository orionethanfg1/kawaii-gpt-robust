/**
 * Transparent environment bootstrap — runs once at app start.
 * Starts Ollama if needed, ensures a vision model for avatar describe,
 * fills character visual description, probes local OpenAI-compatible runtimes.
 */

import { ensureVisualDescriptionFromAvatar } from '@features/settings/ensureVisualDescription'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { resolveLocalRuntime, discoverLocalModels } from '@core/providers'
import { activityInfo } from '@shared/lib/stores/activityStore'

let started = false

const VISION_CANDIDATES = ['llava:7b', 'llava', 'moondream', 'minicpm-v']

async function ollamaTags(base: string): Promise<string[]> {
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/tags`)
    if (!res.ok) return []
    const data = (await res.json()) as { models?: Array<{ name?: string }> }
    return (data.models || []).map((m) => String(m.name || ''))
  } catch {
    return []
  }
}

function hasVisionModel(names: string[]): string | null {
  for (const c of VISION_CANDIDATES) {
    const hit = names.find((n) => n === c || n.startsWith(c.split(':')[0]))
    if (hit) return hit
  }
  return null
}

export async function runAutoBootstrap(): Promise<void> {
  if (started) return
  started = true
  const settings = () => useSettingsStore.getState().settings

  // 1) Ensure Ollama process if preference allows
  try {
    const base = settings().localBaseUrl || 'http://127.0.0.1:11434'
    const st = await window.kawaii?.ollamaStatus?.(base)
    if (!st?.reachable) {
      activityInfo('Preparando entorno local', 'Intentando iniciar Ollama…')
      await window.kawaii?.ollamaStart?.(base)
    }
  } catch {
    /* ignore */
  }

  // 2) Probe runtimes (Ollama + LM Studio / llama.cpp)
  try {
    const resolved = await resolveLocalRuntime({
      preference: settings().localRuntimePreference || 'auto',
      ollamaBaseUrl: settings().localBaseUrl,
      openAIBaseUrl: (settings().localOpenAIBaseUrl || '').trim() || undefined
    })
    if (resolved) {
      useSettingsStore.getState().update({
        localRuntimeLabel: `${resolved.label} · ${resolved.kind}`,
        ...(resolved.kind === 'openai-compatible' && resolved.defaultModel && !settings().localModel
          ? { localModel: resolved.defaultModel }
          : {})
      })
    }
  } catch {
    /* ignore */
  }

  // 3) Vision model for avatar (only if avatar exists, no OpenRouter key, and no vision model)
  try {
    const s = settings()
    const avatar = (s.character?.visualImageUrl || '').trim()
    if (avatar) {
      const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
      const hasCloudVision = Boolean(keys.openrouter || keys.main)
      if (!hasCloudVision) {
        const names = await ollamaTags(s.localBaseUrl || 'http://127.0.0.1:11434')
        if (!hasVisionModel(names)) {
          activityInfo(
            'Configurando visión local',
            'Descargando modelo ligero para describir el avatar (una sola vez)…'
          )
          // Prefer moondream (smaller) then llava
          void window.kawaii?.ollamaPull?.('moondream', s.localBaseUrl).catch(() => {
            void window.kawaii?.ollamaPull?.('llava:7b', s.localBaseUrl)
          })
        }
      }
      // 4) Fill visual description silently
      await ensureVisualDescriptionFromAvatar({ force: false })
      // retry later when vision model may have finished
      window.setTimeout(() => void ensureVisualDescriptionFromAvatar({ force: false }), 60_000)
      window.setTimeout(() => void ensureVisualDescriptionFromAvatar({ force: false }), 180_000)
    }
  } catch {
    /* ignore */
  }
}
