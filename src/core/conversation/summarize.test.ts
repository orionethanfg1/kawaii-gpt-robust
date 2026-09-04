import { describe, it, expect } from 'vitest'
import { shouldSummarize, summarizeConversation } from './summarize'
import type { ChatMessage, ChatProvider, ChatCompletionResult } from '@core/providers'

function mockProvider(content: string): ChatProvider {
  return {
    id: 'mock',
    kind: 'openai-compatible',
    displayName: 'Mock',
    healthCheck: async () => ({ ok: true }),
    listModels: async () => [],
    chat: async (): Promise<ChatCompletionResult> => ({
      content,
      model: 'mock-model'
    }),
    chatStream: async () => ({ content, model: 'mock-model' })
  }
}

describe('shouldSummarize', () => {
  it('triggers when older turns exceed min', () => {
    expect(shouldSummarize(20, 8, 6)).toBe(true)
    expect(shouldSummarize(10, 8, 6)).toBe(false)
  })
})

describe('summarizeConversation', () => {
  it('uses model output when available', async () => {
    const older: ChatMessage[] = [
      { role: 'user', content: 'Quiero aprender Rust' },
      { role: 'assistant', content: 'Empieza por el libro oficial' },
      { role: 'user', content: '¿Y ownership?' },
      { role: 'assistant', content: 'Es el sistema de préstamos' }
    ]
    const result = await summarizeConversation({
      provider: mockProvider(
        'El usuario quiere aprender Rust; se habló de ownership y el libro oficial.'
      ),
      model: 'mock-model',
      older
    })
    expect(result.source).toBe('model')
    expect(result.summary.toLowerCase()).toContain('rust')
  })

  it('falls back to heuristic when model returns empty', async () => {
    const older: ChatMessage[] = [
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: 'Hola' }
    ]
    const result = await summarizeConversation({
      provider: mockProvider(''),
      model: 'mock-model',
      older
    })
    expect(result.source).toBe('heuristic')
    expect(result.summary.length).toBeGreaterThan(0)
  })
})
