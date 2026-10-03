
/**
 * Resolve which local runtime owns a model id and normalize the id.
 * Fixes: settings say "qwen3.5:9b" (Ollama-style) but the weight lives in LM Studio.
 */
import { createLocalBackend, probeLocalBackends, backendFromResolved, type LocalModelInfo } from './local-backend'
import type { ResolvedLocalRuntime } from './resolve-local'
import { scoreLocalModelId, largeModelWarning } from '../models/local-model-scorer'

export type ResolvedLocalModel = {
  modelId: string
  runtime: 'ollama' | 'openai-compatible'
  baseUrl: string
  label: string
  matched: 'exact' | 'fuzzy' | 'fallback'
  /** All ids seen on both runtimes */
  catalog: Array<{ id: string; runtime: 'ollama' | 'openai-compatible' }>
  note?: string
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/_/g, '-')
}

/** Loose equality: qwen3.5:9b ≈ qwen3.5-9b ≈ qwen/qwen3.5-9b */
function scoreMatch(wanted: string, candidate: string): number {
  const w = norm(wanted)
  const c = norm(candidate)
  if (!w || !c) return 0
  if (w === c) return 100
  if (c.endsWith('/' + w) || c.endsWith(':' + w)) return 95
  // strip publisher
  const wLast = w.split('/').pop() || w
  const cLast = (c.split('/').pop() || c).split(':')[0]
  if (wLast === cLast) return 90
  // qwen3.5:9b vs qwen3.5-9b
  const wFlat = wLast.replace(/:/g, '-')
  const cFlat = (c.split('/').pop() || c).replace(/:/g, '-')
  if (wFlat === cFlat) return 88
  if (cFlat.includes(wFlat) || wFlat.includes(cFlat)) return 70
  // size token 9b / 14b
  const size = w.match(/(\\d+\\.?\\d*)b/i)?.[1]
  const family = w.replace(/[:\\/\\-]?\\d+\\.?\\d*b.*$/i, '').replace(/qwen/i, 'qwen')
  if (size && c.includes(size + 'b') && /qwen/i.test(c) && /qwen/i.test(w)) return 55
  return 0
}

function bestInList(
  wanted: string,
  list: Array<{ id: string; runtime: 'ollama' | 'openai-compatible' }>
): { id: string; runtime: 'ollama' | 'openai-compatible'; score: number } | null {
  let best: { id: string; runtime: 'ollama' | 'openai-compatible'; score: number } | null = null
  for (const m of list) {
    const s = scoreMatch(wanted, m.id)
    if (s > 0 && (!best || s > best.score)) best = { id: m.id, runtime: m.runtime, score: s }
  }
  return best
}

function scoreFallback(id: string): number {
  try {
    return scoreLocalModelId(id).scoreChat
  } catch {
    return 0
  }
}

