import { describe, it, expect } from 'vitest'
import { detectGenerativeIntent } from './intent'
import { looksLikeImageRevision } from './image-revision'

describe('image intent must not fire on emotional chat', () => {
  it('rejects relationship message with "no me gusta"', () => {
    const t =
      'Date cuenta que, si estoy contigo es por una razón importante, realmente estoy contigo porque te quiero, no me gusta jugar con los sentimientos de otros ni con los míos. Si te pregunto esas cosas, aún si en algún momento, me permitieras tener más relaciones con otras chicas, tu importancia y mi cariño hacia ti no disminuirían ni un poco.'
    expect(detectGenerativeIntent(t).modality).toBe('text')
    expect(looksLikeImageRevision(t)).toBe(false)
  })

  it('accepts explicit image request', () => {
    expect(detectGenerativeIntent('Genera una imagen de dos personas abrazándose').modality).toBe(
      'image'
    )
  })

  it('accepts explicit revision', () => {
    expect(looksLikeImageRevision('Cambia la imagen: pon el fondo azul')).toBe(true)
  })

  it('does not regenerate on analyze/describe', () => {
    expect(looksLikeImageRevision('puedes analizar la foto que generaste?')).toBe(false)
    expect(detectGenerativeIntent('puedes analizar la foto que generaste?').modality).toBe(
      'text'
    )
    expect(detectGenerativeIntent('Puedes describirte físicamente?').modality).toBe('text')
  })

  it('accepts send me your photo', () => {
    expect(detectGenerativeIntent('Puedes enviarme una foto tuya?').modality).toBe('image')
  })
})
