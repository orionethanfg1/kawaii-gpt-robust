import { describe, expect, it, beforeEach } from 'vitest'
import {
  recordMemoryWrite,
  getMemoryWriteLog,
  clearMemoryWriteLog,
  memoryWriteLogHasSample,
  getLastMemoryWrite,
  clipSamples
} from './memory-write-log'

describe('memory-write-log', () => {
  beforeEach(() => clearMemoryWriteLog())

  it('records user write with samples', () => {
    recordMemoryWrite({
      side: 'user',
      reason: 'turn-extract',
      fields: { likes: 2, favorites: 1 },
      samples: clipSamples({
        likes: ['café moka', 'cappuccino'],
        favorites: ['bebida: café moka']
      }),
      persistOk: true
    })
    const log = getMemoryWriteLog()
    expect(log.length).toBe(1)
    expect(log[0].side).toBe('user')
    expect(log[0].fields.likes).toBe(2)
    expect(memoryWriteLogHasSample('user', 'likes', /moka/i)).toBe(true)
    expect(getLastMemoryWrite('user')?.reason).toBe('turn-extract')
  })

  it('records failed persist', () => {
    recordMemoryWrite({
      side: 'assistant',
      reason: 'collector',
      fields: { likes: 1 },
      persistOk: false,
      error: 'quota'
    })
    expect(getLastMemoryWrite('assistant')?.persistOk).toBe(false)
  })
})
