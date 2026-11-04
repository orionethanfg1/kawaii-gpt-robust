import { describe, expect, it } from 'vitest'
import {
  buildImageReactionFallback,
  buildImageReactionSystemPrompt,
  sanitizeImageReactionText,
  craftImageReactionWithLlm
} from './image-reaction'

describe('image-reaction I3', () => {
  it('fallback is self-aware', () => {
    const f = buildImageReactionFallback({
      userText: 'foto tuya',
      isSelf: true,
      characterName: 'Niamh'
    })
    expect(f.toLowerCase()).toMatch(/aquí me tienes|foto/)
    expect(f).toMatch(/cambiar/)
  })

  it('system prompt forbids robotic opener', () => {
    const s = buildImageReactionSystemPrompt({
      userText: 'selfie en la playa',
      isSelf: true,
      characterName: 'Niamh'
    })
    expect(s).toMatch(/Niamh/)
    expect(s).toMatch(/1–3 frases|1-3 frases/i)
    expect(s.toLowerCase()).toMatch(/prohibido/)
  })

  it('sanitize drops sd dumps and short noise', () => {
    expect(sanitizeImageReactionText('masterpiece, best quality, red hair')).toBe('')
    expect(sanitizeImageReactionText('ok')).toBe('')
    expect(sanitizeImageReactionText('  ¿Te gusta cómo quedó la luz?  ')).toMatch(/luz/)
  })

  it('craft uses llm text and falls back on timeout', async () => {
    const ok = await craftImageReactionWithLlm(
      { userText: 'foto tuya en el sofá', isSelf: true, characterName: 'Niamh' },
      async () => 'Mira… me senté en el sofá pensando en ti. ¿Te gusta?',
      2000
    )
    expect(ok.source).toBe('llm')
    expect(ok.content).toMatch(/sofá|ti/i)

    const fb = await craftImageReactionWithLlm(
      { userText: 'foto', isSelf: false },
      async () => {
        await new Promise((r) => setTimeout(r, 50))
        return 'tardío'
      },
      15
    )
    expect(fb.source).toBe('fallback')
    expect(fb.content.length).toBeGreaterThan(10)
  })
})
