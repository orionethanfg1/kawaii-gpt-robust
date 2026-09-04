/**
 * Typed error system for predictable recovery strategies.
 */

export type ErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_QUOTA'
  | 'PROVIDER_MODEL_NOT_FOUND'
  | 'PROVIDER_RATE_LIMIT'
  | 'NETWORK_ERROR'
  | 'STREAM_ABORTED'
  | 'INVALID_SETTINGS'
  | 'CONTEXT_OVERFLOW'
  | 'UNKNOWN'

export interface AppErrorOptions {
  code: ErrorCode
  message: string
  provider?: string
  retryable?: boolean
  cause?: unknown
  meta?: Record<string, unknown>
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly provider?: string
  readonly retryable: boolean
  readonly meta: Record<string, unknown>
  readonly cause?: unknown

  constructor(options: AppErrorOptions) {
    super(options.message)
    this.name = 'AppError'
    this.code = options.code
    this.provider = options.provider
    this.retryable = options.retryable ?? false
    this.meta = options.meta ?? {}
    this.cause = options.cause
  }

  static fromUnknown(err: unknown, fallbackCode: ErrorCode = 'UNKNOWN'): AppError {
    if (err instanceof AppError) return err
    if (err instanceof Error) {
      return new AppError({
        code: fallbackCode,
        message: err.message,
        cause: err,
        retryable: false
      })
    }
    return new AppError({
      code: fallbackCode,
      message: String(err),
      retryable: false
    })
  }
}

/** Extract human message from provider JSON blobs */
export function extractProviderMessage(raw: string): string {
  const text = (raw || '').trim()
  if (!text) return 'Error desconocido del proveedor'
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; code?: string } | string
      message?: string
    }
    if (typeof parsed.error === 'object' && parsed.error?.message) {
      return parsed.error.message
    }
    if (typeof parsed.error === 'string') return parsed.error
    if (typeof parsed.message === 'string') return parsed.message
  } catch {
    // not JSON — try nested JSON inside text
    const m = text.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/)
    if (m?.[1]) {
      try {
        return JSON.parse(`"${m[1]}"`) as string
      } catch {
        return m[1]
      }
    }
  }
  return text.length > 280 ? text.slice(0, 277) + '…' : text
}

export function friendlyProviderMessage(
  code: ErrorCode | string,
  rawMessage: string,
  provider?: string
): string {
  const detail = extractProviderMessage(rawMessage)
  const lower = detail.toLowerCase()
  const who = provider ? ` (${provider})` : ''

  // Prefer rich multi-provider summaries from the orchestrator
  if (
    /intentos:/i.test(detail) ||
    /cloud no disponible/i.test(detail) ||
    /ningún proveedor cloud activo/i.test(detail)
  ) {
    return detail.length > 360 ? detail.slice(0, 357) + '…' : detail
  }

  if (code === 'PROVIDER_AUTH') {
    return `API key inválida o vacía${who}. Ajustes → Cloud: pega la key y marca el proveedor como Activo.`
  }
  if (code === 'PROVIDER_RATE_LIMIT') {
    return `Límite de peticiones${who}. Espera 1–2 min, prueba OpenRouter free u otro proveedor activo.`
  }
  if (code === 'PROVIDER_QUOTA') {
    return `Cuota agotada${who}. Cambia a openrouter/free u otro free, o espera el reinicio de cuota.`
  }
  if (code === 'PROVIDER_MODEL_NOT_FOUND') {
    return `Modelo no disponible o no free${who}. En Ajustes usa openrouter/free, llama-3.1-8b-instant (Groq) o un modelo Ollama instalado.`
  }
  if (code === 'PROVIDER_TIMEOUT') {
    return `Tiempo de espera agotado${who}. Puede ser red lenta, VPN o el proveedor saturado. Reintenta o cambia de proveedor.`
  }
  if (code === 'NETWORK_ERROR') {
    return `Problema de conexión${who}. Comprueba Internet/Wi‑Fi, desactiva VPN un momento y reintenta. Si hay descargas grandes (Ollama/Forge), espera a que bajen un poco.`
  }
  if (code === 'PROVIDER_UNAVAILABLE') {
    if (/ollama|local/i.test(provider || '') || /ollama/i.test(detail)) {
      return `Ollama no responde${who}. Inicia Ollama o usa modo cloud mientras descargas modelos. Si el modelo aún se está bajando, espera a que termine.`
    }
    return `Proveedor no respondió${who}. Causas frecuentes: sin Internet, key incorrecta, proveedor en cooldown, modelo incorrecto o todos los free saturados. Revisa Ajustes → Cloud (Activo + key) y Reenviar.`
  }
  if (code === 'CONTEXT_OVERFLOW') {
    return `Contexto demasiado largo. La app debería resumir sola; si falla, inicia un chat nuevo o borra mensajes viejos.`
  }

  if (lower.includes('invalid api key') || lower.includes('invalid_api_key') || lower.includes('unauthorized')) {
    return `API key inválida${who}. Ajustes → Cloud.`
  }
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many')) {
    return `Límite de peticiones${who}. Espera un minuto o cambia de proveedor.`
  }
  if (
    lower.includes('unavailable for free') ||
    lower.includes('model_not_found') ||
    (lower.includes('model') && lower.includes('does not exist'))
  ) {
    return `Modelo no disponible en plan free${who}. Usa openrouter/free u otro free en Ajustes.`
  }
  if (
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused')
  ) {
    return `Sin conexión estable${who}. Revisa Internet y vuelve a intentarlo.`
  }

  return detail.length > 220 ? detail.slice(0, 217) + '…' : detail
}


