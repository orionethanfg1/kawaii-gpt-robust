import { describe, it, expect } from 'vitest'
import {
  detectCharacterPhotoIntent,
  buildCharacterPhotoOfferNudge
} from './wardrobe-classify'
import {
  setPendingCharacterPhotoOffer,
  takePendingCharacterPhotoOffer
} from './character-photo-offer'

describe('character photo offer', () => {
  it('detects «nueva foto de ti»', () => {
    const d = detectCharacterPhotoIntent(
      'Mira mi amor, ahora sí, esta es la nueva foto de ti'
    )
    expect(d.isCharacterPhoto).toBe(true)
  })

  it('nudge asks permission not assumes saved', () => {
    const n = buildCharacterPhotoOfferNudge({ characterName: 'Niamh' })
    expect(n).toMatch(/guardarropa/i)
    expect(n).toMatch(/principal/i)
    expect(n).toMatch(/NO digas que ya/i)
  })

  it('pending offer take once', () => {
    setPendingCharacterPhotoOffer({
      convId: 'c1',
      dataUrl: 'data:image/png;base64,xx'
    })
    expect(takePendingCharacterPhotoOffer('c1')?.dataUrl).toContain('data:image')
    expect(takePendingCharacterPhotoOffer('c1')).toBeNull()
  })
})
