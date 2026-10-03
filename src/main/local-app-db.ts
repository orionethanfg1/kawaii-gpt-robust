
/**
 * Lightweight persistent store under userData.
 * Schema-shaped JSON (ready to migrate to SQLite later).
 * Never throws to callers — empty defaults on corruption.
 */
import { app } from 'electron'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export type ModelScoreRow = {
  id: string
  runtime: string
  layer: string
  scoreChat: number
  scoreReason: number
  scoreFast: number
  paramsB: number | null
  generation: number | null
  family: string
  notes: string
  lastSeen: number
}

export type LearningEventRow = {
  id: string
  at: number
  kind: string
  key: string
  payload: string
}

type DbShape = {
  version: 1
  modelScores: ModelScoreRow[]
  learningEvents: LearningEventRow[]
  meta: { lastModelScanAt?: number }
}

const EMPTY: DbShape = {
  version: 1,
  modelScores: [],
  learningEvents: [],
  meta: {}
}

function dbPath(): string {
  return join(app.getPath('userData'), 'kawaii-app-db.json')
}

async function readDb(): Promise<DbShape> {
  try {
    const raw = await readFile(dbPath(), 'utf8')
    const j = JSON.parse(raw) as DbShape
    if (!j || j.version !== 1 || !Array.isArray(j.modelScores)) return { ...EMPTY }
    return {
      version: 1,
      modelScores: j.modelScores || [],
      learningEvents: Array.isArray(j.learningEvents) ? j.learningEvents : [],
      meta: j.meta || {}
    }
  } catch {
    return { ...EMPTY, modelScores: [], learningEvents: [], meta: {} }
  }
}

async function writeDb(db: DbShape): Promise<void> {
  try {
    const dir = app.getPath('userData')
    await mkdir(dir, { recursive: true })
    const target = dbPath()
    const tmp = target + '.tmp'
    await writeFile(tmp, JSON.stringify(db, null, 0), 'utf8')
    await rename(tmp, target)
  } catch (e) {
    console.warn('[local-app-db] write failed', e)
  }
}

export async function dbGetModelScores(): Promise<ModelScoreRow[]> {
  const db = await readDb()
  return db.modelScores
}

export async function dbUpsertModelScores(rows: ModelScoreRow[]): Promise<void> {
  const db = await readDb()
  const map = new Map(db.modelScores.map((r) => [r.runtime + '::' + r.id, r]))
  for (const r of rows) {
    map.set(r.runtime + '::' + r.id, r)
  }
  db.modelScores = [...map.values()]
  db.meta.lastModelScanAt = Date.now()
  await writeDb(db)
}

export async function dbGetLastModelScanAt(): Promise<number | undefined> {
  const db = await readDb()
  return db.meta.lastModelScanAt
}

export async function dbAddLearningEvent(
  kind: string,
  key: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const db = await readDb()
    db.learningEvents.push({
      id: `le_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      kind,
      key,
      payload: JSON.stringify(payload).slice(0, 2000)
    })
    // keep last 200
    if (db.learningEvents.length > 200) {
      db.learningEvents = db.learningEvents.slice(-200)
    }
    await writeDb(db)
  } catch {
    /* fail-soft */
  }
}

export async function dbListLearningEvents(limit = 30): Promise<LearningEventRow[]> {
  const db = await readDb()
  return db.learningEvents.slice(-Math.max(1, limit)).reverse()
}

export function dbFilePath(): string {
  try {
    return dbPath()
  } catch {
    return ''
  }
}
