
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

    // Disk-only so Auto/scores can prefer A4B even if LMS has not loaded it yet
    try {
      const { scanLocalModelsOnDisk } = await import('./scan-local-models')
      const disk = scanLocalModelsOnDisk()
      const seen = new Set(rows.map((r) => r.id.toLowerCase()))
      for (const d of disk.models || []) {
        const id = (d.id || d.name || '').trim()
        if (!id || seen.has(id.toLowerCase())) continue
        seen.add(id.toLowerCase())
        const s = scoreLocalModelId(id, 'disk')
        rows.push({
          id: s.id,
          runtime: 'disk',
          layer: s.layer,
          scoreChat: s.scoreChat,
          scoreReason: s.scoreReason,
          scoreFast: s.scoreFast,
          paramsB: s.paramsB,
          generation: s.generation,
          family: s.family,
          notes: (s.notes.join('; ') + '; solo disco').trim(),
          lastSeen: Date.now()
        })
      }
    } catch {
      /* disk scan optional */
    }

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
  task: 'chat' | 'reason' | 'fast' | 'vision' | 'code' | 'tools' | 'decision' = 'chat'
): Promise<ModelScoreRow | null> {
  let rows = await dbGetModelScores()
  if (!rows.length) {
    const scan = await scanAndScoreLocalModels()
    rows = scan.rows
  }
  const { pickScoredModel } = await import('../core/models/local-model-scorer')
  const scored = rows.map((r) => {
    const live = scoreLocalModelId(
      r.id,
      r.runtime === 'openai-compatible' ? 'openai-compatible' : r.runtime === 'disk' ? 'disk' : 'ollama'
    )
    return {
      id: r.id,
      runtime: r.runtime as 'ollama' | 'openai-compatible' | 'disk',
      layer: r.layer as 'chat' | 'vision' | 'code' | 'embed' | 'unknown',
      scoreChat: r.scoreChat ?? live.scoreChat,
      scoreReason: r.scoreReason ?? live.scoreReason,
      scoreFast: r.scoreFast ?? live.scoreFast,
      scoreTools: live.scoreTools,
      scoreDecision: live.scoreDecision,
      paramsB: r.paramsB ?? live.paramsB,
      generation: r.generation ?? live.generation,
      family: r.family || live.family,
      notes: r.notes ? r.notes.split('; ') : live.notes
    }
  })
  const pick = pickScoredModel(scored, task as 'chat' | 'reason' | 'fast' | 'vision' | 'code' | 'tools' | 'decision')
  if (!pick) return null
  return rows.find((r) => r.id === pick.id && r.runtime === pick.runtime) || null
}
