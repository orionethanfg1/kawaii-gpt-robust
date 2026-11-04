/**
 * I1 — Single image-generation contract (request / result / job phases).
 * I3 — Quality profiles (fast / balanced / quality) with FaceID-safe limits.
 */

import type { ImageErrorCode } from './types'

export type ImageGenQualityProfile = 'fast' | 'balanced' | 'quality'

export type ImageGenJobPhase =
  | 'queued'
  | 'resolve_runtime'
  | 'unload_llm'
  | 'validate_payload'
  | 'txt2img'
  | 'save'
  | 'fallback_cloud'
  | 'done'
  | 'error'

/** Structured job log line for main + renderer diagnostics */
export type ImageGenJobLog = {
  jobId: string
  phase: ImageGenJobPhase
  at: number
  detail?: string
  pct?: number
}

export type ImageGenContractRequest = {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  seed?: number
  timeoutMs?: number
  jobId?: string
  provider?: 'pollinations' | 'a1111' | 'cloudflare' | 'openai' | 'smart'
  a1111BaseUrl?: string
  steps?: number
  cfgScale?: number
  checkpoint?: string
  referenceImage?: string
  referenceImages?: string[]
  referenceDenoisingStrength?: number
  ipAdapterWeight?: number
  isSelf?: boolean
  requireFaceId?: boolean
  controlNetKind?: string
  title?: string
  batchSize?: number
  /** I3 — omit = balanced */
  qualityProfile?: ImageGenQualityProfile
}

export type ImageGenContractSuccess = {
  ok: true
  jobId: string
  filePath: string
  dataUrl: string
  width: number
  height: number
  providerId: string
  model?: string
  seed?: number
  latencyMs: number
  prompt: string
  qualityProfile: ImageGenQualityProfile
  diagnostics?: string
}

export type ImageGenContractFailure = {
  ok: false
  jobId: string
  code: ImageErrorCode | string
  error: string
  retryable: boolean
  providerId?: string
  qualityProfile?: ImageGenQualityProfile
  diagnostics?: string
}

export type ImageGenContractResult = ImageGenContractSuccess | ImageGenContractFailure

export type ResolvedQualityParams = {
  profile: ImageGenQualityProfile
  width: number
  height: number
  steps: number
  cfgScale: number
  batchSize: number
  timeoutMs: number
  /** Cap long edge before hi-res path */
  maxLongEdge: number
  allowHiRes: boolean
  note: string
}

const PROFILE_BASE: Record<
  ImageGenQualityProfile,
  {
    steps: number
    cfg: number
    maxLongEdge: number
    allowHiRes: boolean
    timeoutMs: number
    note: string
  }
> = {
  fast: {
    steps: 18,
    cfg: 5.5,
    maxLongEdge: 1024,
    allowHiRes: false,
    timeoutMs: 120_000,
    note: 'Fast: menos steps, sin hi-res — reintento / VRAM justa'
  },
  balanced: {
    steps: 28,
    cfg: 6.5,
    maxLongEdge: 1280,
    allowHiRes: true,
    timeoutMs: 180_000,
    note: 'Balanced: default estable con FaceID'
  },
  quality: {
    steps: 36,
    cfg: 7,
    maxLongEdge: 1536,
    allowHiRes: true,
    timeoutMs: 300_000,
    note: 'Quality: más steps; batch=1 si FaceID'
  }
}

/** Clamp size so long edge ≤ max; keep aspect. */
export function clampLongEdge(
  width: number,
  height: number,
  maxLong: number
): { width: number; height: number } {
  const w = Math.max(64, Math.round(width) || 1024)
  const h = Math.max(64, Math.round(height) || 1024)
  const long = Math.max(w, h)
  if (long <= maxLong) {
    return {
      width: Math.round(w / 8) * 8,
      height: Math.round(h / 8) * 8
    }
  }
  const scale = maxLong / long
  return {
    width: Math.max(64, Math.round((w * scale) / 8) * 8),
    height: Math.max(64, Math.round((h * scale) / 8) * 8)
  }
}

/**
 * I3 — Resolve concrete gen params from profile + FaceID constraints.
 * FaceID / ControlNet path always forces batchSize = 1.
 */
