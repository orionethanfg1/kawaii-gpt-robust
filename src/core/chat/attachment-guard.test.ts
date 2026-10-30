import { describe, it, expect } from 'vitest'
import {
  classifyAttachmentKind,
  partitionAttachments,
  buildUnsupportedMediaSystemHint
} from './attachment-guard'

describe('attachment-guard', () => {
  it('classifies image/doc/audio/video', () => {
    expect(classifyAttachmentKind({ mimeType: 'image/png' })).toBe('image')
    expect(classifyAttachmentKind({ name: 'a.mp3' })).toBe('audio')
    expect(classifyAttachmentKind({ name: 'a.mp4' })).toBe('video')
    expect(classifyAttachmentKind({ name: 'a.docx' })).toBe('document')
  })

  it('partition separates kinds', () => {
    const p = partitionAttachments([
      { mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,xx', name: 'x.jpg' },
      { mimeType: 'audio/mpeg', name: 'song.mp3' },
      { name: 'notes.txt', textContent: 'hola' }
    ])
    expect(p.images).toHaveLength(1)
    expect(p.audio).toHaveLength(1)
    expect(p.documents).toHaveLength(1)
  })

  it('builds honest unsupported hint', () => {
    const h = buildUnsupportedMediaSystemHint({ audio: 1, video: 1 })
    expect(h).toContain('ADJUNTO_NO_PROCESADO')
    expect(h).toMatch(/audio/i)
  })
})
