/**
 * Batch image generation (renderer) — identity-aware auto-batch for self portraits.
 */
import { generateSeedBatch, identityLockHints } from '@core/generative/batch-seeds'
import { planIdentityLock } from '@core/image/identity-ref'

type ImageGenerateResult =
  | {
      ok: true
      dataUrl: string
      filePath?: string
      providerId: string
      width: number
      height: number
      latencyMs: number
      seed?: number
    }
  | { ok: false; error?: string; code?: string }

export type BatchItem = {
  dataUrl: string
  seed?: number
  meta: string
  filePath?: string
}

export type RunBatchInput = {
  prompt: string
  negativePrompt: string
  width: number
  height: number
  steps: number
  cfg: number
  seed?: number
  batchCount: number
  provider: 'pollinations' | 'a1111' | 'smart'
  a1111BaseUrl?: string
  checkpoint?: string
  timeoutMs: number
  jobId: string
  isSelf: boolean
  explicitOther?: boolean
  useCharacterStyle?: boolean
  character?: {
    visualImageUrl?: string
    visualGallery?: Array<{ dataUrl?: string; label?: string; scene?: string }>
    name?: string
  } | null
  framing?: string
  imageGenerate: (payload: Record<string, unknown>) => Promise<ImageGenerateResult>
  onProgress?: (detail: string, pct: number) => void
  isCancelled?: () => boolean
}

export async function runImageBatch(input: RunBatchInput): Promise<{
  items: BatchItem[]
  identityNote: string
  locked: boolean
  autoBatched: boolean
}> {
  const identity = planIdentityLock({
    isSelf: input.isSelf,
    explicitOther: input.explicitOther,
    useCharacterStyle: input.useCharacterStyle,
    character: input.character,
    framing: input.framing,
    preferBatch: true
  })
  const lockHints = identityLockHints(input.isSelf && !input.explicitOther)
  const effectiveCfg =
    identity.cfgScaleHint != null
      ? Math.min(input.cfg, Math.max(5.5, identity.cfgScaleHint))
      : input.cfg
  const effectiveSteps =
    identity.stepsHint != null
      ? Math.max(input.steps, identity.stepsHint)
      : input.steps

  let count = Math.max(1, Math.min(4, input.batchCount))
  let autoBatched = false
  if (identity.locked && count === 1 && (identity.suggestedBatch || 0) > 1) {
    count = Math.min(3, identity.suggestedBatch || 3)
    autoBatched = true
  }
  const seeds =
    count <= 1 ? [input.seed] : generateSeedBatch(count, input.seed)

  const collected: BatchItem[] = []
  for (let i = 0; i < seeds.length; i++) {
    if (input.isCancelled?.()) break
    const s = seeds[i]
    input.onProgress?.(
      count > 1
        ? `Variante ${i + 1}/${count} (seed ${s ?? 'auto'})…`
        : identity.locked
          ? 'Generando con FaceID…'
          : 'Generando…',
      15 + Math.round((i / seeds.length) * 70)
    )

    const res = await input.imageGenerate({
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      width: input.width,
      height: input.height,
      seed: s,
      timeoutMs: input.timeoutMs,
      jobId: count > 1 ? `${input.jobId}_${i}` : input.jobId,
      provider: input.provider,
      a1111BaseUrl: input.a1111BaseUrl,
      steps: effectiveSteps,
      cfgScale: effectiveCfg,
      checkpoint:
        input.provider === 'pollinations' ? undefined : input.checkpoint,
      referenceImage: identity.referenceImage,
      referenceImages: identity.referenceImages,
      referenceDenoisingStrength: identity.referenceDenoisingStrength,
      ipAdapterWeight: identity.ipAdapterWeight
    })

    if (!res.ok) {
      if ((res as { code?: string }).code === 'IMAGE_CANCELLED') {
        throw Object.assign(new Error('Generación cancelada'), {
          code: 'IMAGE_CANCELLED'
        })
      }
      if (count === 1) throw new Error(res.error || 'Error al generar')
      continue
    }

    const meta = `${res.providerId} · ${res.width}×${res.height} · seed ${res.seed ?? s ?? '—'} · ${res.latencyMs} ms`
    collected.push({
      dataUrl: res.dataUrl,
      seed: res.seed ?? s,
      meta,
      filePath: res.filePath
    })
  }

  return {
    items: collected,
    identityNote: identity.note || lockHints.note,
    locked: identity.locked,
    autoBatched
  }
}
