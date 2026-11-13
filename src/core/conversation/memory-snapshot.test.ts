import { describe, expect, it } from 'vitest'
import { createMemorySnapshot } from './memory-snapshot'

describe('createMemorySnapshot', () => {
  it('preserves every supplied source without mutating it', async () => {
    const sources = {
      userMemory: { likes: ['coffee'] },
      assistantMemory: { likes: ['astronomy'] },
      episodes: { episodes: [] }
    }

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
