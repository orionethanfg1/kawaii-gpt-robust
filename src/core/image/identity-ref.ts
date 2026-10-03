/**
 * Hito 3.1 — facial identity for self-portraits (FaceID / IP-Adapter).
 *
 * Research defaults (2026):
 * - FaceID Plus v2 preferred over generic IP-Adapter
 * - Weight ~0.75–0.85 (portrait); higher for half/full body where face is smaller
 * - CFG slightly lower (~6–6.5) so identity + prompt can coexist
 * - Clean front-facing reference ≥512px, face ≥30% of frame
 * - Batch 2–3 seeds helps pick the best likeness
 * - Multi-ref: canonical avatar + selected gallery anchors for self
 */

import { identityLockHints } from '../generative/batch-seeds'
import {
  buildIpAdapterConfig,
  pickIpAdapterModel,
  type IpAdapterConfig,
  type IpAdapterModel
} from './ip-adapter'

export type CharacterVisualSource = {
  visualImageUrl?: string
  visualGallery?: Array<{ dataUrl?: string; label?: string; scene?: string }>
  name?: string
}

export type FramingHint = 'close' | 'half' | 'full' | 'wide' | string

/** Prefer portrait / face / avatar labeled gallery items for FaceID reference */
export function pickAvatarDataUrl(character?: CharacterVisualSource | null): string | undefined {
  if (!character) return undefined
  const gallery = character.visualGallery || []
  const scored = gallery
    .filter((g) => g.dataUrl?.startsWith('data:image/'))
    .map((g) => {
      const label = `${g.label || ''} ${g.scene || ''}`.toLowerCase()
      let score = 1
      if (/face|rostro|portrait|cara|close|avatar|selfie|primer/.test(label)) score += 5
      if (/full|cuerpo|wide|paisaje|fondo/.test(label)) score -= 2
      return { url: g.dataUrl!, score }
    })
    .sort((a, b) => b.score - a.score)
  if (scored[0]) return scored[0].url
  if (character.visualImageUrl?.startsWith('data:image/')) return character.visualImageUrl
  return undefined
}

/**
 * Weight by framing — face occupies less of the image in full-body shots,
 * so identity signal needs to be stronger (industry grid sweeps 2026).
 */

/**
 * Up to max refs: canonical avatar first, then distinct gallery views.
 * The primary remains the strongest FaceID anchor; secondary views add low-weight variation.
 */
export function pickIdentityReferenceUrls(
  character?: CharacterVisualSource | null,
  max = 3
): string[] {
  if (!character) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (url?: string) => {
    if (!url || !url.startsWith('data:image/') || seen.has(url)) return
    seen.add(url)
    out.push(url)
  }
  // Canonical avatar first (identity lock)
  if (character.visualImageUrl?.startsWith('data:image/')) push(character.visualImageUrl)
  push(pickAvatarDataUrl(character))
  const gallery = character.visualGallery || []
  const scored = gallery
    .filter((g) => g.dataUrl?.startsWith('data:image/'))
    .map((g) => {
      const label = ((g.label || '') + ' ' + (g.scene || '')).toLowerCase()
      let score = 1
      if (/face|rostro|portrait|cara|close|avatar|selfie|primer/.test(label)) score += 5
      if (/full|cuerpo|wide|paisaje|fondo/.test(label)) score -= 2
      return { url: g.dataUrl as string, score }
    })
    .sort((a, b) => b.score - a.score)
  for (const g of scored) {
    push(g.url)
    if (out.length >= max) break
  }
  // Liked images are NOT FaceID refs (pollute identity with other faces).
  // They remain available for batch ranking via face_similarity only.
  return out.slice(0, max)
}

/** Self-portrait must attempt FaceID when policy says so. */

/** Human labels for which refs FaceID will use (no data URLs). */
export function describeIdentityRefSources(
  character?: CharacterVisualSource | null,
  maxLabels = 1
): string[] {
  if (!character) return []
  const labels: string[] = []
  // FaceID primary is always the ficha avatar when present
  if (character.visualImageUrl?.startsWith('data:image/')) {
    labels.push('avatar principal (ficha)')
  }
  if (labels.length < maxLabels) {
    const gallery = character.visualGallery || []
    for (const g of gallery) {
      if (!g.dataUrl?.startsWith('data:image/')) continue
      // Skip if same as primary (byte-identical string)
      if (g.dataUrl === character.visualImageUrl) continue
      const tag = (g.label || g.scene || 'galería').trim().slice(0, 40)
      labels.push('galería: ' + tag)
      if (labels.length >= maxLabels) break
    }
  }
  if (!labels.length) {
    const av = pickAvatarDataUrl(character)
    if (av) labels.push('mejor candidata de galería/avatar')
  }
  return labels
}

