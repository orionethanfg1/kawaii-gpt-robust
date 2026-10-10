
/**
 * Scan local runtimes, score models, persist to app DB.
 * Fail-soft: never throws hard.
 */
import {
  dbGetLastModelScanAt,
  dbGetModelScores,
  dbUpsertModelScores,
  type ModelScoreRow
} from './local-app-db'
import { scoreLocalModelId } from '../core/models/local-model-scorer'

const STALE_MS = 30 * 60 * 1000 // 30 min

export async function scanAndScoreLocalModels(opts?: {
  ollamaBaseUrl?: string
  openAIBaseUrl?: string
  force?: boolean
}): Promise<{
  ok: boolean
  count: number
  fromCache: boolean
  rows: ModelScoreRow[]
  error?: string
}> {
  try {
    const last = await dbGetLastModelScanAt()
    if (!opts?.force && last && Date.now() - last < STALE_MS) {
      const rows = await dbGetModelScores()
      if (rows.length > 0) {
        return { ok: true, count: rows.length, fromCache: true, rows }
      }
    }

    const { probeLocalBackends } = await import('../core/providers/local-backend')
    const probe = await probeLocalBackends({
      ollamaBaseUrl: opts?.ollamaBaseUrl,
      openAIBaseUrl: opts?.openAIBaseUrl
    })

    const rows: ModelScoreRow[] = []
    const add = (id: string, runtime: string) => {
      const s = scoreLocalModelId(id, runtime as 'ollama' | 'openai-compatible')
      rows.push({
        id: s.id,
        runtime,
        layer: s.layer,
        scoreChat: s.scoreChat,
        scoreReason: s.scoreReason,
        scoreFast: s.scoreFast,
        paramsB: s.paramsB,
        generation: s.generation,
        family: s.family,
        notes: s.notes.join('; '),
        lastSeen: Date.now()
      })
    }

    for (const m of probe.ollama?.models || []) add(m.id, 'ollama')
    for (const m of probe.openAI?.models || []) add(m.id, 'openai-compatible')

    if (rows.length === 0) {
      // keep previous cache if any
      const prev = await dbGetModelScores()
      if (prev.length) {
        return {
          ok: true,
          count: prev.length,
          fromCache: true,
          rows: prev,
          error: 'Ningún runtime respondió; se mantiene caché anterior'
        }
      }
      return { ok: false, count: 0, fromCache: false, rows: [], error: 'Sin modelos locales visibles' }
    }

    await dbUpsertModelScores(rows)
    return { ok: true, count: rows.length, fromCache: false, rows }
  } catch (e) {
    const prev = await dbGetModelScores().catch(() => [])
    return {
      ok: prev.length > 0,
      count: prev.length,
      fromCache: true,
      rows: prev,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

export async function pickFromCatalog(
  task: 'chat' | 'reason' | 'fast' | 'vision' | 'code' = 'chat'
): Promise<ModelScoreRow | null> {
  let rows = await dbGetModelScores()
  if (!rows.length) {
    const scan = await scanAndScoreLocalModels()
    rows = scan.rows
  }
  const { pickScoredModel } = await import('../core/models/local-model-scorer')
  const scored = rows.map((r) => ({
    id: r.id,
    runtime: r.runtime as 'ollama' | 'openai-compatible',
    layer: r.layer as 'chat' | 'vision' | 'code' | 'embed' | 'unknown',
    scoreChat: r.scoreChat,
    scoreReason: r.scoreReason,
    scoreFast: r.scoreFast,
    paramsB: r.paramsB,
    generation: r.generation,
    family: r.family,
    notes: r.notes ? r.notes.split('; ') : []
  }))
  const pick = pickScoredModel(scored, task)
  if (!pick) return null
  return rows.find((r) => r.id === pick.id && r.runtime === pick.runtime) || null
}
