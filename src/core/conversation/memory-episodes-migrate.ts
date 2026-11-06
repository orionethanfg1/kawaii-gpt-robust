/**
 * One-pass migration: classify existing unstructured memory into episodes.
 * - Never deletes or rewrites userMemory facts/people (backup-first).
 * - Only APPENDS episodes; dedupes against existing store.
 * - Marks migratedFromLegacyAt so it runs once.
 */

import type { UserMemory } from './user-memory'
import {
  appendEpisode,
  normalizeEpisodeStore,
  type EpisodeStore,
  type AppendEpisodeInput
} from './memory-episodes'

export type EpisodeMigrationBackup = {
  at: number
  userMemorySnapshot: unknown
  episodeStoreBefore: EpisodeStore
}

export type EpisodeMigrationResult = {
  store: EpisodeStore
  added: number
  skipped: number
  backup: EpisodeMigrationBackup
  alreadyMigrated: boolean
}

const BACKUP_KEY = 'kawaii-episode-migration-backup-v1'

function isNoiseFact(f: string): boolean {
  const t = String(f || '').trim()
  if (t.length < 12) return true
  if (/^PIN:/i.test(t)) return false
  if (/^DOC_(READ|INDEX)\b/i.test(t)) return true
  if (/^INTIMACY_/i.test(t)) return false
  if (/^WARDROBE_/i.test(t)) return true
  return false
}

function candidatesFromUserMemory(mem?: UserMemory | null): AppendEpisodeInput[] {
  if (!mem) return []
  const out: AppendEpisodeInput[] = []
  const at = mem.updatedAt && mem.updatedAt > 0 ? mem.updatedAt : Date.now() - 86400_000

  for (const p of mem.people || []) {
    const name = String(p.name || '').trim()
    if (name.length < 2) continue
    const rel = p.relation ? String(p.relation) : ''
    out.push({
      summary:
        rel
          ? `Conocemos a ${name} (${rel}).`
          : `El usuario mencionó a ${name} como persona relevante.`,
      tags: ['persona', 'migrated', rel ? 'relación' : 'nombre'].filter(Boolean),
      people: [name],
      at,
      source: 'migrated'
    })
  }

  for (const f of mem.facts || []) {
    const text = String(f || '').trim()
    if (isNoiseFact(text)) continue
    let summary = text.replace(/^PIN:\s*/i, '').slice(0, 280)
    if (/^INTIMACY_FIRST:/i.test(text)) {
      summary = 'Hito: primera cercanía íntima compartida. ' + text.replace(/^INTIMACY_FIRST:\s*/i, '').slice(0, 200)
    } else if (/^INTIMACY_/i.test(text)) {
      summary = text.replace(/^INTIMACY_[A-Z_]+:\s*/i, '').slice(0, 280)
    }
    if (summary.length < 12) continue
    const tags = ['hecho', 'migrated']
    if (/libro|novela|cap[ií]tulo|personaje/i.test(summary)) tags.push('libro')
    if (/intim/i.test(text)) tags.push('intimacy')
    out.push({
      summary,
      tags,
      at,
      source: 'migrated'
    })
  }

  if ((mem.relationshipSummary || '').trim().length >= 20) {
    out.push({
      summary: 'Vínculo: ' + String(mem.relationshipSummary).trim().slice(0, 280),
      tags: ['relationship', 'migrated'],
      at,
      source: 'migrated'
    })
  }

  return out
}

export function readEpisodeMigrationBackup(): EpisodeMigrationBackup | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) return null
    return JSON.parse(raw) as EpisodeMigrationBackup
  } catch {
    return null
  }
}

function writeBackup(b: EpisodeMigrationBackup): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(BACKUP_KEY, JSON.stringify(b))
  } catch {
    /* quota — migration still safe: we only append */
  }
}

/**
 * Classify legacy memory into episodes once. Idempotent.
 * Does not modify userMemory.
 */
export function migrateLegacyMemoryToEpisodes(
  userMemory: UserMemory | null | undefined,
  episodeStore: EpisodeStore | null | undefined
): EpisodeMigrationResult {
  const before = normalizeEpisodeStore(episodeStore)
  const backup: EpisodeMigrationBackup = {
    at: Date.now(),
    userMemorySnapshot: userMemory
      ? {
          facts: [...(userMemory.facts || [])],
          people: [...(userMemory.people || [])],
          relationshipSummary: userMemory.relationshipSummary,
          appearanceNotes: userMemory.appearanceNotes,
          updatedAt: userMemory.updatedAt
        }
      : null,
    episodeStoreBefore: before
  }

  if (before.migratedFromLegacyAt && before.migratedFromLegacyAt > 0) {
    return {
      store: before,
      added: 0,
      skipped: 0,
      backup,
      alreadyMigrated: true
    }
  }

  writeBackup(backup)

  let store = before
  let added = 0
  let skipped = 0
  for (const c of candidatesFromUserMemory(userMemory)) {
    const prevN = store.episodes.length
    store = appendEpisode(store, c)
    if (store.episodes.length > prevN) added++
    else skipped++
  }

  store = {
    ...store,
    migratedFromLegacyAt: Date.now(),
    updatedAt: Date.now()
  }

  return { store, added, skipped, backup, alreadyMigrated: false }
}

/** Restore episode store from last migration backup (does not touch userMemory). */
export function restoreEpisodesFromMigrationBackup(): EpisodeStore | null {
  const b = readEpisodeMigrationBackup()
  if (!b?.episodeStoreBefore) return null
  return normalizeEpisodeStore(b.episodeStoreBefore)
}
