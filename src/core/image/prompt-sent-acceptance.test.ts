
/**
 * Step 6 — acceptance tests on the *composed prompt that would be sent*,
 * not only on parsed tags.
 */
import { describe, it, expect } from 'vitest'
import { applySceneForceToPrompts } from './scene-force'
import { parseSceneSpecFromText, sceneSpecToSdFragments } from './scene-spec'
import { composeImagePrompt, parseImageIntent } from '@core/generative/prompt-compose'
import { looksLikeRegenerate } from '@core/generative/image-revision'

describe('prompt enviado (aceptación Hito 3)', () => {
  it('cuerpo entero: prompt final starts with full-body emphasis and anti close-up negative', () => {
    const user = 'haz una foto de cuerpo entero de una chica hermosa de ojos azules'
    const intent = parseImageIntent(user)
    expect(intent.framing).toBe('full')
    const composed = composeImagePrompt(user, 'sd15', { useCharacter: false })
    const forced = applySceneForceToPrompts(composed.prompt, composed.negativePrompt, user)
    const pos = forced.prompt.toLowerCase()
    const neg = forced.negative.toLowerCase()
    // Early tokens matter — scene force prepends
    expect(pos.indexOf('full body')).toBeGreaterThanOrEqual(0)
    expect(pos.indexOf('full body')).toBeLessThan(120)
    expect(neg).toMatch(/close-up|headshot|cropped legs|missing feet/)
    expect(forced.major).toBe(true)
  })

  it('catsuit blanco de noche en parque: outfit + night + env in sent prompt', () => {
    const user =
      'haz una foto de una chica hermosa en un catsuit blanco de noche en un parque. Ella tiene ojos azules.'
    const composed = composeImagePrompt(user, 'sd15', { useCharacter: false })
    const forced = applySceneForceToPrompts(composed.prompt, composed.negativePrompt, user)
    const pos = forced.prompt.toLowerCase()
    const neg = forced.negative.toLowerCase()
    expect(pos).toMatch(/catsuit/)
    expect(pos).toMatch(/white|blanco/)
    expect(pos).toMatch(/night|noche/)
    // park/city street from environment heuristics
    expect(pos).toMatch(/park|parque|city|street|forest|beach|night/)
    expect(neg).toMatch(/green dress|daylight|nude|bare shoulders/)
    // catsuit tags should appear before weak generic portrait noise if present
    const catAt = pos.indexOf('catsuit')
    expect(catAt).toBeGreaterThanOrEqual(0)
    expect(catAt).toBeLessThan(200)
  })

  it('self vestido azul: scene force keeps dress weight; identity intent isSelf', () => {
    const user = 'foto tuya con un vestido azul'
    const intent = parseImageIntent(user)
    expect(intent.isSelf).toBe(true)
    const scene = parseSceneSpecFromText(user)
    expect(scene.clothing.some((c) => c.color === 'blue' || c.garment === 'dress')).toBe(true)
    const frag = sceneSpecToSdFragments(scene)
    const forced = applySceneForceToPrompts(
      frag.positive.join(', '),
      frag.negative.join(', '),
      user,
      scene
    )
    expect(forced.prompt.toLowerCase()).toMatch(/dress|vestido|blue/)
  })

  it('regenerate does not require image nouns', () => {
    expect(looksLikeRegenerate('haz otro intento')).toBe(true)
    expect(looksLikeRegenerate('regenerar por favor')).toBe(true)
  })
})

describe('classifyClearDataIntent', () => {
  // imported dynamically to avoid circular deps in some runners
  it('distinguishes export vs archive vs active', async () => {
    const { classifyClearDataIntent } = await import('@core/feedback')
    expect(classifyClearDataIntent('limpia los informes exportados')).toBe('exports_only')
    expect(classifyClearDataIntent('borra los archivos de feedback')).toBe('feedback_archives')
    expect(classifyClearDataIntent('vacía los likes activos del chat')).toBe('feedback_active')
    expect(classifyClearDataIntent('limpia todo el feedback para los tests')).toBe('feedback_all')
    expect(classifyClearDataIntent('hola qué tal')).toBe('none')
  })
})
