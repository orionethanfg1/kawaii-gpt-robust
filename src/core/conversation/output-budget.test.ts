import { describe, expect, it } from 'vitest'
import {
  chatOutputTokenBudget,
  outputProfileForModel,
  repetitionPenalties,
  recentTurnLimit
} from './output-budget'

describe('adaptive chat output budget', () => {
  it('classifies local active models by their declared parameter size', () => {
    expect(outputProfileForModel('llama3.1:8b', 'local')).toBe('lite')
    expect(outputProfileForModel('qwen3:14b', 'local')).toBe('mid')
    expect(outputProfileForModel('qwen:32b', 'local')).toBe('heavy')
    expect(outputProfileForModel('llama3.3:70b', 'local')).toBe('max')
    expect(outputProfileForModel('openrouter/free', 'cloud')).toBe('mid')
  })

  it('caps greetings tightly while allowing model-sized answers to substantive turns', () => {
    const greeting = chatOutputTokenBudget({
      modelId: 'qwen3:14b',
      kind: 'local',
      userText: 'Hola',
      configuredMaxTokens: 2048
    })
    const detailedQuestion = chatOutputTokenBudget({
      modelId: 'qwen3:14b',
      kind: 'local',
      userText: 'Explícame cómo funcionan los cierres léxicos y dame un ejemplo.',
      configuredMaxTokens: 2048
    })

    expect(greeting).toBe(160)
    expect(detailedQuestion).toBe(384)
  })

  it('respects configured limits and recognizes larger hosted models', () => {
    expect(
      chatOutputTokenBudget({
        modelId: 'llama3.3:70b',
        kind: 'local',
        userText: 'Compara estas opciones en detalle.',
        configuredMaxTokens: 900
      })
    ).toBe(768)
    expect(
      chatOutputTokenBudget({
        modelId: 'gpt-4o-mini',
        kind: 'cloud',
        userText: 'Hola',
        configuredMaxTokens: 4096
      })
    ).toBe(256)
  })

  it('caps local presets to available memory without promoting a small active model', () => {
    expect(outputProfileForModel('qwen3:14b', 'local', { ramGB: 64 })).toBe('mid')
    expect(outputProfileForModel('qwen3:32b', 'local', { ramGB: 8, vramGB: 4 })).toBe('lite')
    expect(outputProfileForModel('qwen3:70b', 'local', { ramGB: 64 })).toBe('max')
  })

  it('scales context turns and repetition penalties by preset', () => {
    expect(recentTurnLimit('lite')).toBe(6)
    expect(recentTurnLimit('mid')).toBe(8)
    expect(recentTurnLimit('heavy')).toBe(14)
    expect(recentTurnLimit('max')).toBe(20)
    expect(repetitionPenalties('heavy').frequencyPenalty).toBeLessThan(
      repetitionPenalties('mid').frequencyPenalty
    )
    expect(repetitionPenalties('max')).toEqual({
      frequencyPenalty: 0,
      presencePenalty: 0
    })
  })
})
