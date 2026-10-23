/**
 * Optional LLM refine of progressive-reading rolling summary (map-reduce reduce side).
 * Runs after a slice is committed; updates documentReadingStore if the model returns usable text.
 * Prefer local; fall back to cloud only if settings allow background summary cloud.
 */

import { OllamaProvider, OpenAICompatibleProvider, type ChatProvider } from '@core/providers'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { orderCloudEndpoints } from '@core/models/cloud-rotation'
import type { DocReadingState } from '@core/chat/document-reading-state'
import { upsertDocReadingStates } from './documentReadingStore'

const inFlight = new Set<string>()

async function loadProviderKeys(): Promise<Record<string, string>> {
  try {
    const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
    const legacy = (await window.kawaii?.getCloudApiKey?.()) ?? ''
    if (legacy && !keys.openrouter) keys.openrouter = legacy
    return keys
  } catch {
    return {}
  }
}

async function pickProvider(): Promise<{ provider: ChatProvider; model: string } | null> {
  const settings = useSettingsStore.getState().settings
  const localModel = (settings.localModel || '').trim()
  if (localModel) {
    // Prefer OpenAI-compatible (LM Studio) when configured
    const openBase = (settings.localOpenAIBaseUrl || '').trim()
    if (openBase) {
      try {
        const oa = new OpenAICompatibleProvider({
          baseUrl: openBase,
          timeoutMs: Math.min(settings.localTimeoutMs || 60_000, 45_000)
        })
        return { provider: oa, model: localModel }
      } catch {
        /* fall through */
      }
    }
    try {
      const local = new OllamaProvider({
        baseUrl: settings.localBaseUrl,
        timeoutMs: Math.min(settings.localTimeoutMs || 60_000, 45_000)
      })
      const h = await local.healthCheck()
      if (h.ok) return { provider: local, model: localModel }
    } catch {
      /* try cloud */
    }
  }
  if (settings.backgroundSummaryAllowCloud !== true && settings.providerMode === 'local') {
    return null
  }
  try {
    const keys = await loadProviderKeys()
    const endpoints = orderCloudEndpoints(settings.cloudSlots || [], keys)
    for (const ep of endpoints.slice(0, 2)) {
      if (!ep.apiKey || !ep.model) continue
      const p = new OpenAICompatibleProvider({
        baseUrl: ep.baseUrl,
        apiKey: ep.apiKey,
        timeoutMs: Math.min(settings.cloudTimeoutMs || 60_000, 45_000)
      })
      return { provider: p, model: ep.model }
    }
  } catch {
    /* */
  }
  return null
}

/**
 * Fire-and-forget refine for one or more reading states after a progressive slice.
 */
export function scheduleRefineDocRollingSummary(states: DocReadingState[]): void {
  if (!states?.length) return
  for (const st of states) {
    if (!st?.key || !st.rollingSummary?.trim()) continue
    if (st.rollingSummary.length < 80) continue
    if (inFlight.has(st.key)) continue
    inFlight.add(st.key)
    void refineOne(st)
      .catch(() => null)
      .finally(() => inFlight.delete(st.key))
  }
}

async function refineOne(state: DocReadingState): Promise<void> {
  const pick = await pickProvider()
  if (!pick) return

  const prompt =
    'Eres un editor de resúmenes de lectura progresiva. ' +
    'A partir del resumen heurístico (hechos sueltos de tramos ya leídos), escribe un RESUMEN COMPACTO en español (máx. 12 líneas o ~900 caracteres). ' +
    'Conserva nombres, lugares y giros. No inventes capítulos no mencionados. No uses viñetas de meta. Solo el resumen.\n\n' +
    `Archivo: ${state.fileName}\n` +
    `Progreso: tramo ${state.chapterIndex + 1}/${state.chapterCount}\n` +
    `Títulos vistos: ${(state.readTitles || []).slice(-10).join(' · ')}\n\n` +
    `Resumen heurístico:\n${state.rollingSummary.slice(0, 2400)}`

  try {
    const result = await pick.provider.chat({
      model: pick.model,
      messages: [
        { role: 'system', content: 'Responde solo con el resumen refinado, sin preámbulo.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      maxTokens: 500
    })
    const text = String(result.content || '')
      .trim()
      .replace(/^```[\s\S]*?```/g, '')
      .trim()
    if (text.length < 40) return
    const refined = text.slice(0, 1400)
    upsertDocReadingStates([
      {
        ...state,
        rollingSummary: refined,
        updatedAt: Date.now()
      }
    ])
    // E2/E3 — document nearly finished
    try {
      const { isDocReadingComplete } = await import('@core/chat/document-reading-state')
      if (isDocReadingComplete(state) || state.chapterIndex + 1 >= (state.chapterCount || 1)) {
        const { appendEpisode } = await import('@core/conversation/memory-episodes')
        const { applyGrowthMilestone } = await import('@core/conversation/memory-growth')
        const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
        const title = state.fileName || 'documento'
        const prev = useSettingsStore.getState().settings
        const ep = appendEpisode(prev.memoryEpisodes as never, {
          summary: `Terminasteis de leer «${String(title).slice(0, 60)}» juntos.`,
          tags: ['document', 'libro', 'lectura', String(title).toLowerCase().slice(0, 20)]
        })
        const am = applyGrowthMilestone(prev.assistantMemory, {
          type: 'document_finished',
          title: String(title).slice(0, 60)
        })
        useSettingsStore.getState().update({
          memoryEpisodes: ep,
          assistantMemory: am
        } as never)
      }
    } catch {
      /* */
    }
  } catch {
    /* soft fail — heuristic summary remains */
  }
}
