/**
 * M1 — User-memory-only backup gate (localStorage).
 * Snapshot before clear; offer restore vs start fresh when memory is sparse + backup exists.
 */

import type { UserMemory } from './user-memory'
import { isUserMemorySparse } from './dual-memory'

const BACKUP_KEY = 'kawaii-user-memory-backup-v1'
const META_KEY = 'kawaii-user-memory-backup-meta'
const MAX_SNAPSHOTS = 5

export type UserMemoryBackupMeta = {
  at: number
  label?: string
  hasPreferredName?: boolean
  likesCount?: number
}

export type MemoryGateState =
  | { kind: 'none' }
  | { kind: 'offer-restore'; meta: UserMemoryBackupMeta }
  | { kind: 'start-fresh' }

function lsGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value)
  } catch {
    /* quota */
  }
}

function lsDel(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(key)
  } catch {
    /* */
  }
}

export type MemoryBackupRecord = {
  at: number
  memory: UserMemory
  label?: string
}

function readStack(): MemoryBackupRecord[] {
  const raw = lsGet(BACKUP_KEY)
  if (!raw) return []
  try {
    const j = JSON.parse(raw) as unknown
    if (!Array.isArray(j)) return []
    return j.filter(
      (x) => x && typeof x === 'object' && (x as MemoryBackupRecord).memory
    ) as MemoryBackupRecord[]
  } catch {
    return []
  }
}

function writeStack(stack: MemoryBackupRecord[]): void {
  lsSet(BACKUP_KEY, JSON.stringify(stack.slice(0, MAX_SNAPSHOTS)))
  const top = stack[0]
  if (top) {
    const meta: UserMemoryBackupMeta = {
      at: top.at,
      label: top.label,
      hasPreferredName: Boolean(top.memory?.preferredName),
      likesCount: top.memory?.likes?.length || 0
    }
    lsSet(META_KEY, JSON.stringify(meta))
  } else {
    lsDel(META_KEY)
  }
}

/** Snapshot current user memory before clear / destructive edit */
export function snapshotUserMemory(
  memory: UserMemory | null | undefined,
  label = 'before-clear'
): boolean {
  if (!memory || isUserMemorySparse(memory)) return false
  const stack = readStack()
  stack.unshift({
    at: Date.now(),
    memory: JSON.parse(JSON.stringify(memory)) as UserMemory,
    label
  })
  writeStack(stack)
  return true
}

export function hasUserMemoryBackup(): boolean {
  return readStack().length > 0
}

export function getLatestUserMemoryBackup(): MemoryBackupRecord | null {
  return readStack()[0] || null
}

export function getUserMemoryBackupMeta(): UserMemoryBackupMeta | null {
  const raw = lsGet(META_KEY)
  if (raw) {
    try {
      return JSON.parse(raw) as UserMemoryBackupMeta
    } catch {
      /* */
    }
  }
  const top = getLatestUserMemoryBackup()
  if (!top) return null
  return {
    at: top.at,
    label: top.label,
    hasPreferredName: Boolean(top.memory?.preferredName),
    likesCount: top.memory?.likes?.length || 0
  }
}

export function restoreLatestUserMemory(): UserMemory | null {
  const top = getLatestUserMemoryBackup()
  if (!top?.memory) return null
  return JSON.parse(JSON.stringify(top.memory)) as UserMemory
}

/** After user chooses "start fresh", keep backups but stop auto-offering until next clear */
export function acknowledgeMemoryGate(choice: 'restore' | 'fresh'): void {
  lsSet(
    'kawaii-user-memory-gate-ack',
    JSON.stringify({ choice, at: Date.now() })
  )
}

export function getMemoryGateAck(): { choice: string; at: number } | null {
  const raw = lsGet('kawaii-user-memory-gate-ack')
  if (!raw) return null
  try {
    return JSON.parse(raw) as { choice: string; at: number }
  } catch {
    return null
  }
}

/**
 * Whether UI/chat should offer restore vs start fresh.
 * True when user side is sparse, a backup exists, and user has not just chosen fresh after that backup.
 */
export function shouldOfferMemoryRestore(
  current: UserMemory | null | undefined
): boolean {
  if (!isUserMemorySparse(current)) return false
  if (!hasUserMemoryBackup()) return false
  const meta = getUserMemoryBackupMeta()
  const ack = getMemoryGateAck()
  if (ack?.choice === 'fresh' && meta && ack.at >= meta.at) return false
  if (ack?.choice === 'restore' && meta && ack.at >= meta.at) return false
  return true
}

export function evaluateMemoryGate(
  current: UserMemory | null | undefined
): MemoryGateState {
  if (!shouldOfferMemoryRestore(current)) return { kind: 'none' }
  const meta = getUserMemoryBackupMeta()
  if (!meta) return { kind: 'none' }
  return { kind: 'offer-restore', meta }
}
