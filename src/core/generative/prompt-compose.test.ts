import { describe, expect, it } from 'vitest'
import { composeImagePrompt, parseImageIntent } from './prompt-compose'

describe('composeImagePrompt backend families', () => {
  it('uses narrative instructions for cloud image models', () => {
    const result = composeImagePrompt('una mujer pelirroja en una playa al atardecer', 'generic')

    expect(result.prompt).toContain('Professional photograph')
    expect(result.prompt).toContain('Hair is red')
    expect(result.negativePrompt).toContain('second person')
  })

  it('uses weighted SD tags for local Forge', () => {
    const result = composeImagePrompt('retrato de una mujer con ojos violetas', 'sd15')

    expect(result.prompt).toContain('(violet eyes:1.4)')
    expect(result.prompt).toContain('single person')
    expect(result.negativePrompt).toContain('multiple faces')
  })

  it('treats same-person scene prompts as identity-locked self portraits', () => {
    const intent = parseImageIntent('haz la misma persona pero en la playa')
    expect(intent.isSelf).toBe(true)
    const result = composeImagePrompt('haz la misma persona pero en la playa', 'sd15', {
      visualDescription: 'brown hair, green eyes',
      characterName: 'Kawaii'
    })
    expect(result.prompt).toMatch(/same person|consistent character identity|Kawaii/i)
  })

  it('frames outfit requests to show more than the face', () => {
    expect(parseImageIntent('ponle un vestido verde').framing).toBe('full')
    expect(parseImageIntent('ponle un vestido verde, primer plano').framing).toBe('portrait')
    expect(parseImageIntent('haz una foto tuya en la playa').framing).toBe('wide')
  })

  it('builds a dragon prompt without injecting a human portrait identity', () => {
    const result = composeImagePrompt('haz la foto de un dragón realista', 'sd15')

    expect(result.prompt).toMatch(/dragon/i)
    expect(result.prompt).toMatch(/scales|wings/i)
    expect(result.prompt).not.toMatch(/human female|single person|one face|portrait of/i)
    expect(result.negativePrompt).toMatch(/human face|human body|person/i)
    expect(result.negativePrompt).not.toMatch(/non-human/i)
  })

  it('preserves a specifically requested blonde woman without character locking', () => {
    const result = composeImagePrompt('haz una foto de una rubia de ojos azules', 'sd15')

    expect(result.prompt).toMatch(/adult woman/i)
    expect(result.prompt).toMatch(/blonde hair/i)
    expect(result.prompt).toMatch(/blue eyes/i)
    expect(result.prompt).not.toMatch(/same person as/i)
  })

  it('keeps a creature as the subject for cloud image backends too', () => {
    const result = composeImagePrompt('haz la foto de un dragón realista', 'cloud')

    expect(result.prompt).toMatch(/dragon/i)
    expect(result.prompt).toMatch(/photorealistic/i)
    expect(result.negativePrompt).toMatch(/human/i)
  })
})