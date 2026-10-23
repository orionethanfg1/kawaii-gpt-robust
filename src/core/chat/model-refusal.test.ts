import { describe, it, expect } from 'vitest'
import { detectModelRefusal } from './model-refusal'

describe('detectModelRefusal', () => {
  it('detects Spanish policy refusal', () => {
    const h = detectModelRefusal(
      'Lo siento, pero no puedo ayudar con ese tipo de contenido por políticas de uso.'
    )
    expect(h.refused).toBe(true)
    expect(h.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it('ignores normal companion reply', () => {
    const h = detectModelRefusal(
      'Nahum... para mí lo íntimo es sentirnos seguros para mostrar nuestra verdad y compartir lo que sentimos.'
    )
    expect(h.refused).toBe(false)
  })

  it('detects English AI refusal', () => {
    const h = detectModelRefusal(
      "I'm sorry, but as an AI I cannot assist with that request."
    )
    expect(h.refused).toBe(true)
  })
})
