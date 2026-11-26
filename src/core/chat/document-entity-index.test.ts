import { describe, it, expect } from 'vitest'
import {
  extractEntitiesFromSlice,
  mergeDocEntityIndex,
  buildDocEntityPromptBlock,
  emptyDocEntityIndex
} from './document-entity-index'
import { markSliceRead, emptyDocReadingState, buildRollingReadingBlock } from './document-reading-state'

describe('D1 document entity index', () => {
  it('extracts characters and drops Pues', () => {
    const body =
      'Pues la noche cayó. Iris miró a Nahum. «Espera», dijo Nahum con calma.'
    const { characters } = extractEntitiesFromSlice(body, ['Cap 1'])
    const names = characters.map((c) => c.name)
    expect(names.some((n) => /Iris/i.test(n))).toBe(true)
    expect(names.some((n) => /Nahum/i.test(n))).toBe(true)
    expect(names.some((n) => /^Pues$/i.test(n))).toBe(false)
  })

  it('merges mentions across slices without losing early names', () => {
    let idx = emptyDocEntityIndex()
    idx = mergeDocEntityIndex(idx, {
      sliceBody: 'Iris caminó hacia el bosque. Nahum la esperaba.',
      chapterTitles: ['Uno']
    })
    idx = mergeDocEntityIndex(idx, {
      sliceBody: 'Más tarde Iris encontró a Sera en la plaza.',
      chapterTitles: ['Dos']
    })
    const names = idx.characters.map((c) => c.name)
    expect(names).toEqual(expect.arrayContaining(['Iris', 'Nahum', 'Sera']))
    const iris = idx.characters.find((c) => c.name === 'Iris')
    expect((iris?.mentions || 0) >= 2).toBe(true)
  })

  it('markSliceRead embeds entityIndex on state', () => {
    const base = emptyDocReadingState('k', 'c1', 'libro.md', 1000)
    const next = markSliceRead(base, {
      chapterIndex: 1,
      lastChapterIndex: 0,
      titles: ['Cap A'],
      sliceBody: 'Iris saludó a Nahum junto al río.'
    })
    expect((next.entityIndex?.characters.length || 0) >= 1).toBe(true)
    const block = buildRollingReadingBlock(next)
    expect(block).toMatch(/ELENCO_DOCUMENTO|Iris|Nahum/)
  })

  it('buildDocEntityPromptBlock lists roster', () => {
    const idx = mergeDocEntityIndex(null, {
      sliceBody: 'Iris y Nahum cruzaron el valle.',
      chapterTitles: ['III']
    })
    const prompt = buildDocEntityPromptBlock(idx)
    expect(prompt).toMatch(/ELENCO_DOCUMENTO/)
    expect(prompt).toMatch(/Iris/)
  })
})
