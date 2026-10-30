/**
 * Full app backup (B1) — portable folder the user can copy.
 */
export const FULL_BACKUP_FORMAT = 'kawaii-full-backup'
export const FULL_BACKUP_VERSION = 1

export type FullBackupManifest = {
  format: typeof FULL_BACKUP_FORMAT
  version: number
  appVersion?: string
  createdAt: string
  label?: string
  parts: string[]
  wardrobeFiles?: number
  notes?: string[]
}

export function isFullBackupManifest(x: unknown): x is FullBackupManifest {
  if (!x || typeof x !== 'object') return false
  const m = x as FullBackupManifest
  return m.format === FULL_BACKUP_FORMAT && typeof m.version === 'number'
}
