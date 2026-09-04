import { describe, it, expect } from 'vitest'
import {
  conversationsToJson,
  parseImportJson,
  conversationToMarkdown
} from './exportImport'
import type { Conversation } from '@core/conversation'

const sample: Conversation = {
  id: 'conv_test',
  title: 'Prueba',
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { id: 'm1', role: 'user', content: 'Hola', createdAt: 1 },
    { id: 'm2', role: 'assistant', content: '¡Hola!', createdAt: 2 }
  ]
}

describe('exportImport', () => {
  it('round-trips JSON', () => {
    const json = conversationsToJson([sample])
    const parsed = parseImportJson(json)
    expect(parsed.ok).toBe(true)
    expect(parsed.conversations[0].title).toBe('Prueba')
    expect(parsed.conversations[0].messages).toHaveLength(2)
  })

  it('rejects garbage', () => {
    const parsed = parseImportJson('{ "foo": 1 }')
    expect(parsed.ok).toBe(false)
  })

  it('builds markdown', () => {
    const md = conversationToMarkdown(sample)
    expect(md).toContain('# Prueba')
    expect(md).toContain('Usuario')
    expect(md).toContain('Hola')
  })
})
