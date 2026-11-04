import { describe, it, expect } from 'vitest'
import {
  stitchContinuation,
  continuationTail,
  looksIncompleteAssistantText,
  extractContinueFragment,
  buildContinuedContent,
  recoverContinuedBubble,
  protectContinuedContent
} from './stitch-continuation'

describe('stitchContinuation', () => {
  it('completes mid-word without space', () => {
    const m = stitchContinuation('Me hace sentir como si fuera lo más importante del un', 'iverso...')
    expect(m).toContain('universo')
    expect(m).not.toMatch(/un iverso/)
  })
  it('dedupes overlapping tail', () => {
    const prior = 'Hola mundo. Segunda frase'
    const frag = 'Segunda frase y más'
    expect(stitchContinuation(prior, frag)).toBe('Hola mundo. Segunda frase y más')
  })
  it('continuationTail prefers end slice', () => {
    const long = 'A'.repeat(50) + '. Fin real aquí'
    expect(continuationTail(long, 30)).toMatch(/Fin real/)
  })
  it('detects incomplete', () => {
    expect(looksIncompleteAssistantText('texto cortado…')).toBe(true)
  })

  it('detects open ASCII quote cutoff', () => {
    expect(
      looksIncompleteAssistantText(
        'para mí, ser "la más linda...'
      )
    ).toBe(true)
  })
})

describe('continue module invariants (regression)', () => {
  const prior =
    'Me conmueve profundamente que no solo veas mi apariencia, sino también la manera en que te trato; para mí, ser "la más linda...'

  it('extractContinueFragment prefers pure stream acc', () => {
    const frag = extractContinueFragment(prior, {
      acc: '—Me quedo sin aliento por un instante.',
      metaContent: prior + '\n\n—Me quedo sin aliento por un instante.',
      visible: prior
    })
    expect(frag).toMatch(/Me quedo sin aliento/)
    expect(frag.startsWith(prior.slice(0, 20))).toBe(false)
  })

  it('buildContinuedContent always keeps prior as head', () => {
    const out = buildContinuedContent(
      prior,
      '—Me quedo sin aliento por un instante, sintiendo cómo mis ojos se humedecen.'
    )
    expect(out.startsWith(prior.slice(0, 40))).toBe(true)
    expect(out).toContain('Me quedo sin aliento')
    expect(out.length).toBeGreaterThan(prior.length)
  })

  it('buildContinuedContent recovers when visible already includes prior', () => {
    const painted =
      prior + '\n\n—Me quedo sin aliento por un instante.'
    const out = buildContinuedContent(prior, painted)
    expect(out.startsWith(prior.slice(0, 40))).toBe(true)
    expect(out).toContain('Me quedo sin aliento')
  })

  it('recoverContinuedBubble re-stitches naked fragment', () => {
    const r = recoverContinuedBubble(prior, '—Me quedo sin aliento por un instante.')
    expect(r.content.startsWith(prior.slice(0, 40))).toBe(true)
    expect(r.continuedOk).toBe(true)
  })

  it('recoverContinuedBubble keeps prior when no growth', () => {
    const r = recoverContinuedBubble(prior, prior)
    expect(r.content).toBe(prior)
    expect(r.continuedOk).toBe(false)
  })

  it('protectContinuedContent keeps stitched body while continuing', () => {
    const stitched = buildContinuedContent(prior, '—Me quedo sin aliento.')
    const protected_ = protectContinuedContent(stitched, '—Me quedo sin aliento.', true)
    expect(protected_).toBe(stitched)
  })

  it('protectContinuedContent allows normal non-continue updates', () => {
    const protected_ = protectContinuedContent('hola', 'hola mundo completo aquí con más texto', false)
    expect(protected_).toContain('hola mundo')
  })
})
