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
import { shouldRunCanonicalSeed } from '@core/chat/document-ingest-etl'
import { publishDocIngestJob } from './documentIngestUi'

const inFlight = new Set<string>()

/** Background refine must not block VRAM forever while chat uses the same model. */
const REFINE_TIMEOUT_MS = 90_000
const SEED_TIMEOUT_MS = 90_000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}


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
const pendingRefine: DocReadingState[] = []
let idleTimer: ReturnType<typeof setTimeout> | null = null

function isChatStreamingNow(): boolean {
  try {
    const { useChatStore } = require('@shared/lib/stores/chatStore') as typeof import('@shared/lib/stores/chatStore')
    const st = useChatStore.getState()
    const conv = st.conversations.find((c) => c.id === st.activeId)
    return Boolean(conv?.messages?.some((m) => m.isStreaming))
  } catch {
    return false
  }
}

function flushRefineWhenIdle(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (isChatStreamingNow()) {
    idleTimer = setTimeout(() => flushRefineWhenIdle(), 8000)
    try {
      for (const st of pendingRefine) {
        publishDocIngestJob({
          key: st.key,
          convId: st.convId,
          fileName: st.fileName,
          phase: 'reduce',
          progress: 72,
          detail: 'Esperando inactividad del chat para REDUCE…',
          updatedAt: Date.now()
        })
      }
    } catch {
      /* */
    }
    return
  }
  const batch = pendingRefine.splice(0, pendingRefine.length)
  if (!batch.length) return
  scheduleRefineDocRollingSummaryNow(batch)
}

/** Queue refine/seed until the main chat is not streaming (saves VRAM contention). */
export function scheduleRefineDocRollingSummary(states: DocReadingState[]): void {
  if (!states?.length) return
  for (const st of states) {
    if (!st?.key) continue
    const i = pendingRefine.findIndex((x) => x.key === st.key)
    if (i >= 0) pendingRefine[i] = st
    else pendingRefine.push(st)
  }
  flushRefineWhenIdle()
}

function scheduleRefineDocRollingSummaryNow(states: DocReadingState[]): void {
  if (!states?.length) return
  for (const st of states) {
    if (!st?.key || !st.rollingSummary?.trim()) continue
    // Allow early refine; complete ingest always eligible
    const complete =
      (st as { ingestComplete?: boolean }).ingestComplete === true ||
      st.chapterIndex >= (st.chapterCount || 1)
    if (!complete && st.rollingSummary.length < 40) continue
    if (inFlight.has(st.key)) continue
    inFlight.add(st.key)
    try {
      publishDocIngestJob({
        key: st.key,
        convId: st.convId,
        fileName: st.fileName,
        phase: complete ? 'reduce' : 'map',
        progress: complete ? 78 : Math.min(70, 10 + (st.chapterIndex || 0) * 8),
        detail: complete ? 'REDUCE LLM del resumen…' : 'MAP/refine en curso…',
        updatedAt: Date.now()
      })
    } catch {
      /* */
    }
    void refineOne(st)
      .catch(() => null)
      .finally(() => inFlight.delete(st.key))
  }
  // ETL final: one canonical index when ingest complete
  scheduleCanonicalIndexSeed(states)
}

