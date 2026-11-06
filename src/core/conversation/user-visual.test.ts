import { describe, expect, it } from 'vitest'
import {
  wantsUserAppearanceVision,
  selectUserVisualRefs,
  buildUserAppearanceVisionTurnHint
} from './user-visual'

describe('user appearance vision', () => {
  it('detects appearance questions', () => {
    expect(wantsUserAppearanceVision('¿cómo me ves?')).toBe(true)
    expect(wantsUserAppearanceVision('qué tal mi físico')).toBe(true)
    expect(wantsUserAppearanceVision('hola qué tal')).toBe(false)
  })

  it('selects face+body', () => {
    const refs = selectUserVisualRefs({
      visualGallery: [
        { dataUrl: 'data:image/png;base64,a', role: 'face' },
        { dataUrl: 'data:image/png;base64,b', role: 'body' },
        { dataUrl: 'data:image/png;base64,c', role: 'scene' }
      ]
    })
    expect(refs).toHaveLength(2)
  })

  it('builds vision turn hint with True/False protocol', () => {
    const h = buildUserAppearanceVisionTurnHint(true)
    expect(h).toMatch(/IDENTIDAD_VISUAL/)
    expect(h).toMatch(/True/)
  })
})
