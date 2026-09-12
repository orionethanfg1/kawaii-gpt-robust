import { describe, expect, it } from 'vitest'
import { composeImagePrompt } from './prompt-compose'

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
})