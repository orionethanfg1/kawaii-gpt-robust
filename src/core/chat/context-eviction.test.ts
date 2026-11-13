import { describe, it, expect } from 'vitest'
import {
  classifyContextTurn,
  shouldInjectFullDocument,
  buildEvictedDocMemoryBlock,
  stripHeavyDocSystemMessages,
  stripDocumentTurnsFromHistory,
  stripImagePayloadsFromMessages,
  budgetForContextTurn
} from './context-eviction'
import type { DocReadingState } from './document-reading-state'

describe('context-eviction', () => {
  it('vision wins over open doc state', () => {
    const k = classifyContextTurn({
      userText: 'mira esta foto',
      hasImageThisTurn: true,
      hasDocReadingState: true
    })
    expect(k).toBe('vision')
    expect(shouldInjectFullDocument(k)).toBe(false)
  })

  it('continuar lectura → doc_active', () => {
    const k = classifyContextTurn({
      userText: 'continuar lectura',
      hasDocReadingState: true
    })
    expect(k).toBe('doc_active')
    expect(shouldInjectFullDocument(k)).toBe(true)
  })

  it('keeps unrelated chat general when a document reading state exists', () => {
    const k = classifyContextTurn({
      userText: 'qué tal tu día?',
      hasDocReadingState: true
    })
    expect(k).toBe('general')
    expect(shouldInjectFullDocument(k)).toBe(false)
  })

  it('memory block has no full chapter body', () => {
    const st = {
      key: 'k',
      convId: 'c',
      fileName: 'Libro.docx',
      totalChars: 10000,
      chapterCount: 12,
      chapterIndex: 10,
      readTitles: ['Capítulo 9', 'Capítulo 10'],
      rollingSummary: 'El gato y la luna…',
      updatedAt: Date.now()
    } as DocReadingState
    const b = buildEvictedDocMemoryBlock([st])
    expect(b).toContain('MEMORIA_DOCUMENTO')
    expect(b).toContain('Libro.docx')
    expect(b).not.toContain('[LECTURA_PROGRESIVA]')
  })

  it('strips heavy doc system messages', () => {
    const out = stripHeavyDocSystemMessages([
      { role: 'system', content: 'persona ok' },
      { role: 'system', content: '[LECTURA_PROGRESIVA]\ntexto enorme' },
      { role: 'system', content: '[VISION] foto' }
    ])
    expect(out).toHaveLength(2)
    expect(out.some((m) => String(m.content).includes('LECTURA'))).toBe(false)
  })

  it('omits old document app instructions and their large assistant excerpts from later turns', () => {
    const history = [
      { role: 'user' as const, content: 'Lee el siguiente capítulo.' },
      {
        role: 'system' as const,
        content:
          '[INSTRUCCIÓN DE LA APP — no es un mensaje del usuario]\nContinúa la lectura del documento adjunto.'
      },
      { role: 'assistant' as const, content: 'x'.repeat(800) },
      { role: 'assistant' as const, content: 'y'.repeat(800) },
      { role: 'user' as const, content: 'Sí mi amor, aquí estoy.' },
      { role: 'assistant' as const, content: 'Me alegra que estés aquí.' }
    ]

    expect(stripDocumentTurnsFromHistory(history)).toEqual([
      history[0],
      history[4],
      history[5]
    ])
  })

  it('keeps short assistant replies after a document instruction', () => {
    const shortReply = { role: 'assistant' as const, content: 'Claro, sigo leyendo.' }
    expect(
      stripDocumentTurnsFromHistory([
        {
          role: 'system',
          content: '[INSTRUCCIÓN DE LA APP] Continúa la lectura del documento adjunto.'
        },
        shortReply
      ])
    ).toEqual([shortReply])
  })

  it('strips image_url from history multimodal messages', () => {
    const out = stripImagePayloadsFromMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'mira' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,xxx' } }
        ]
      }
    ])
    const c = out[0].content as Array<{ type: string; text?: string }>
    expect(c.some((p) => p.type === 'image_url')).toBe(false)
    expect(c.some((p) => p.type === 'text' && /omitida/i.test(p.text || ''))).toBe(true)
  })

  it('budget tighter for vision', () => {
    const b = budgetForContextTurn('vision', { maxChars: 50_000, keepRecentMessages: 20 })
    expect(b.maxChars).toBeLessThanOrEqual(12_000)
    expect(b.keepRecentMessages).toBeLessThanOrEqual(6)
  })
})
