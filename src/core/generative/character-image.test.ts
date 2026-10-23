import { describe, expect, it } from 'vitest'
import { buildCharacterImageReference } from './character-image'

describe('buildCharacterImageReference', () => {
  it('keeps canonical traits and gallery scene notes together', () => {
    const result = buildCharacterImageReference({
      name: 'Niamh',
      tagline: '',
      personality: '',
      style: '',
      visualEmoji: '',
      visualImageUrl: 'data:image/png;base64,abc',
      visualDescription: 'cabello rojo largo, ojos verdes, piel clara, rostro ovalado',
      visualGallery: [{ id: '1', dataUrl: 'data:image/png;base64,abc', scene: 'vestido azul' }],
      traits: []
    }, { includeReferenceImage: true })

    expect(result.prompt).toContain('cabello rojo largo')
    expect(result.prompt).toContain('vestido azul')
    expect(result.referenceImage).toContain('data:image/png')
    expect(result.negativePrompt).toContain('different person')
  })
})