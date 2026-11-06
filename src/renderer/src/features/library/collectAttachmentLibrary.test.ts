import { describe, expect, it } from 'vitest'
import { collectAttachmentLibrary, filterLibraryItems } from './collectAttachmentLibrary'

describe('collectAttachmentLibrary', () => {
  it('collects user docs and generated images', () => {
    const items = collectAttachmentLibrary([
      {
        id: 'c1',
        title: 'Prueba',
        messages: [
          {
            role: 'user',
            attachments: [
              { id: 'a1', name: 'libro.pdf', mimeType: 'application/pdf', filePath: '/x/libro.pdf' }
            ]
          },
          {
            role: 'assistant',
            meta: { imageFilePath: '/y/out.png' }
          }
        ]
      }
    ])
    expect(items.some((i) => i.kind === 'doc' && i.name === 'libro.pdf')).toBe(true)
    expect(items.some((i) => i.kind === 'gen')).toBe(true)
  })

  it('filters by query and kind', () => {
    const items = collectAttachmentLibrary([
      {
        id: 'c1',
        title: 'Chat A',
        messages: [
          {
            role: 'user',
            attachments: [
              { name: 'foto.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,xx' },
              { name: 'notas.txt', mimeType: 'text/plain', textContent: 'hola' }
            ]
          }
        ]
      }
    ])
    expect(filterLibraryItems(items, 'docs', '').every((i) => i.kind === 'doc')).toBe(true)
    expect(filterLibraryItems(items, 'all', 'foto').some((i) => i.name.includes('foto'))).toBe(true)
  })
})
