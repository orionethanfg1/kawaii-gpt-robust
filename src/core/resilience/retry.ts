import { AppError } from '../errors'

export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Only retry if this returns true */
  shouldRetry?: (error: unknown, attempt: number) => boolean
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void
  signal?: AbortSignal
}

const defaultShouldRetry = (error: unknown): boolean => {
  if (error instanceof AppError) return error.retryable
  return true
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AppError({ code: 'STREAM_ABORTED', message: 'Aborted', retryable: false }))
      return
    }
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new AppError({ code: 'STREAM_ABORTED', message: 'Aborted', retryable: false }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Exponential backoff with full jitter.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  const baseDelayMs = options.baseDelayMs ?? 400
  const maxDelayMs = options.maxDelayMs ?? 8_000
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastError = err
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        throw err
      }
      // full jitter: random between 0 and exp backoff
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
      const delay = Math.floor(Math.random() * exp)
      options.onRetry?.(err, attempt, delay)
      await sleep(delay, options.signal)
    }
  }

  throw lastError
}
