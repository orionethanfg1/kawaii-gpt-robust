import { describe, expect, it } from 'vitest'
import { isDocumentProgressTurn } from './turn-route-and-model'

describe('turn-route-and-model X4', () => {
  it('detects APP document continue as sticky', () => {
    expect(
      isDocumentProgressTurn('c1', '[APP] Continuar la lectura del documento adjunto')
    ).toBe(true)
  })

  it('does not force sticky on normal chat', () => {
    expect(isDocumentProgressTurn('c1', 'hola cómo estás')).toBe(false)
  })
})
