import { describe, expect, it } from 'vitest'
import { isHostToolIntent } from './host-tool-intent'
import { buildHostModeSystemPrompt } from '../character/profile'

describe('chat and host prompt separation', () => {
  it('only selects host mode for explicit app control or diagnostics', () => {
    expect(isHostToolIntent('Revisa Ollama')).toBe(true)
    expect(isHostToolIntent('Haz un autodiagnóstico completo')).toBe(true)
    expect(isHostToolIntent('Hola')).toBe(false)
    expect(isHostToolIntent('Me gusta Ollama, es rápido')).toBe(false)
  })

  it('keeps the host prompt short and free of relationship/personality context', () => {
    const prompt = buildHostModeSystemPrompt('Kawaii')
    expect(prompt).toContain('Kawaii')
    expect(prompt).toContain('resultados')
    expect(prompt).not.toContain('relación')
    expect(prompt).not.toContain('apariencia')
  })
})
