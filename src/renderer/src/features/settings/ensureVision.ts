/**
 * UI helper: probe vision + auto-install best local model via Ollama pull (resumable).
 */
import { probeVisionStack, nextVisionPullTag } from '@core/vision'
import type { VisionEnsureResult } from '@core/vision'

export async function ensureVisionForApp(opts?: {
  autoInstall?: boolean
  vramGB?: number | null
  ollamaBaseUrl?: string
}): Promise<VisionEnsureResult & { pullStarted?: string }> {
  const base = (opts?.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
  let keys: Record<string, string> = {}
  try {
    keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
  } catch {
    /* ignore */
  }
  let vram = opts?.vramGB ?? null
  try {
    const hw = await window.kawaii?.machineEnsureProfile?.()
    if (hw && typeof (hw as { vramGB?: number }).vramGB === 'number') {
      vram = (hw as { vramGB: number }).vramGB
    }
  } catch {
    /* ignore */
  }

  const probe = await probeVisionStack({
    ollamaBaseUrl: base,
    openRouterKey: keys.openrouter || keys.main || '',
    vramGB: vram
  })

  if (probe.source === 'local' || opts?.autoInstall === false) {
    return probe
  }

  // Auto-install if Ollama up and no local vision
  if (probe.installedVision.length === 0 && window.kawaii?.ollamaPull) {
    const next = nextVisionPullTag(vram, probe.installedVision)
    if (next) {
      try {
        // Fire-and-forget pull; progress via existing ollama:pull-progress
        void window.kawaii.ollamaPull(next.tag, base)
        return {
          ...probe,
          message:
            probe.message +
            ` Instalando ${next.label} (${next.tag}, ~${next.downloadGB} GB). La descarga es reanudable.`,
          pullStarted: next.tag
        }
      } catch (e) {
        return {
          ...probe,
          message: probe.message + ` No se pudo iniciar pull: ${e instanceof Error ? e.message : String(e)}`
        }
      }
    }
  }

  return probe
}