export function requiresFaceIdPolicy(opts: {
  isSelf: boolean
  explicitOther?: boolean
  hasReference: boolean
}): { require: boolean; reason: string } {
  if (opts.explicitOther || !opts.isSelf) {
    return { require: false, reason: 'not_self' }
  }
  if (!opts.hasReference) {
    return { require: true, reason: 'self_without_ref' }
  }
  return { require: true, reason: 'self_with_ref' }
}

export function faceIdWeightForFraming(framing?: FramingHint): number {
  const f = (framing || 'close').toLowerCase()
  // P1: slightly higher anchors so face survives scene/outfit changes
  if (f === 'full' || f === 'wide') return 0.94
  if (f === 'half') return 0.9
  return 0.85 // close / portrait
}

export type IdentityGenerateOpts = {
  isSelf: boolean
  explicitOther?: boolean
  useCharacterStyle?: boolean
  character?: CharacterVisualSource | null
  weight?: number
  framing?: FramingHint
  preferBatch?: boolean
  /** Full user/prompt text — used to detect outfit changes vs pure portrait */
  promptHint?: string
}

export type IdentityGeneratePlan = {
  referenceImage?: string
  /** Extra refs (gallery faces) for multi-ref / scoring */
  referenceImages?: string[]
  referenceDenoisingStrength?: number
  cfgScaleHint?: number
  ipAdapterWeight: number
  note: string
  locked: boolean
  /** Recommended batch for “pick best face” */
  suggestedBatch?: number
  stepsHint?: number
  /** I0: self must use FaceID path when possible */
  requireFaceId?: boolean
  policyReason?: string
  /** Labels of refs used (for UI transparency) */
  refSources?: string[]
}

export function planIdentityLock(opts: IdentityGenerateOpts): IdentityGeneratePlan {
  const other = Boolean(opts.explicitOther) || !opts.isSelf
  if (other || opts.useCharacterStyle === false) {
    const hints = identityLockHints(false)
    return {
      ipAdapterWeight: 0,
      note: hints.note,
      locked: false,
      requireFaceId: false,
      policyReason: 'not_self'
    }
  }
  const refs = pickIdentityReferenceUrls(opts.character, 3)
  const refSources = describeIdentityRefSources(opts.character, refs.length || 1)
  const av = refs[0] || pickAvatarDataUrl(opts.character)
  const policy = requiresFaceIdPolicy({
    isSelf: true,
    explicitOther: opts.explicitOther,
    hasReference: Boolean(av)
  })
  let weight = opts.weight ?? faceIdWeightForFraming(opts.framing)
  // Floor weight for self so identity is not accidentally disabled
  weight = Math.max(weight, 0.8)
  const outfitHint = opts.promptHint || ''
  if (/\b(vestido|dress|ropa|outfit|camiseta|jacket|traje|catsuit)\b/i.test(outfitHint)) {
    weight = Math.min(Math.max(weight, 0.8), 0.86)
  }
  if (/\bcatsuit\b/i.test(outfitHint)) {
    weight = Math.min(Math.max(weight, 0.8), 0.84)
  }
  if (refs.length > 1) weight = Math.min(weight, 0.82)
  const cfg = 6.2
  const stepsHint = 32

  if (!av) {
    return {
      ipAdapterWeight: weight,
      cfgScaleHint: cfg,
      stepsHint,
      note:
        'Autorretrato sin avatar usable: solo texto. Sube un retrato frontal claro (≥512px) en el personaje para FaceID.',
      locked: false,
      requireFaceId: true,
      policyReason: policy.reason,
      refSources: [],
      suggestedBatch: opts.preferBatch === false ? undefined : 2
    }
  }
  const extra = refs.length > 1 ? ' · ' + String(refs.length) + ' refs' : ''
  return {
    referenceImage: av,
    referenceImages: refs,
    referenceDenoisingStrength: 0.72,
    cfgScaleHint: cfg,
    stepsHint,
    ipAdapterWeight: weight,
    note:
      'FaceID obligatorio · peso ' +
      weight.toFixed(2) +
      ' (' +
      (opts.framing || 'portrait') +
      ') · identidad bloqueada' +
      extra,
    locked: true,
    requireFaceId: true,
    policyReason: policy.reason,
    refSources,
    suggestedBatch: opts.preferBatch === false ? undefined : 3
  }
}

export function resolveIpAdapterFromModels(
  modelNames: string[],
  referenceImage: string,
  weight?: number
): { selected: IpAdapterModel; config: IpAdapterConfig } | null {
  const selected = pickIpAdapterModel(modelNames)
  if (!selected) return null
  const w = weight ?? (selected.kind === 'faceid' ? 0.85 : 0.7)
  return {
    selected,
    config: buildIpAdapterConfig(selected, referenceImage, w)
  }
}
