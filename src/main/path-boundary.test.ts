/**
 * G1 — path boundary unit tests (main-process pure helpers).
 */
import { describe, it, expect } from 'vitest'
import {
  isPathInsideRoot,
  normalizeForCompare,
  assertPathAllowed
} from './path-boundary'

describe('G1 path-boundary', () => {
  it('accepts path inside root', () => {
    const root = process.platform === 'win32' ? 'C:\\\\Users\\\\App\\\\userData' : '/home/u/userData'
    const file = process.platform === 'win32' ? 'C:\\\\Users\\\\App\\\\userData\\\\a.txt' : '/home/u/userData/a.txt'
    expect(isPathInsideRoot(file, root)).toBe(true)
  })

  it('rejects sibling prefix (userData vs userData-extra)', () => {
    const root = process.platform === 'win32' ? 'C:\\\\Users\\\\App\\\\userData' : '/home/u/userData'
    const evil =
      process.platform === 'win32'
        ? 'C:\\\\Users\\\\App\\\\userData-extra\\\\x.txt'
        : '/home/u/userData-extra/x.txt'
    expect(isPathInsideRoot(evil, root)).toBe(false)
  })

  it('normalizeForCompare is stable', () => {
    const a = normalizeForCompare('/tmp/foo/../bar')
    const b = normalizeForCompare('/tmp/bar')
    expect(a).toBe(b)
  })

  it('assertPathAllowed denies outside roots', () => {
    const root = process.platform === 'win32' ? 'C:\\\\safe\\\\root' : '/safe/root'
    const outside = process.platform === 'win32' ? 'C:\\\\Windows\\\\System32' : '/etc/passwd'
    const r = assertPathAllowed(outside, root, [])
    expect(r.ok).toBe(false)
  })
})
