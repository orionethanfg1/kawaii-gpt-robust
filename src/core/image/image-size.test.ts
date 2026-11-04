import { describe, expect, it } from 'vitest'
import { chooseImageCanvas, fitImageWithin, minimum2kImageSize } from './image-size'

describe('image canvas sizing', () => {
  it.each([
    ['foto cuadrada', 'full', 1024, 1024],
    ['foto panorámica', 'close', 1152, 648],
    ['imagen vertical', 'wide', 648, 1152],
    ['una persona de cuerpo completo', 'full', 768, 1152],
    ['un dragón en una montaña', 'wide', 1152, 768]
  ] as const)('chooses a %s canvas from its request and framing', (prompt, framing, width, height) => {
    expect(chooseImageCanvas(prompt, framing)).toEqual({ width, height })
  })

  it.each([
    [768, 1152, 1368, 2048],
    [1152, 768, 2048, 1368],
    [1024, 1024, 2048, 2048]
  ])('scales %ix%i to a 2K canvas without changing orientation', (w, h, expectedW, expectedH) => {
    expect(minimum2kImageSize(w, h)).toEqual({ width: expectedW, height: expectedH })
  })

  it('uses safe portrait dimensions when the requested size is invalid', () => {
    expect(minimum2kImageSize(Number.NaN, 0)).toEqual({ width: 2048, height: 2048 })
  })

  it('preserves aspect ratio when fitting a canvas within a provider limit', () => {
    expect(fitImageWithin(1368, 2048, 1280)).toEqual({ width: 856, height: 1280 })
  })
})
