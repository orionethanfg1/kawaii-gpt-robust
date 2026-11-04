
import { describe, it, expect } from 'vitest'
import {
  buildMultimodalUserContent,
  chatContentCharLen,
  asChatMessageUser
} from './vision-attach'

describe('vision multimodal', () => {
  it('embeds image_url parts for dataUrl attachments', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const r = buildMultimodalUserContent('mira esta foto', [
      { name: 'x.png', mimeType: 'image/png', dataUrl }
    ])
    expect(r.imageCount).toBe(1)
    expect(Array.isArray(r.content)).toBe(true)
    const parts = r.content as Array<{ type: string }>
    expect(parts.some((p) => p.type === 'image_url')).toBe(true)
    expect(parts.some((p) => p.type === 'text')).toBe(true)
    expect(r.ollamaImages.length).toBe(1)
  })

  it('stays string without images', () => {
    const r = buildMultimodalUserContent('hola', [])
    expect(r.content).toBe('hola')
    expect(r.imageCount).toBe(0)
  })

  it('asChatMessageUser sets images for ollama', () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQ'
    const m = asChatMessageUser('opina', [
      { mimeType: 'image/jpeg', dataUrl }
    ])
    expect(m.role).toBe('user')
    expect(m.images?.length).toBe(1)
  })

  it('chatContentCharLen counts text + image proxy', () => {
    expect(chatContentCharLen('abc')).toBe(3)
    expect(
      chatContentCharLen([
        { type: 'text', text: 'hi' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } }
      ])
    ).toBe(2 + 500)
  })
})
