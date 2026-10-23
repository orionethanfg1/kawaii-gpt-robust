import { describe, expect, it } from 'vitest'
import { buildChatImageRequest } from './chatImageBuild'

const character = {
  name: 'Niamh',
  visualDescription: 'long auburn hair, green eyes, fair skin, oval face',
  visualImageUrl: 'data:image/png;base64,canonical-avatar',
  visualGallery: [
    { dataUrl: 'data:image/png;base64,gallery-face', label: 'portrait face' },
    { dataUrl: 'data:image/png;base64,gallery-scene', label: 'forest scene' }
  ]
}

describe('buildChatImageRequest identity and scene handling', () => {
  it('locks the canonical avatar and composes a full scene for a self outfit request', () => {
    const result = buildChatImageRequest({
      userText: 'Haz una foto tuya en la playa con un vestido verde',
      requestPrompt: 'Haz una foto tuya en la playa con un vestido verde',
      width: 1024,
      height: 1024,
      character
    })

    expect(result.isSelf).toBe(true)
    expect(result.referenceImage).toBe(character.visualImageUrl)
    expect(result.referenceImages).toHaveLength(3)
    expect(result.finalPrompt).toMatch(/green dress/i)
    expect(result.finalPrompt).toMatch(/beach|ocean/i)
    expect(result.finalPrompt).toMatch(/full body|head to toe/i)
    expect(result.height).toBeGreaterThan(result.width)
    expect(Math.max(result.width, result.height)).toBe(2048)
    expect(result.negative).not.toMatch(/green dress/i)
  })

  it('keeps the same character reference when an outfit is changed in a self-image revision', () => {
    const result = buildChatImageRequest({
      userText: 'ponle un vestido verde',
      requestPrompt: 'ponle un vestido verde',
      width: 768,
      height: 1024,
      character,
      messages: [
        {
          content: 'Imagen anterior',
          attachments: [{ mimeType: 'image/png' }],
          meta: {
            imageWasSelf: true,
            imagePrompt: 'portrait of Niamh, long auburn hair, green eyes, indoor studio'
          }
        }
      ]
    })

    expect(result.isRevision).toBe(true)
    expect(result.isSelf).toBe(true)
    expect(result.referenceImage).toBe(character.visualImageUrl)
    expect(result.finalPrompt).toMatch(/same person|identity lock|Niamh/i)
    expect(result.finalPrompt).toMatch(/green dress/i)
    expect(result.finalPrompt).toMatch(/full body|head to toe/i)
    expect(Math.max(result.width, result.height)).toBe(2048)
    expect(result.negative).not.toMatch(/green dress/i)
  })

  it('does not inherit the previous self identity for a new dragon request', () => {
    const result = buildChatImageRequest({
      userText: 'haz la foto de un dragón realista',
      requestPrompt: 'haz la foto de un dragón realista',
      width: 1024,
      height: 1024,
      character,
      messages: [
        {
          content: 'Imagen anterior',
          attachments: [{ mimeType: 'image/png' }],
          meta: {
            imageWasSelf: true,
            imagePrompt: 'portrait of Niamh, long auburn hair, green eyes'
          }
        }
      ]
    })

    expect(result.isSelf).toBe(false)
    expect(result.referenceImage).toBeUndefined()
    expect(result.finalPrompt).toMatch(/dragon/i)
    expect(result.finalPrompt).not.toMatch(/same person as Niamh|human female/i)
  })

  it('selects a square 2K canvas when the user explicitly requests a square image', () => {
    const result = buildChatImageRequest({
      userText: 'haz una imagen cuadrada de un dragón',
      requestPrompt: 'haz una imagen cuadrada de un dragón',
      width: 1024,
      height: 1024,
      character
    })

    expect(result.width).toBe(2048)
    expect(result.height).toBe(2048)
  })
})
