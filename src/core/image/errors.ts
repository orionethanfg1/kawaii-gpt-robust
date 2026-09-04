import type { ImageErrorCode } from './types'

export class ImageGenError extends Error {
  readonly code: ImageErrorCode
  readonly provider?: string
  readonly retryable: boolean

  constructor(options: {
    code: ImageErrorCode
    message: string
    provider?: string
    retryable?: boolean
    cause?: unknown
  }) {
    super(options.message)
    this.name = 'ImageGenError'
    this.code = options.code
    this.provider = options.provider
    this.retryable = options.retryable ?? false
    if (options.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
  }

  static fromUnknown(err: unknown, provider?: string): ImageGenError {
    if (err instanceof ImageGenError) return err
    if (err instanceof Error) {
      if (err.name === 'AbortError' || err.message.includes('aborted')) {
        return new ImageGenError({
          code: 'IMAGE_CANCELLED',
          message: 'Generación cancelada',
          provider,
          retryable: false,
          cause: err
        })
      }
      return classifyImageError(err.message, provider)
    }
    return new ImageGenError({
      code: 'IMAGE_UNKNOWN',
      message: String(err),
      provider,
      retryable: false
    })
  }
}

export function classifyImageError(message: string, provider?: string): ImageGenError {
  const lower = message.toLowerCase()
  if (lower.includes('abort') || lower.includes('cancel')) {
    return new ImageGenError({
      code: 'IMAGE_CANCELLED',
      message,
      provider,
      retryable: false
    })
  }
  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many')
  ) {
    return new ImageGenError({
      code: 'IMAGE_RATE_LIMIT',
      message: 'Límite de peticiones del proveedor de imágenes. Espera un momento.',
      provider,
      retryable: true
    })
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return new ImageGenError({
      code: 'IMAGE_TIMEOUT',
      message: 'Tiempo agotado generando la imagen',
      provider,
      retryable: true
    })
  }
  if (
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused')
  ) {
    return new ImageGenError({
      code: 'IMAGE_NETWORK',
      message: 'No hay conexión con el generador de imágenes',
      provider,
      retryable: true
    })
  }
  if (lower.includes('prompt') && lower.includes('empty')) {
    return new ImageGenError({
      code: 'IMAGE_INVALID_PROMPT',
      message: 'El prompt de imagen está vacío',
      provider,
      retryable: false
    })
  }
  return new ImageGenError({
    code: 'IMAGE_UNKNOWN',
    message,
    provider,
    retryable: false
  })
}
