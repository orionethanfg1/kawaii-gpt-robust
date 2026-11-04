import { describe, expect, it } from 'vitest'
import { buildCharacterSystemPrompt, DEFAULT_CHARACTER } from './profile'

describe('character system prompt', () => {
  it('keeps the operational personality compact and avoids repeating it', () => {
    const prompt = buildCharacterSystemPrompt(DEFAULT_CHARACTER)
    const personality = DEFAULT_CHARACTER.personality.slice(0, 360)
    const matches = prompt.split(personality).length - 1

    expect(matches).toBe(1)
    expect(prompt).toContain('A un saludo o confirmación breve, responde en 2–4 frases.')
    expect(prompt).not.toContain('local 7–14B')
    expect(prompt.split('\n').length).toBeLessThanOrEqual(15)
  })

  it('bounds custom personality and style fields and keeps no more than three traits', () => {
    const prompt = buildCharacterSystemPrompt({
      ...DEFAULT_CHARACTER,
      personality: 'p'.repeat(500),
      style: 's'.repeat(300),
      traits: ['uno', 'dos', 'tres', 'cuatro']
    })

    expect(prompt).toContain(`Personalidad: ${'p'.repeat(360)}`)
    expect(prompt).toContain(`Estilo: ${'s'.repeat(180)}`)
    expect(prompt).toContain('Rasgos: uno, dos, tres')
    expect(prompt).not.toContain('cuatro')
  })
})
