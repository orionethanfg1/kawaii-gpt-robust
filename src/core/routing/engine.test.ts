import { describe, it, expect } from 'vitest'
import { decideRoute } from './engine'
import type { RoutingContext } from './types'

const base: RoutingContext = {
  prompt: '',
  promptLength: 0,
  hasAttachments: false,
  localAvailable: true,
  cloudAvailable: true,
  webSearchEnabled: true,
  longPromptThreshold: 1500,
  localMaxTokens: 2048,
  cloudMaxTokens: 4096
}

describe('decideRoute', () => {
  it('routes web-intent prompts to web-augmented-cloud', () => {
    const decision = decideRoute({
      ...base,
      prompt: 'Busca noticias de IA de hoy',
      promptLength: 30
    })
    expect(decision.target).toBe('web-augmented-cloud')
    expect(decision.useWebSearch).toBe(true)
  })

  it('routes short prompts to local when available', () => {
    const decision = decideRoute({
      ...base,
      prompt: 'Hola, ¿cómo estás?',
      promptLength: 18
    })
    expect(decision.target).toBe('local')
  })

  it('routes long prompts to cloud', () => {
    const long = 'x'.repeat(2000)
    const decision = decideRoute({
      ...base,
      prompt: long,
      promptLength: long.length
    })
    expect(decision.target).toBe('cloud')
  })

  it('falls back to cloud when local is unavailable', () => {
    const decision = decideRoute({
      ...base,
      localAvailable: false,
      prompt: 'hola',
      promptLength: 4
    })
    expect(decision.target).toBe('cloud')
  })

  it('lowers temperature for coding prompts on local', () => {
    const decision = decideRoute({
      ...base,
      prompt: 'Escribe una función en TypeScript',
      promptLength: 40
    })
    expect(decision.target).toBe('local')
    expect(decision.temperature).toBeLessThan(0.5)
  })
})
