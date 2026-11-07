import { describe, expect, it } from 'vitest'
import {
  appendEpisode,
  selectEpisodesForTurn,
  formatEpisodesForPrompt,
  normalizeEpisodeStore
} from './memory-episodes'
import { migrateLegacyMemoryToEpisodes } from './memory-episodes-migrate'

describe('memory-episodes', () => {
  it('appends and dedupes', () => {
    let s = appendEpisode(null, { summary: 'Hablamos de Ivanna del libro.', tags: ['libro'], people: ['Ivanna'] })
    expect(s.episodes).toHaveLength(1)
    s = appendEpisode(s, { summary: 'Hablamos de Ivanna del libro.', tags: ['libro'] })
    expect(s.episodes).toHaveLength(1)
  })

  it('selects by person name', () => {
    const s = appendEpisode(null, {
      summary: 'Ivanna es personaje del libro del usuario.',
      tags: ['libro'],
      people: ['Ivanna']
    })
    const hit = selectEpisodesForTurn(s, '¿Recuerdas a Ivanna?', { max: 3 })
    expect(hit.length).toBeGreaterThan(0)
    expect(formatEpisodesForPrompt(hit)).toMatch(/Ivanna/)
  })

  it('migration does not clear user facts and is idempotent', () => {
    const mem = {
      facts: ['PIN:le gusta el café moka', 'Ivanna es la chica del libro'],
      people: [{ name: 'Ivanna', relation: 'personaje del libro' }],
      updatedAt: Date.now() - 1000
    }
    const r1 = migrateLegacyMemoryToEpisodes(mem as never, null)
    expect(r1.alreadyMigrated).toBe(false)
    expect(r1.added).toBeGreaterThan(0)
    expect(mem.facts).toHaveLength(2)
    const r2 = migrateLegacyMemoryToEpisodes(mem as never, r1.store)
    expect(r2.alreadyMigrated).toBe(true)
    expect(r2.added).toBe(0)
  })

  it('normalize drops junk', () => {
    const s = normalizeEpisodeStore({
      episodes: [
        { id: 'a', at: 1, summary: 'short', tags: [] },
        { id: 'b', at: 2, summary: 'Un recuerdo suficientemente largo y válido', tags: ['x'] }
      ]
    })
    expect(s.episodes).toHaveLength(1)
  })
})
