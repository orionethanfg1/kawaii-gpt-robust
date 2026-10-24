import { describe, it, expect } from 'vitest'
import {
  appendEpisode,
  selectEpisodesForTurn,
  formatEpisodesForPrompt,
  scoreEpisode
} from './memory-episodes'
import { pickArchiveLinesForTurn, formatArchiveLinesForPrompt } from './memory-archive-retrieve'

describe('memory-episodes E3', () => {
  it('appends and dedupes episodes', () => {
    let s = appendEpisode(null, {
      summary: 'Primera cercanía íntima compartida con Niamh.',
      tags: ['intimacy', 'first']
    })
    s = appendEpisode(s, {
      summary: 'Primera cercanía íntima compartida con Niamh.',
      tags: ['intimacy']
    })
    expect(s.episodes.length).toBe(1)
  })

  it('retrieves by keyword when user asks to remember', () => {
    const s = appendEpisode(null, {
      summary: 'El usuario te llama Mi princesa Celta en el chat íntimo.',
      tags: ['nickname', 'princesa', 'celta']
    })
    const picked = selectEpisodesForTurn(s, '¿Recuerdas cuando te decía princesa celta?', {
      max: 2
    })
    expect(picked.length).toBeGreaterThan(0)
    expect(formatEpisodesForPrompt(picked)).toMatch(/EPISODIOS/)
  })

  it('scores higher with tag overlap', () => {
    const ep = {
      id: '1',
      at: Date.now(),
      summary: 'Leímos juntos el capítulo del bosque.',
      tags: ['documento', 'bosque']
    }
    expect(scoreEpisode(ep, 'el bosque del libro')).toBeGreaterThan(
      scoreEpisode(ep, 'xyz')
    )
  })
})

describe('memory-archive-retrieve', () => {
  it('picks relevant likes from archive blob', () => {
    const lines = pickArchiveLinesForTurn(
      {
        data: {
          user: { likes: ['café de olla', 'astronomía', 'ajedrez'] },
          assistant: { preferredNames: ['Mi princesa Celta'] }
        }
      },
      '¿Te acuerdas que me gusta el café?'
    )
    expect(lines.some((l) => /café/i.test(l))).toBe(true)
    expect(formatArchiveLinesForPrompt(lines)).toMatch(/ARCHIVO/)
  })
})
