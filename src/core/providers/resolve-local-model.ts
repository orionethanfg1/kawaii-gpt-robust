
/**
 * Resolve which local runtime owns a model id and normalize the id.
 * Fixes: settings say "qwen3.5:9b" (Ollama-style) but the weight lives in LM Studio.
 */
import { createLocalBackend, probeLocalBackends, backendFromResolved, type LocalModelInfo } from './local-backend'
import type { ResolvedLocalRuntime } from './resolve-local'
import { scoreLocalModelId, largeModelWarning } from '../models/local-model-scorer'
import { isLocalModelDisabled } from '../models/disabled-local-models'

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

function scoreFallback(
  id: string,
  runtime?: 'ollama' | 'openai-compatible'
): number {
  try {
    return scoreLocalModelId(id, runtime === 'openai-compatible' ? 'openai-compatible' : 'ollama')
      .scoreChat
  } catch {
    return 0
  }
}

/** Prefer newer Qwen gen when same size class is available */
function preferNewerQwen(
  catalog: Array<{ id: string; runtime: 'ollama' | 'openai-compatible' }>
): void {
  // scoring handled in sort; this is a post-pass nudge
  void catalog
}

export async function resolveLocalModelPlacement(opts: {
  /** Model ids user disabled for Auto */
  disabledLocalModels?: string[]
  preferredModel?: string
  /** When true, settings model wins if present in catalog (or forced id) */
  preferredPinned?: boolean
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
  preference?: 'auto' | 'ollama' | 'openai-compatible'
  /** Disk-only LM Studio / Ollama ids (server can load on demand) */
  diskModelIds?: string[]
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
  // Disk-only GGUF ids (parent/file.gguf) are NOT valid LM Studio API model ids.
  // Injecting them made Auto pick paths that return empty/404 → "modelo no respondió".
  // User must load the model in LM Studio (or use the openai-compatible id from /v1/models).
  if (!catalog.length) return null

  const wanted = (opts.preferredModel || '').trim()
  const pinned = Boolean(opts.preferredPinned)
  const disabled = opts.disabledLocalModels || []
  // Auto path ignores disabled models; pinned still allowed
  const catalogForAuto = catalog.filter((m) => !isLocalModelDisabled(m.id, disabled))


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
  const LIVE_API_BOOST = 14
  const GEN3_BEATS_25 = 18 // qwen3-class should beat qwen2.5 at same size
  const effectiveParamsB = (id: string): number | null => {
    try {
      return scoreLocalModelId(id).paramsB
    } catch {
      return null
    }
  }
  const isEfficientLight = (id: string): boolean => {
    const low = id.toLowerCase()
    if (/\b[ae]\d+(?:\.\d+)?\s*b\b/.test(low)) return true
    const pb = effectiveParamsB(id)
    return pb != null && pb > 0 && pb <= 15
  }
  const isDenseHeavy = (id: string): boolean => {
    if (/\b[ae]\d+(?:\.\d+)?\s*b\b/i.test(id)) return false
    const pb = effectiveParamsB(id)
    return pb != null && pb >= 24
  }
  const scoreRow = (m: { id: string; runtime: 'ollama' | 'openai-compatible' }) => {
    let s =
      scoreFallback(m.id, m.runtime) +
      (m.runtime === 'openai-compatible' ? LIVE_API_BOOST : 0)
    const low = m.id.toLowerCase()
    // Explicit: Qwen3 / Qwen3.5 path beats Qwen2.5 for default chat
    if (/qwen3|qwen-3|qwen\/qwen3/.test(low) && !/qwen2/.test(low)) s += GEN3_BEATS_25
    if (/qwen2\.5|qwen2-5/.test(low)) s -= 6
    // Prefer A4B/E4B and 9–14B for default chat; dense 24B+ still selectable
    // (user may enable only large models or want quality over speed — score, don't ban)
    if (isEfficientLight(m.id)) s += 22
    if (isDenseHeavy(m.id)) s -= 18
    // Decision/tools boost for agent-style ids
    if (/hermes|tool|agent|function|command-r|nous/i.test(low)) s += 8
    return s
  }
  // Never re-open the full catalog when the user disabled models and the filter emptied the pool
  if (disabled.length && !catalogForAuto.length) {
    return null
  }
  const pool = [...(catalogForAuto.length ? catalogForAuto : catalog)]
  const sorted = pool.sort((a, b) => scoreRow(b) - scoreRow(a))
  let smart = sorted[0]
  // If top is qwen2.5 but a qwen3 9–15B exists, take the qwen3
  if (smart && /qwen2\.5|qwen2-5/.test(smart.id.toLowerCase())) {
    const better = sorted.find((m) => {
      const low = m.id.toLowerCase()
      if (!/qwen3|qwen\/qwen3/.test(low) || /qwen2/.test(low)) return false
      const pb = effectiveParamsB(m.id)
      return pb == null || (pb >= 8 && pb <= 16)
    })
    if (better) smart = better
  }
  // Soft nudge: if top is dense heavy and an efficient light is within ~12 score points, prefer light
  if (smart && isDenseHeavy(smart.id)) {
    const light = sorted.find((m) => isEfficientLight(m.id))
    if (light && scoreRow(smart) - scoreRow(light) <= 12) smart = light
  }
  if (smart) {
    const st = smart.runtime === 'ollama' ? probe.ollama : probe.openAI
    const smartScore = scoreRow(smart)
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
