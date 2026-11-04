import { describe, expect, it } from 'vitest'
import {
  detectAppContinueKind,
  buildAppContinueTurnTexts,
  splitVisibleAndThinking
} from './turn-stream-helpers'

describe('turn-stream-helpers X3', () => {
  it('detects app-continue kinds', () => {
    expect(detectAppContinueKind('app-continue', 'x')).toBe('app-continue')
    expect(detectAppContinueKind('app-doc-continue', 'x')).toBe('app-doc-continue')
    expect(detectAppContinueKind(undefined, '[APP] continuar la respuesta')).toBe('app-continue')
  })

  it('buildAppContinueTurnTexts avoids robotic pause for app-continue', () => {
    const t = buildAppContinueTurnTexts('app-continue', 'sigue escribiendo')
    expect(t.turnUserText).toMatch(/Continúa exactamente/)
    expect(t.turnExtraSystem).toMatch(/INSTRUCCIÓN DE LA APP/)
    expect(t.turnUserText).not.toMatch(/en curso\.\)$/)
  })

  it('splitVisibleAndThinking returns visible string', () => {
    const s = splitVisibleAndThinking('Hola mundo')
    expect(s.visible).toMatch(/Hola/)
  })
})
