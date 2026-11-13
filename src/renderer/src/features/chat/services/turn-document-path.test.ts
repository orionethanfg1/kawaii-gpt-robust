import { afterEach, describe, expect, it, vi } from 'vitest'
import * as documentAttach from '@core/chat/document-attach'
import { applyDocumentTurnPath } from './turn-document-path'

describe('turn-document-path X2', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns extraSystem unchanged when no docs/settings', async () => {
    const out = await applyDocumentTurnPath({
      convId: 'test-conv',
      trimmed: 'hola',
      attachments: [],
      settings: {},
      getMessages: () => [],
      extraSystem: 'BASE'
    })
    expect(out).toContain('BASE')
  })

  it('does not scan or hydrate old document attachments during unrelated chat', async () => {
    const hydrate = vi.spyOn(documentAttach, 'hydrateAttachmentTextsFromDisk')
    const messages = vi.fn(() => [
      {
        role: 'user',
        attachments: [
          {
            name: 'novela.pdf',
            filePath: 'C:\\books\\novela.pdf',
            mimeType: 'application/pdf',
            textContent: 'contenido previamente extraído'
          }
        ]
      }
    ])

    const out = await applyDocumentTurnPath({
      convId: 'casual-chat',
      trimmed: 'Sí mi amor, aquí estoy.',
      settings: {},
      getMessages: messages,
      extraSystem: 'BASE'
    })

    expect(out).toBe('BASE')
    expect(messages).not.toHaveBeenCalled()
    expect(hydrate).not.toHaveBeenCalled()
  })

  it('does not interpret a bare "sigue" as a document request without active reading', async () => {
    const hydrate = vi.spyOn(documentAttach, 'hydrateAttachmentTextsFromDisk')
    const messages = vi.fn(() => [])

    const out = await applyDocumentTurnPath({
      convId: 'no-active-reading',
      trimmed: 'sigue',
      settings: {},
      getMessages: messages,
      extraSystem: 'BASE'
    })

    expect(out).toBe('BASE')
    expect(messages).not.toHaveBeenCalled()
    expect(hydrate).not.toHaveBeenCalled()
  })
})
