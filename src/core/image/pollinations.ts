/**
 * Pollinations.ai free image API (no key required for basic use).
 * https://image.pollinations.ai/prompt/{prompt}?width=&height=&nologo=true
 */

import type { ImageGenRequest, ImageGenResult, ImageProvider, ImageProviderHealth } from './types'
import { ImageGenError } from './errors'

export interface PollinationsOptions {
  /** Default base without trailing slash */
  baseUrl?: string
  timeoutMs?: number
  defaultWidth?: number
  defaultHeight?: number
}

const DEFAULT_BASE = 'https://image.pollinations.ai'

export function buildPollinationsUrl(
  prompt: string,
  opts: {
    baseUrl?: string
    width: number
    height: number
    seed?: number
    model?: string
  }
): string {
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '')
  const encoded = encodeURIComponent(prompt.trim())
  const params = new URLSearchParams()
  params.set('width', String(opts.width))
  params.set('height', String(opts.height))
  params.set('nologo', 'true')
  if (opts.seed != null && Number.isFinite(opts.seed)) {
    params.set('seed', String(Math.floor(opts.seed)))
  }
  if (opts.model) params.set('model', opts.model)
  return `${base}/prompt/${encoded}?${params.toString()}`
}

export class PollinationsImageProvider implements ImageProvider {
  readonly id = 'pollinations'
  readonly kind = 'pollinations' as const
  readonly displayName = 'Pollinations'
  private baseUrl: string
  private timeoutMs: number
  private defaultWidth: number
  private defaultHeight: number

  constructor(options: PollinationsOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE
    this.timeoutMs = options.timeoutMs ?? 90_000
    this.defaultWidth = options.defaultWidth ?? 1024
    this.defaultHeight = options.defaultHeight ?? 1024
  }

  async healthCheck(signal?: AbortSignal): Promise<ImageProviderHealth> {
    const start = Date.now()
    try {
      // Lightweight HEAD/GET to root or a tiny probe — pollinations may not support HEAD
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 8_000)
      const onAbort = () => controller.abort()
      signal?.addEventListener('abort', onAbort)
      try {
        const res = await fetch(this.baseUrl.replace(/\/$/, '') + '/', {
          method: 'GET',
          signal: controller.signal
        })
        // Any HTTP response means host is reachable
        return {
          ok: res.status < 500,
          latencyMs: Date.now() - start,
          detail: `HTTP ${res.status}`
        }
      } finally {
        clearTimeout(t)
        signal?.removeEventListener('abort', onAbort)
      }
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  async generate(request: ImageGenRequest): Promise<ImageGenResult> {
    const prompt = request.prompt?.trim()
    if (!prompt) {
      throw new ImageGenError({
        code: 'IMAGE_INVALID_PROMPT',
        message: 'El prompt de imagen está vacío',
        provider: this.id,
        retryable: false
      })
    }

    const width = clampDim(request.width ?? this.defaultWidth)
    const height = clampDim(request.height ?? this.defaultHeight)
    const seed = request.seed
    const url = buildPollinationsUrl(prompt, {
      baseUrl: this.baseUrl,
      width,
      height,
      seed,
      model: request.model
    })

    const start = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const onAbort = () => controller.abort()
    request.signal?.addEventListener('abort', onAbort)

    try {
      let lastErr: unknown
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              Accept: 'image/*,*/*',
              'User-Agent': 'KawaiiGPT-Robust/0.3'
            }
          })

          if (res.status === 429) {
            throw new ImageGenError({
              code: 'IMAGE_RATE_LIMIT',
              message: 'Rate limit de Pollinations. Espera unos segundos.',
              provider: this.id,
              retryable: true
            })
          }

          if (!res.ok) {
            throw new ImageGenError({
              code: res.status >= 500 ? 'IMAGE_BACKEND_DOWN' : 'IMAGE_UNKNOWN',
              message: `Pollinations HTTP ${res.status}`,
              provider: this.id,
              retryable: res.status >= 500
            })
          }

          const contentType = res.headers.get('content-type') || 'image/png'
          const buf = Buffer.from(await res.arrayBuffer())
          if (buf.byteLength < 100) {
            throw new ImageGenError({
              code: 'IMAGE_UNKNOWN',
              message: 'Respuesta de imagen vacía o inválida',
              provider: this.id,
              retryable: true
            })
          }

          const b64 = buf.toString('base64')
          const mime = contentType.includes('jpeg')
            ? 'image/jpeg'
            : contentType.includes('webp')
              ? 'image/webp'
              : 'image/png'
          const dataUrl = `data:${mime};base64,${b64}`

          return {
            dataUrl,
            width,
            height,
            providerId: this.id,
            model: request.model || 'pollinations-default',
            seed,
            latencyMs: Date.now() - start,
            prompt
          }
        } catch (err) {
          lastErr = err
          if (err instanceof ImageGenError && !err.retryable) throw err
          if (controller.signal.aborted) {
            throw ImageGenError.fromUnknown(err, this.id)
          }
          if (attempt === 0 && err instanceof ImageGenError && err.retryable) {
            await sleep(1500)
            continue
          }
          throw ImageGenError.fromUnknown(err, this.id)
        }
      }
      throw ImageGenError.fromUnknown(lastErr, this.id)
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onAbort)
    }
  }
}

function clampDim(n: number): number {
  const x = Math.round(n)
  if (!Number.isFinite(x)) return 1024
  return Math.min(1280, Math.max(256, x))
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
