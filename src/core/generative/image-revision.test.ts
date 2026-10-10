import { describe, it, expect } from 'vitest'
import {
  looksLikeImageRevision,
  shouldForceImageRevision,
  parseRevisionDeltas,
  reviseImagePrompt,
  isNonImageOperationalCommand
} from './image-revision'

describe('image-revision 3.3', () => {
  it('does not treat rename as revision', () => {
    expect(isNonImageOperationalCommand('renombra el chat a prueba')).toBe(true)
    expect(looksLikeImageRevision('renombra el chat', true)).toBe(false)
  })

  it('detects short NL edits', () => {
    expect(shouldForceImageRevision('hazla más joven', true)).toBe(true)
    expect(looksLikeImageRevision('cambia el fondo de la foto', true)).toBe(true)
  })

  it('detects same-person scene revisions', () => {
    expect(looksLikeImageRevision('haz la misma persona pero en la playa', true)).toBe(true)
    expect(shouldForceImageRevision('mismo personaje en la playa', true)).toBe(true)
    const r = reviseImagePrompt(
      { prompt: 'portrait in office', seed: 99, wasSelf: false },
      'haz la misma persona pero en la playa',
      { characterName: 'Kawaii', characterLook: 'brown hair' }
    )
    expect(r.prompt).toMatch(/Kawaii|same person|consistent identity/i)
    expect(r.prompt).toMatch(/beach|ocean/i)
  })

  it('parses hair and scene deltas', () => {
    const d = parseRevisionDeltas('ponle el pelo rubio y otro fondo en la playa')
    expect(d.tags.some((t) => /blonde|hair/i.test(t))).toBe(true)
    expect(d.changeLevel).toBe('major')
  })

  it('keeps identity lock and soft seed', () => {
    const r = reviseImagePrompt(
      {
        prompt: 'portrait, brown hair, cafe interior',
        seed: 42,
        wasSelf: true
      },
      'hazla más joven',
      { characterLook: 'long brown hair, green eyes', characterName: 'Kawaii' }
    )
    expect(r.prompt).toMatch(/identity lock|Kawaii|same person/i)
    expect(r.prompt).toMatch(/younger|youthful/i)
    expect(r.seed).toBe(42)
    expect(r.changeLevel).toBe('soft')
  })

  it('major scene drops seed', () => {
    const r = reviseImagePrompt(
      { prompt: 'portrait in office', seed: 99, wasSelf: true },
      'cámbiame el fondo a la playa',
      { characterName: 'Kawaii', characterLook: 'brown hair' }
    )
    expect(r.changeLevel).toBe('major')
    expect(r.seed).toBeUndefined()
    expect(r.prompt).toMatch(/beach|ocean/i)
  })
})
