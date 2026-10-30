import { describe, expect, it } from 'vitest'
import { FULL_BACKUP_FORMAT, FULL_BACKUP_VERSION, isFullBackupManifest } from './full-backup'

describe('full-backup manifest', () => {
  it('validates format', () => {
    expect(
      isFullBackupManifest({
        format: FULL_BACKUP_FORMAT,
        version: FULL_BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        parts: ['manifest.json']
      })
    ).toBe(true)
    expect(isFullBackupManifest({ format: 'nope', version: 1 })).toBe(false)
  })
})
