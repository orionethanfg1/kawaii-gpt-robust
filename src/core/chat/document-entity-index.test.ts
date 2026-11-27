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

describe('D2 resolveDocEntityGrounding', () => {
  it('rebuilds roster from full text when index empty', async () => {
    const { resolveDocEntityGrounding, emptyDocEntityIndex } = await import('./document-entity-index')
    const full =
      'Capítulo 1\n\nIris caminó hacia Nahum. «Hola», dijo Nahum.\n\n' +
      'Capítulo 2\n\nSera apareció en la puerta y miró a Iris.'
    const r = resolveDocEntityGrounding({
      userText: 'nombra los personajes',
      index: emptyDocEntityIndex(),
      fullText: full,
      fileName: 'novela.md'
    })
    expect(r.rebuilt).toBe(true)
    expect(r.index.characters.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Iris', 'Nahum'])
    )
    expect(r.promptBlock).toMatch(/ELENCO_DOCUMENTO|PRIORIDAD_ELENCO/)
    expect(r.emptyHonest).toBe(false)
  })

  it('honest empty when no index and no text on character ask', async () => {
    const { resolveDocEntityGrounding } = await import('./document-entity-index')
    const r = resolveDocEntityGrounding({
      userText: 'nombra los personajes',
      index: null,
      fullText: '',
      fileName: 'x.md'
    })
    expect(r.emptyHonest).toBe(true)
    expect(r.promptBlock).toMatch(/No hay un roster|no inventes/i)
  })

  it('prefers existing index without rebuild', async () => {
    const { resolveDocEntityGrounding, mergeDocEntityIndex } = await import('./document-entity-index')
    const idx = mergeDocEntityIndex(null, {
      sliceBody: 'Kael levantó la espada ante Mira.',
      chapterTitles: ['X']
    })
    const r = resolveDocEntityGrounding({
      userText: 'quiénes son los protagonistas',
      index: idx,
      fullText: 'texto enorme que no debería hacer falta Iris Nahum Sera'
    })
    expect(r.rebuilt).toBe(false)
    expect(r.promptBlock).toMatch(/Kael|Mira/)
  })
})
