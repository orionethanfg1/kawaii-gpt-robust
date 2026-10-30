import { describe, expect, it } from 'vitest'
import { applySceneForceToPrompts } from './scene-force'

describe('scene-force', () => {
  it('does not ban the requested green dress', () => {
    const result = applySceneForceToPrompts(
      'photorealistic woman',
      '',
      'ponle un vestido verde'
    )

    expect(result.prompt).toMatch(/green dress/i)
    expect(result.negative).not.toMatch(/green dress/i)
    expect(result.major).toBe(true)
  })

  it('keeps the requested night scene from inheriting daylight defaults', () => {
    const result = applySceneForceToPrompts(
      'photorealistic woman',
      '',
      'misma persona en la playa de noche'
    )

    expect(result.prompt).toMatch(/night/i)
    expect(result.negative).toMatch(/daylight portrait/i)
  })
})