export async function resolveLocalModelPlacement(opts: {
  preferredModel?: string
  /** When true, settings model wins if present in catalog (or forced id) */
  preferredPinned?: boolean
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
  preference?: 'auto' | 'ollama' | 'openai-compatible'
}): Promise<ResolvedLocalModel | null> {
  const probe = await probeLocalBackends({
    ollamaBaseUrl: opts.ollamaBaseUrl,
    openAIBaseUrl: opts.openAIBaseUrl
  })
  const catalog: Array<{ id: string; runtime: 'ollama' | 'openai-compatible' }> = []
  if (probe.ollama?.models) {
    for (const m of probe.ollama.models) catalog.push({ id: m.id, runtime: 'ollama' })
  }
  if (probe.openAI?.models) {
    for (const m of probe.openAI.models) catalog.push({ id: m.id, runtime: 'openai-compatible' })
  }
  if (!catalog.length) return null

  const wanted = (opts.preferredModel || '').trim()
  const pinned = Boolean(opts.preferredPinned)

  // 0) User pinned a model in Settings → hard respect if we can place it
  if (pinned && wanted) {
    const exact = catalog.find((m) => m.id === wanted)
    if (exact) {
      const st = exact.runtime === 'ollama' ? probe.ollama : probe.openAI
      return {
        modelId: exact.id,
        runtime: exact.runtime,
        baseUrl: st!.baseUrl,
        label: st!.label,
        matched: 'exact',
        catalog,
        note: `Fijado en Ajustes: «${exact.id}»`
      }
    }
    const fuzzy = bestInList(wanted, catalog)
    if (fuzzy && fuzzy.score >= 55) {
      const st = fuzzy.runtime === 'ollama' ? probe.ollama : probe.openAI
      return {
        modelId: fuzzy.id,
        runtime: fuzzy.runtime,
        baseUrl: st!.baseUrl,
        label: st!.label,
        matched: 'fuzzy',
        catalog,
        note: `Fijado (aprox): «${wanted}» → «${fuzzy.id}»`
      }
    }
    // Pinned but not in live catalog
    const looksLm =
      wanted.includes('/') ||
      (!/:/.test(wanted) && !wanted.includes(':') && wanted.length > 3)
    const looksOllama = /:[a-z0-9._-]+$/i.test(wanted) && !wanted.includes('/')
    if (looksLm && !probe.openAI) {
      // Do NOT silently fall back to Ollama with an LM Studio id
      return null
    }
    if (looksOllama && probe.ollama) {
      return {
        modelId: wanted,
        runtime: 'ollama',
        baseUrl: probe.ollama.baseUrl,
        label: probe.ollama.label,
        matched: 'exact',
        catalog,
        note: `Fijado «${wanted}» en Ollama (se cargará al usar si está instalado)`
      }
    }
    if (looksLm && probe.openAI) {
      return {
        modelId: wanted,
        runtime: 'openai-compatible',
        baseUrl: probe.openAI.baseUrl,
        label: probe.openAI.label,
        matched: 'exact',
        catalog,
        note: `Fijado «${wanted}» en LM Studio`
      }
    }
  }

  // 1) Auto / unpinned: intelligent pick among *visible* runtimes only
  // Prefer models actually listed by a live API (openai-compatible / ollama) over names alone
  const LIVE_API_BOOST = 12
  const sorted = [...catalog].sort((a, b) => {
    const sb = scoreFallback(b.id) + (b.runtime === 'openai-compatible' ? LIVE_API_BOOST : 0)
    const sa = scoreFallback(a.id) + (a.runtime === 'openai-compatible' ? LIVE_API_BOOST : 0)
    return sb - sa
  })
  const smart = sorted[0]
  if (smart) {
    const st = smart.runtime === 'ollama' ? probe.ollama : probe.openAI
    const smartScore = scoreFallback(smart.id)
    const onlyOllama = Boolean(probe.ollama) && !probe.openAI
    const onlyLm = Boolean(probe.openAI) && !probe.ollama
    const scope = onlyOllama
      ? 'Solo Ollama responde (LM Studio Server no detectado). '
      : onlyLm
        ? 'Solo LM Studio responde. '
        : 'Ollama + LM Studio visibles. '
    const big = largeModelWarning(smart.id)
    return {
      modelId: smart.id,
      runtime: smart.runtime,
      baseUrl: st!.baseUrl,
      label: st!.label,
      matched: 'fallback',
      catalog,
      note:
        scope +
        `Elección inteligente: «${smart.id}» (score ${smartScore}).` +
        (onlyOllama
          ? ' Para Qwen3.x de LMS: Developer → Start Server en LM Studio.'
          : '') +
        (big ? ' ⚠ ' + big : '')
    }
  }

  // 2) Last resort: settings id if listed
  if (wanted) {
    const exact = catalog.find((m) => m.id === wanted)
    if (exact) {
      const st = exact.runtime === 'ollama' ? probe.ollama : probe.openAI
      return {
        modelId: exact.id,
        runtime: exact.runtime,
        baseUrl: st!.baseUrl,
        label: st!.label,
        matched: 'exact',
        catalog,
        note: 'Failover a modelo de Ajustes'
      }
    }
  }

  return null
}

export function placementToResolved(p: ResolvedLocalModel): ResolvedLocalRuntime {
  return {
    kind: p.runtime,
    baseUrl: p.baseUrl,
    label: p.label,
    defaultModel: p.modelId
  }
}
