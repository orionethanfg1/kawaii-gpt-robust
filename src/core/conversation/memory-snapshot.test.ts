import { describe, expect, it } from 'vitest'
import { createMemorySnapshot, analyzeMemorySnapshot, verifyMemorySnapshot, previewMemoryImport } from './memory-snapshot'

describe('createMemorySnapshot', () => {
  it('preserves every supplied source without mutating it', async () => {
    const sources = {
      userMemory: { likes: ['coffee'] },
      assistantMemory: { likes: ['astronomy'] },
      episodes: { episodes: [] }
    }
    const original = JSON.parse(JSON.stringify(sources))

    const snapshot = await createMemorySnapshot({
      appVersion: 'test',
      createdAt: 123,
      sources
    })

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      appVersion: 'test',
      createdAt: 123,
      sources
    })
    expect(sources).toEqual(original) // no mutation
    expect(sources.userMemory.likes).toEqual(['coffee'])
  })

  it('adds a stable-format SHA-256 digest when Web Crypto is available', async () => {
    const snapshot = await createMemorySnapshot({
      appVersion: 'test',
      createdAt: 123,
      sources: { userMemory: { likes: ['coffee'] } }
    })

    if (typeof crypto !== 'undefined' && crypto.subtle) {
      expect(snapshot.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })
})

describe('analyzeMemorySnapshot', () => {
  it('reports duplicates without mutating', async () => {
    const snapshot = await createMemorySnapshot({
      appVersion: 'test',
      sources: {
        userMemory: {
          likes: ['coffee', 'coffee', 'tea'],
          facts: ['I like coffee', 'I like coffee']
        }
      }
    })
    const before = JSON.stringify(snapshot)
    const analysis = analyzeMemorySnapshot(snapshot)
    expect(analysis.hasDuplicates).toBe(true)
    expect(analysis.issues.some((i) => i.kind === 'duplicate')).toBe(true)
    expect(JSON.stringify(snapshot)).toBe(before) // no mutation
  })
})

describe('verifyMemorySnapshot', () => {
  it('accepts a fresh snapshot', async () => {
    const snapshot = await createMemorySnapshot({
      appVersion: 'test',
      sources: { userMemory: { likes: ['ok'] } }
    })
    const result = await verifyMemorySnapshot(snapshot)
    expect(result.ok).toBe(true)
  })

  it('rejects hash mismatch', async () => {
    const snapshot = await createMemorySnapshot({
      appVersion: 'test',
      sources: { userMemory: { likes: ['ok'] } }
    })
    if (snapshot.sha256) snapshot.sha256 = '0'.repeat(64)
    const result = await verifyMemorySnapshot(snapshot)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('hash mismatch')
  })
})

describe('previewMemoryImport', () => {
  it('rejects invalid snapshot and leaves current intact', async () => {
    const current = { userMemory: { likes: ['tea'] } }
    const original = JSON.parse(JSON.stringify(current))
    const bad = await createMemorySnapshot({ appVersion: 't', sources: { userMemory: { likes: ['bad'] } } })
    if (bad.sha256) bad.sha256 = 'deadbeef'.repeat(8)
    const preview = await previewMemoryImport(current, bad)
    expect(preview.ok).toBe(false)
    expect(preview.proposedSources).toEqual(original)
    expect(current).toEqual(original)
  })

  it('proposes replacements for differing sources without mutating inputs', async () => {
    const current = { userMemory: { likes: ['tea'] }, episodes: [] }
    const originalCurrent = JSON.parse(JSON.stringify(current))
    const snapshot = await createMemorySnapshot({
      appVersion: 'test',
      sources: { userMemory: { likes: ['coffee', 'tea'] }, episodes: [{ id: 1 }] }
    })
    const originalSnap = JSON.parse(JSON.stringify(snapshot))

    const preview = await previewMemoryImport(current, snapshot)

    expect(preview.ok).toBe(true)
    expect(preview.changes.some((c) => c.source === 'userMemory' && c.action === 'replace')).toBe(true)
    expect(preview.proposedSources.userMemory).toEqual({ likes: ['coffee', 'tea'] })
    expect(preview.proposedSources.episodes).toEqual([{ id: 1 }])
    // no mutation of inputs
    expect(current).toEqual(originalCurrent)
    expect(JSON.stringify(snapshot)).toBe(JSON.stringify(originalSnap))
  })

  it('skips identical sources', async () => {
    const current = { userMemory: { likes: ['ok'] } }
    const snapshot = await createMemorySnapshot({ appVersion: 't', sources: { userMemory: { likes: ['ok'] } } })
    const preview = await previewMemoryImport(current, snapshot)
    expect(preview.ok).toBe(true)
    expect(preview.changes.every((c) => c.action === 'skip')).toBe(true)
    expect(preview.proposedSources).toEqual(current)
  })
})


describe('applyMemoryImport', () => {
  it('refuses without confirm and does not mutate current', async () => {
    const { applyMemoryImport, createMemorySnapshot } = await import('./memory-snapshot')
    const current = { userMemory: { likes: ['a'] } }
    const snap = await createMemorySnapshot({
      appVersion: 't',
      sources: { userMemory: { likes: ['b'] } }
    })
    const before = JSON.stringify(current)
    const res = await applyMemoryImport(current, snap, { confirm: false })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/confirm/i)
    expect(JSON.stringify(current)).toBe(before)
    expect(res.appliedSources).toEqual(current)
  })

  it('applies proposed sources only with confirm and deep-clones', async () => {
    const { applyMemoryImport, createMemorySnapshot, previewMemoryImport } = await import(
      './memory-snapshot'
    )
    const current = { userMemory: { likes: ['a'] }, other: { x: 1 } }
    const snap = await createMemorySnapshot({
      appVersion: 't',
      sources: { userMemory: { likes: ['b'] } }
    })
    const preview = await previewMemoryImport(current, snap)
    expect(preview.ok).toBe(true)
    const res = await applyMemoryImport(current, snap, { confirm: true, preview })
    expect(res.ok).toBe(true)
    expect(res.appliedSources.userMemory).toEqual({ likes: ['b'] })
    expect(res.appliedSources.other).toEqual({ x: 1 })
    // inputs untouched
    expect(current.userMemory).toEqual({ likes: ['a'] })
    // not same reference as preview
    expect(res.appliedSources).not.toBe(preview.proposedSources)
  })
})
