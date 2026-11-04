import { describe, it, expect } from 'vitest'
import {
  mapSliceToFacts,
  reduceRollingSummary,
  appendRollingFromSlice,
  buildMapReduceReadingHint,
  emptyDocReadingState
} from './document-reading-state'

describe('document map-reduce (heuristic)', () => {
  it('maps names and dialogue from a slice', () => {
    const body =
      'Nahum caminó por Triria. «No cambies», dijo Ivanna. El palacio de mármol brillaba bajo la luna.'
    const mapped = mapSliceToFacts(body, ['Capítulo 11'])
    expect(mapped).toMatch(/Capítulo 11/)
    expect(mapped.toLowerCase()).toMatch(/nahum|ivanna|triria/)
  })

  it('reduce keeps newest content under cap', () => {
    const prev = '• A:\n  – viejo '.repeat(200)
    const next = mapSliceToFacts('Personaje Iris aparece sereno en el portal.', ['Cap 12'])
    const reduced = reduceRollingSummary(prev, next, 500)
    expect(reduced.length).toBeLessThanOrEqual(500)
    expect(reduced).toMatch(/Iris|Cap 12/)
  })

  it('appendRollingFromSlice uses map-reduce', () => {
    const s = appendRollingFromSlice(
      '',
      ['Intro'],
      'Lia y Ria hablaron de amor. Nahum escuchó en silencio.'
    )
    expect(s).toMatch(/Intro/)
    expect(s.length).toBeGreaterThan(20)
  })

  it('dedupes near-duplicate reduce lines', () => {
    const a = reduceRollingSummary(
      '• Cap 1:\n  – foo bar baz something long enough',
      '• Cap 1:\n  – foo bar baz something long enough'
    )
    expect(a.split('\n').filter((l) => l.startsWith('•')).length).toBe(1)
  })

  it('hint marks complete vs in-progress', () => {
    const st = emptyDocReadingState('c', 'libro.txt', 1000, 5)
    st.chapterIndex = 5
    expect(buildMapReduceReadingHint(st)).toMatch(/completa/i)
    st.chapterIndex = 1
    expect(buildMapReduceReadingHint(st)).toMatch(/MAP/)
  })
})