/** Classify common provider error messages into typed codes */
export function classifyProviderError(
  message: string,
  provider?: string
): AppError {
  const lower = message.toLowerCase()

  if (
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('authentication')
  ) {
    return new AppError({
      code: 'PROVIDER_AUTH',
      message: extractProviderMessage(message),
      provider,
      retryable: false
    })
  }

  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return new AppError({
      code: 'PROVIDER_RATE_LIMIT',
      message,
      provider,
      retryable: true
    })
  }

  if (
    lower.includes('quota') ||
    lower.includes('insufficient') ||
    lower.includes('afford') ||
    lower.includes('402') ||
    lower.includes('credits')
  ) {
    return new AppError({
      code: 'PROVIDER_QUOTA',
      message,
      provider,
      retryable: true
    })
  }

  if (
    lower.includes('model') &&
    (lower.includes('not found') || lower.includes('does not exist') || lower.includes('invalid model'))
  ) {
    return new AppError({
      code: 'PROVIDER_MODEL_NOT_FOUND',
      message,
      provider,
      retryable: false
    })
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborted')
  ) {
    return new AppError({
      code: 'PROVIDER_TIMEOUT',
      message,
      provider,
      retryable: true
    })
  }

  if (
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('enetunreach') ||
    lower.includes('eai_again') ||
    lower.includes('enotfound') ||
    lower.includes('network') ||
    lower.includes('fetch failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('err_internet') ||
    lower.includes('err_network') ||
    lower.includes('err_name_not_resolved') ||
    lower.includes('err_connection') ||
    lower.includes('socket hang up') ||
    lower.includes('dns') ||
    lower.includes('offline') ||
    lower.includes('no internet')
  ) {
    return new AppError({
      code: 'NETWORK_ERROR',
      message,
      provider,
      retryable: true
    })
  }

  if (
    lower.includes('context length') ||
    lower.includes('context window') ||
    lower.includes('maximum context') ||
    (lower.includes('token') && (lower.includes('limit') || lower.includes('exceed'))) ||
    lower.includes('too long') ||
    lower.includes('context_length_exceeded') ||
    lower.includes('max_tokens')
  ) {
    return new AppError({
      code: 'CONTEXT_OVERFLOW',
      message,
      provider,
      retryable: true
    })
  }

  return new AppError({
    code: 'PROVIDER_UNAVAILABLE',
    message,
    provider,
    retryable: true
  })
}

