import { describe, it, expect } from 'vitest'
import {
  buildIdentityProfile,
  stripOutfitFromAppearance,
  identityProfileToPromptBits,
  appearanceToIdentityTags
} from './identity-profile'
import { parseOutfitSpecFromText, outfitSpecToPromptBits } from './outfit-spec'
import { composeLayeredImagePrompt } from './layered-prompt'

describe('I0 identity-profile', () => {
  it('strips outfit noise from appearance', () => {
    const s = stripOutfitFromAppearance('red hair, blue eyes, wearing a blue dress, soft smile')
    expect(s).toMatch(/red hair/i)
    expect(s).toMatch(/blue eyes/i)
    expect(s.toLowerCase()).not.toMatch(/blue dress/)
  })

  it('builds profile without locking turn clothing', () => {
    const p = buildIdentityProfile({
      character: {
        name: 'Niamh',
        tagline: '',
        personality: '',
        style: '',
        visualEmoji: '1',
        traits: [],
        visualDescription: 'long red hair, green eyes, wearing black jacket'
      }
    })
    expect(p.canonicalName).toBe('Niamh')
    expect(p.appearanceSummary.toLowerCase()).not.toMatch(/jacket/)
    expect(p.lockedFields).toContain('face')
  })

  it('strips broken Spanish variant/outfit slots from meta-style prose', () => {
    const raw =
      'Niamh es una joven de notable belleza, caracterizada por su cabello rojo largo. En una variante, viste un . En otra, luce un , y su rostro, que a menudo muestra una sonrisa, tiene una expresión serena. En ambas versiones, destaca por su forma facial distintiva y suele usar joyas como un collar y aretes dorados.'
    const s = stripOutfitFromAppearance(raw)
    expect(s.toLowerCase()).not.toMatch(/viste un/)
    expect(s.toLowerCase()).not.toMatch(/luce un/)
    expect(s.toLowerCase()).not.toMatch(/collar/)
    expect(s.toLowerCase()).not.toMatch(/aretes/)
    expect(s).toMatch(/cabello rojo|rojo largo|belleza|rostro|sonrisa|expresión|facial/i)
  })

})


  it('maps Spanish prose to compact EN tags', () => {
    const tags = appearanceToIdentityTags(
      'Niamh es una joven de notable belleza, caracterizada por su cabello rojo largo. destaca por su forma facial distintiva'
    )
    expect(tags.join(' ')).toMatch(/red hair/i)
    const bits = identityProfileToPromptBits(
      buildIdentityProfile({
        character: {
          name: 'Niamh',
          tagline: '',
          personality: '',
          style: '',
          visualEmoji: '',
          traits: [],
          visualDescription:
            'Niamh es una joven de notable belleza, caracterizada por su cabello rojo largo. En una variante, viste un .'
        }
      })
    )
    const joined = bits.join(' ')
    expect(joined.toLowerCase()).not.toMatch(/notable belleza/)
    expect(joined).toMatch(/red hair/i)
  })

describe('I0 outfit-spec', () => {
  it('parses blue dress for this turn only', () => {
    const o = parseOutfitSpecFromText('foto tuya con un vestido azul')
    expect(o.source).toBe('user_turn')
    expect(o.items.some((i) => i.garment === 'dress' && i.color === 'blue')).toBe(true)
    const bits = outfitSpecToPromptBits(o)
    expect(bits.join(' ')).toMatch(/blue dress/i)
  })

  it('returns empty when no clothing', () => {
    const o = parseOutfitSpecFromText('foto tuya en la playa')
    expect(o.items.length).toBe(0)
    expect(o.source).toBe('none')
  })
})

describe('I1 layered-prompt', () => {
  it('keeps identity and outfit in separate layers', () => {
    const identity = buildIdentityProfile({
      character: {
        name: 'Niamh',
        tagline: '',
        personality: '',
        style: '',
        visualEmoji: '',
        traits: [],
        visualDescription: 'long curly red hair, violet eyes'
      }
    })
    const r = composeLayeredImagePrompt({
      userText: 'foto tuya con un vestido azul en la playa',
      identity,
      useIdentity: true
    })
    expect(r.isSelf).toBe(true)
    expect(r.layers.outfit.join(' ')).toMatch(/dress/i)
    expect(r.layers.identity.join(' ')).toMatch(/Niamh/)
    expect(r.layers.identity.join(' ').toLowerCase()).not.toMatch(/blue dress/)
    expect(r.positive).toMatch(/beach|ocean|playa|environmental|blue/i)
    expect(r.negative).toMatch(/different person|identity mismatch/i)
  })

  it('does not force identity on dragon request', () => {
    const identity = buildIdentityProfile({
      character: {
        name: 'Niamh',
        tagline: '',
        personality: '',
        style: '',
        visualEmoji: '',
        traits: [],
        visualDescription: 'red hair'
      }
    })
    const r = composeLayeredImagePrompt({
      userText: 'haz la foto de un dragon rojo',
      identity,
      useIdentity: true
    })
    expect(r.scene.isSelf).toBe(false)
    expect(r.layers.identity.length).toBe(0)
  })
})
