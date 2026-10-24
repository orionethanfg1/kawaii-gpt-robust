import { describe, it, expect } from 'vitest'
import {
  extractUserMood,
  extractAssistantMood,
  mergeMoodEntry,
  formatRelativeTime,
  buildMoodPromptBlock,
  isMoodExpired,
  activeMoods
} from './mood-memory'

describe('B2b mood-memory', () => {
  it('extracts user mood with at', () => {
    const m = extractUserMood('Hoy me siento un poco triste por el trabajo', 1_700_000_000_000)
    expect(m).toBeTruthy()
    expect(m!.source).toBe('user')
    expect(m!.at).toBe(1_700_000_000_000)
    expect(m!.text.toLowerCase()).toMatch(/triste|siento/)
  })

  it('extracts assistant mood', () => {
    const m = extractAssistantMood('Me siento tranquila pensando en ti.')
    expect(m).toBeTruthy()
    expect(m!.source).toBe('assistant')
  })

  it('expires old entries', () => {
    const old = {
      text: 'me siento mal',
      at: Date.now() - 100 * 3600000,
      expiresAt: Date.now() - 1000,
      source: 'user' as const
    }
    expect(isMoodExpired(old)).toBe(true)
    expect(activeMoods([old])).toHaveLength(0)
  })

  it('formatRelativeTime uses honest labels', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 120000, now)).toMatch(/minuto/)
    expect(formatRelativeTime(now - 26 * 3600000, now)).toMatch(/ayer|días/)
  })

  it('prompt never invents time without entry', () => {
    const p = buildMoodPromptBlock(undefined, undefined, { userText: 'hola' })
    expect(p).toBe('')
  })

  it('merge keeps newest', () => {
    const a = extractUserMood('me siento bien', 100)!
    const b = extractUserMood('me siento mal', 200)!
    const list = mergeMoodEntry([a], b)
    expect(list[0].text).toMatch(/mal|siento/)
  })
})