export function resolveQualityParams(input: {
  profile?: ImageGenQualityProfile | string | null
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  batchSize?: number
  timeoutMs?: number
  /** FaceID, IP-Adapter, or multi ControlNet */
  usesFaceIdOrControlNet?: boolean
}): ResolvedQualityParams {
  const raw = String(input.profile || 'balanced').toLowerCase()
  const profile: ImageGenQualityProfile =
    raw === 'fast' || raw === 'quality' ? raw : 'balanced'
  const base = PROFILE_BASE[profile]
  const size = clampLongEdge(input.width ?? 1024, input.height ?? 1024, base.maxLongEdge)
  const face = Boolean(input.usesFaceIdOrControlNet)
  let batch = Math.min(4, Math.max(1, Math.floor(Number(input.batchSize) || 1)))
  if (face) batch = 1

  const steps = Math.min(
    50,
    Math.max(10, Math.floor(Number(input.steps) || base.steps))
  )
  // Prefer profile steps when caller sent nothing meaningful
  const finalSteps =
    input.steps != null && input.steps > 0
      ? Math.min(50, Math.max(10, Math.floor(input.steps)))
      : base.steps

  const cfg =
    input.cfgScale != null && input.cfgScale > 0
      ? Math.min(15, Math.max(3, Number(input.cfgScale)))
      : base.cfg

  const timeoutMs = Math.min(
    480_000,
    Math.max(
      30_000,
      Number(input.timeoutMs) > 0 ? Number(input.timeoutMs) : base.timeoutMs
    )
  )

  return {
    profile,
    width: size.width,
    height: size.height,
    steps: finalSteps,
    cfgScale: cfg,
    batchSize: batch,
    timeoutMs,
    maxLongEdge: base.maxLongEdge,
    allowHiRes: base.allowHiRes && !face ? base.allowHiRes : face ? false : base.allowHiRes,
    note: face ? `${base.note} · FaceID → batch=1` : base.note
  }
}

/** Degrade one step for OOM / timeout retry (I3). */
export function degradeQualityProfile(
  current: ImageGenQualityProfile
): ImageGenQualityProfile {
  if (current === 'quality') return 'balanced'
  if (current === 'balanced') return 'fast'
  return 'fast'
}

export function isRetryableImageMessage(message: string): boolean {
  const lower = String(message || '').toLowerCase()
  return (
    /timeout|timed out|econnrefused|econnreset|network|fetch failed|502|503|504|oom|out of memory|cuda|cudnn|allocation|server error|api aún no|forge no/i.test(
      lower
    ) && !/invalid prompt|prompt vacío|cancelled|abort/i.test(lower)
  )
}

export function classifyGenFailureCode(message: string): ImageErrorCode | string {
  const lower = String(message || '').toLowerCase()
  if (/abort|cancel/i.test(lower)) return 'IMAGE_CANCELLED'
  if (/timeout|timed out/i.test(lower)) return 'IMAGE_TIMEOUT'
  if (/econnrefused|forge|sdapi|backend|no hay api/i.test(lower)) return 'IMAGE_BACKEND_DOWN'
  if (/out of memory|oom|cuda.*memory|allocation/i.test(lower)) return 'IMAGE_UNSUPPORTED_HW'
  if (/network|fetch|enotfound/i.test(lower)) return 'IMAGE_NETWORK'
  if (/prompt.*vac[ií]o|empty prompt/i.test(lower)) return 'IMAGE_INVALID_PROMPT'
  return 'IMAGE_UNKNOWN'
}

/** In-memory ring buffer for last N job logs (main process). */
const JOB_LOG_MAX = 40
const jobLogs: ImageGenJobLog[] = []

export function appendImageJobLog(entry: ImageGenJobLog): void {
  jobLogs.push(entry)
  while (jobLogs.length > JOB_LOG_MAX) jobLogs.shift()
}

export function getRecentImageJobLogs(limit = 20): ImageGenJobLog[] {
  return jobLogs.slice(-Math.max(1, limit))
}

export function logImageJobPhase(
  jobId: string,
  phase: ImageGenJobPhase,
  detail?: string,
  pct?: number
): ImageGenJobLog {
  const entry: ImageGenJobLog = {
    jobId,
    phase,
    at: Date.now(),
    detail,
    pct
  }
  appendImageJobLog(entry)
  try {
    console.info('[image-job]', phase, jobId.slice(0, 8), detail || '', pct ?? '')
  } catch {
    /* */
  }
  return entry
}