async function refineOne(state: DocReadingState): Promise<void> {
  const pick = await pickProvider()
  if (!pick) {
    try {
      publishDocIngestJob({
        key: state.key,
        convId: state.convId,
        fileName: state.fileName,
        phase: 'ready',
        progress: 100,
        detail: 'Sin LLM libre · resumen heurístico guardado',
        updatedAt: Date.now()
      })
    } catch {
      /* */
    }
    return
  }

  const mems = (state as { chapterMemories?: Array<{ title?: string; facts?: string }> })
    .chapterMemories
  const memBit =
    Array.isArray(mems) && mems.length
      ? '\nMemoria por capítulo (MAP):\n' +
        mems
          .slice(-14)
          .map((m) => `· ${m.title || '?'}: ${(m.facts || '').slice(0, 160)}`)
          .join('\n')
      : ''
  const complete =
    (state as { ingestComplete?: boolean }).ingestComplete === true ||
    state.chapterIndex >= (state.chapterCount || 1)
  const prompt =
    'Eres el paso REDUCE de un map-reduce de lectura. ' +
    'Entrada = hechos MAP (heurísticos o por capítulo). Salida = RESUMEN ÚNICO en español ' +
    '(máx. 14 líneas o ~1100 caracteres) listo para que el asistente opine sin re-leer el libro. ' +
    'Conserva nombres, lugares, giros y tono. PROHIBIDO inventar capítulos o hechos no listados. ' +
    'Sin preámbulo ni markdown de sistema.\n\n' +
    `Archivo: ${state.fileName}\n` +
    `Progreso: ${complete ? 'LECTURA COMPLETA' : `tramo ${state.chapterIndex + 1}/${state.chapterCount}`}\n` +
    `Títulos vistos: ${(state.readTitles || []).slice(-12).join(' · ')}\n` +
    memBit +
    `\n\nResumen / hechos MAP:\n${state.rollingSummary.slice(0, 3200)}`

  try {
    const result = await withTimeout(
      pick.provider.chat({
        model: pick.model,
        messages: [
          { role: 'system', content: 'Responde solo con el resumen refinado, sin preámbulo.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        maxTokens: 700
      }),
      REFINE_TIMEOUT_MS,
      'doc_reduce'
    )
    const text = String(result.content || '')
      .trim()
      .replace(/^```[\s\S]*?```/g, '')
      .trim()
    if (text.length < 40) return
    const refined = text.slice(0, 1800)
    upsertDocReadingStates([
      {
        ...state,
        rollingSummary: refined,
        updatedAt: Date.now()
      }
    ])
    try {
      publishDocIngestJob({
        key: state.key,
        convId: state.convId,
        fileName: state.fileName,
        phase: 'ready',
        progress: 100,
        detail: 'Resumen REDUCE listo',
        updatedAt: Date.now()
      })
    } catch {
      /* */
    }
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    try {
      publishDocIngestJob({
        key: state.key,
        convId: state.convId,
        fileName: state.fileName,
        phase: 'ready',
        progress: 100,
        detail:
          /timeout/i.test(msg)
            ? 'REDUCE omitido (modelo ocupado o lento) · se usa resumen heurístico'
            : 'REDUCE omitido · resumen heurístico OK',
        updatedAt: Date.now(),
        error: msg.slice(0, 120)
      })
    } catch {
      /* */
    }
  }
}



/**
 * One-shot LLM "MAP seed": natural canonical index for later readings (ETL Load).
 * Reuses the same provider as rolling refine; never loads a second model on purpose.
 */
export function scheduleCanonicalIndexSeed(states: DocReadingState[]): void {
  if (!states?.length) return
  for (const st of states) {
    if (!shouldRunCanonicalSeed(st as never)) continue
    const key = 'seed:' + st.key
    if (inFlight.has(key)) continue
    inFlight.add(key)
    publishDocIngestJob({
      key: st.key,
      convId: st.convId,
      fileName: st.fileName,
      phase: 'seed',
      progress: 88,
      detail: 'Generando índice canónico (1×)…',
      updatedAt: Date.now()
    })
    void seedCanonical(st)
      .catch(() => null)
      .finally(() => inFlight.delete(key))
  }
}

async function seedCanonical(state: DocReadingState): Promise<void> {
  const pick = await pickProvider()
  if (!pick) {
    publishDocIngestJob({
      key: state.key,
      convId: state.convId,
      fileName: state.fileName,
      phase: 'load',
      progress: 90,
      detail: 'Sin LLM local · se mantiene resumen heurístico',
      updatedAt: Date.now()
    })
    return
  }
  const mems = (state as { chapterMemories?: Array<{ title?: string; facts?: string }> }).chapterMemories
  const memBit =
    Array.isArray(mems) && mems.length
      ? '\nHechos por capítulo:\n' +
        mems
          .slice(0, 20)
          .map((m) => `· ${m.title || '?'}: ${(m.facts || '').slice(0, 140)}`)
          .join('\n')
      : ''
  const prompt =
    'Eres el paso final de una ingesta tipo ETL de un documento. ' +
    'A partir del resumen MAP/REDUCE, escribe un ÍNDICE CANÓNICO en español para lecturas posteriores: ' +
    'estructura (capítulos/temas), personajes o entidades clave, arcos o tesis, 3–6 anclas citables. ' +
    'Máx. ~1200 caracteres. Natural, como notas de una lectora atenta — no lista robótica. ' +
    'PROHIBIDO inventar capítulos o hechos no presentes.\n\n' +
    `Archivo: ${state.fileName}\n` +
    `Títulos: ${(state.readTitles || []).slice(-16).join(' · ')}\n` +
    memBit +
    `\n\nResumen MAP/REDUCE:\n${(state.rollingSummary || '').slice(0, 3500)}`

  try {
    const result = await withTimeout(
      pick.provider.chat({
        model: pick.model,
        messages: [
          { role: 'system', content: 'Responde solo con el índice canónico, sin preámbulo.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.35,
        maxTokens: 700
      }),
      SEED_TIMEOUT_MS,
      'doc_seed'
    )
    const text = String(result.content || '')
      .trim()
      .replace(/^```[\s\S]*?```/g, '')
      .trim()
    if (text.length < 50) {
      publishDocIngestJob({
        key: state.key,
        convId: state.convId,
        fileName: state.fileName,
        phase: 'error',
        progress: 90,
        detail: 'Índice demasiado corto; se reintentará en la próxima lectura',
        updatedAt: Date.now()
      })
      return
    }
    const canonical = text.slice(0, 2000)
    upsertDocReadingStates([
      {
        ...state,
        rollingSummary: state.rollingSummary?.trim()
          ? state.rollingSummary
          : canonical.slice(0, 1400),
        canonicalIndex: canonical,
        seedAt: Date.now(),
        updatedAt: Date.now()
      } as DocReadingState
    ])
    publishDocIngestJob({
      key: state.key,
      convId: state.convId,
      fileName: state.fileName,
      phase: 'ready',
      progress: 100,
      detail: 'Índice listo · el chat usará memoria en lecturas posteriores',
      updatedAt: Date.now()
    })
    try {
      const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
      const s = useSettingsStore.getState().settings
      const facts = [...(s.userMemory?.facts || [])]
      const line = `DOC_INDEX «${state.fileName || 'documento'}»: ${canonical.slice(0, 280)}`
      const idx = facts.findIndex((f) => String(f).startsWith('DOC_INDEX «') && String(f).includes(String(state.fileName || '').slice(0, 24)))
      if (idx >= 0) facts[idx] = line
      else facts.push(line)
      useSettingsStore.getState().update({
        userMemory: { ...(s.userMemory || { facts: [], likes: [], people: [] }), facts: facts.slice(-80) }
      } as never)
    } catch {
      /* */
    }
  } catch (e) {
    publishDocIngestJob({
      key: state.key,
      convId: state.convId,
      fileName: state.fileName,
      phase: 'error',
      progress: 0,
      detail: e instanceof Error ? e.message : String(e),
      updatedAt: Date.now(),
      error: e instanceof Error ? e.message : String(e)
    })
  }
}
