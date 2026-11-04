import { describe, expect, it } from 'vitest'
import { applyDocumentTurnPath } from './turn-document-path'

describe('turn-document-path X2', () => {
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
})
