import { describe, expect, it } from 'vitest'
import {
  buildUserMemoryExtractMessages,
  filterKnownUserMemoryPatch,
  parseUserMemoryExtractJson,
  sanitizeUserMemoryExtract,
  shouldReviewUserMemoryText
} from './user-memory-llm'

describe('user-memory LLM review', () => {
  it('only schedules explicit, bounded memory statements', () => {
    expect(shouldReviewUserMemoryText('Me llamo Nahum y me gusta el café de olla.')).toBe(true)
    expect(shouldReviewUserMemoryText('Hola, ¿cómo estás?')).toBe(false)
    expect(shouldReviewUserMemoryText('*Me acerco y te abrazo.* Me gusta que me acaricies así.')).toBe(
      false
    )
    expect(shouldReviewUserMemoryText('x'.repeat(1201))).toBe(false)
  })

  it('asks for conservative JSON and parses fenced model output', () => {
    const messages = buildUserMemoryExtractMessages(
      'Mi meta es completar los bocetos de Michoacán.',
      'Hablábamos de ilustración.'
    )
    expect(messages[0].content).toMatch(/únicamente JSON válido/i)
    expect(messages[1].content).toMatch(/solo contexto/i)

    const parsed = parseUserMemoryExtractJson(
      '```json\n{"goals":["completar los bocetos de Michoacán"],"likes":[]}\n```'
    )
    expect(parsed.goals).toEqual(['completar los bocetos de Michoacán'])
    expect(parseUserMemoryExtractJson('no es json')).toEqual({})
  })

  it('keeps only fields grounded in direct user wording', () => {
    const text = 'Me llamo Nahum y me gusta el café de olla.'
    const patch = sanitizeUserMemoryExtract(
      {
        userName: 'Nahum',
        preferredName: 'Nahum',
        likes: ['café de olla', 'la astronomía'],
        facts: ['Vive en Morelia']
      },
      text
    )
    expect(patch.userName).toBe('Nahum')
    expect(patch.likes).toEqual(['café de olla'])
    expect(patch.facts).toBeUndefined()
  })

  it('does not turn a form of address or roleplay into durable likes', () => {
    const address = sanitizeUserMemoryExtract(
      { likes: ['que me llames Niamh'], preferredName: 'Niamh' },
      'Prefiero que me llames Niamh.'
    )
    expect(address.likes).toBeUndefined()
    expect(address.preferredName).toBe('Niamh')

    const scene = sanitizeUserMemoryExtract(
      { likes: ['el café'], userName: 'Nahum' },
      'En este roleplay me gusta el café y me llamo Nahum.'
    )
    expect(scene).toEqual({})
  })

  it('does not rewrite facts already captured by deterministic extraction', () => {
    const delta = filterKnownUserMemoryPatch(
      {
        userName: 'Nahum',
        likes: ['café', 'té'],
        facts: ['PIN:Vive en Morelia']
      },
      {
        userName: 'Nahum',
        likes: ['café'],
        facts: ['Vive en Morelia']
      }
    )
    expect(delta).toEqual({ likes: ['té'] })
  })
})
