export const MIN_IMAGE_LONG_EDGE = 2048

export type ImageDimensions = {
  width: number
  height: number
}

export type ImageFraming = 'close' | 'half' | 'full' | 'wide'

function validDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1024
}

function roundToMultipleOfEight(value: number): number {
  return Math.max(256, Math.round(value / 8) * 8)
}

export function chooseImageCanvas(prompt: string, framing: ImageFraming): ImageDimensions {
  if (/\b(square|cuadrad[oa]|1:1)\b/i.test(prompt)) {
    return { width: 1024, height: 1024 }
  }
  if (/\b(16:9|panor[aá]mic[oa]|horizontal|landscape|apaisad[oa])\b/i.test(prompt)) {
    return { width: 1152, height: 648 }
  }
  if (/\b(9:16|vertical|portrait)\b/i.test(prompt)) {
    return { width: 648, height: 1152 }
  }

  if (framing === 'wide') return { width: 1152, height: 768 }
  if (framing === 'full') return { width: 768, height: 1152 }
  return { width: 768, height: 1024 }
}

export function minimum2kImageSize(width: number, height: number): ImageDimensions {
  const safeWidth = validDimension(width)
  const safeHeight = validDimension(height)
  const scale = MIN_IMAGE_LONG_EDGE / Math.max(safeWidth, safeHeight)

  return {
    width:
      safeWidth >= safeHeight
        ? MIN_IMAGE_LONG_EDGE
        : roundToMultipleOfEight(safeWidth * scale),
    height:
      safeHeight >= safeWidth
        ? MIN_IMAGE_LONG_EDGE
        : roundToMultipleOfEight(safeHeight * scale)
  }
}

export function fitImageWithin(
  width: number,
  height: number,
  maxLongEdge: number
): ImageDimensions {
  const safeWidth = validDimension(width)
  const safeHeight = validDimension(height)
  const maxEdge = Math.max(256, Math.floor(maxLongEdge / 8) * 8)
  const scale = Math.min(1, maxEdge / Math.max(safeWidth, safeHeight))

  return {
    width: roundToMultipleOfEight(safeWidth * scale),
    height: roundToMultipleOfEight(safeHeight * scale)
  }
}
