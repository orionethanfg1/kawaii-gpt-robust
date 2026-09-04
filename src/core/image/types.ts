/**
 * Image generation contracts. Isolated from chat providers.
 */

export type ImageProviderKind = 'pollinations' | 'a1111' | 'comfy' | 'ollama-image' | 'stability'

export type ImageProviderMode = 'off' | 'cloud' | 'local' | 'smart'

export interface ImageGenRequest {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  seed?: number
  /** Provider-specific model id */
  model?: string
  signal?: AbortSignal
}

export interface ImageGenResult {
  /** Absolute path on disk (main process) or empty if only base64 */
  filePath?: string
  /** data:image/png;base64,... for renderer display without file protocol issues */
  dataUrl: string
  width: number
  height: number
  providerId: string
  model?: string
  seed?: number
  latencyMs: number
  prompt: string
}

export interface ImageProviderHealth {
  ok: boolean
  latencyMs?: number
  error?: string
  detail?: string
}

export interface ImageProvider {
  readonly id: string
  readonly kind: ImageProviderKind
  readonly displayName: string
  healthCheck(signal?: AbortSignal): Promise<ImageProviderHealth>
  generate(request: ImageGenRequest): Promise<ImageGenResult>
}

export type ImageErrorCode =
  | 'IMAGE_TIMEOUT'
  | 'IMAGE_RATE_LIMIT'
  | 'IMAGE_NETWORK'
  | 'IMAGE_BACKEND_DOWN'
  | 'IMAGE_UNSUPPORTED_HW'
  | 'IMAGE_CANCELLED'
  | 'IMAGE_INVALID_PROMPT'
  | 'IMAGE_UNKNOWN'
