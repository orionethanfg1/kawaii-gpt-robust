import { toLegacyCapabilityInfo, type CapabilityFlags } from '../capabilities'
/**
 * Generative multi-layer planning + capability registry (UI badges).
 * Isolated so a failure here never crashes the chat shell.
 */

import { detectGenerativeIntent } from './intent'

export type GenerativeModality = 'text' | 'image' | 'music' | 'video'

export type CapabilityStatus =
  | 'available'
  | 'degraded'
  | 'not_configured'
  | 'unavailable'

export type CapabilityInfo = {
  id: string
  modality: GenerativeModality
  displayName: string
  status: CapabilityStatus
  reason?: string
}

export type MediaRequest = {
  modality: 'image' | 'music' | 'video'
  prompt?: string
  stylePrompt?: string
  lyrics?: string
  negativePrompt?: string
  width?: number
  height?: number
  seed?: number
}

export type PlanGenerativeInput = {
  imageGenEnabled?: boolean
  imageProviderMode?: string
  musicEnabled?: boolean
  videoEnabled?: boolean
  character?: {
    name?: string
    visualDescription?: string
  }
  useCharacterStyle?: boolean
  imageWidth?: number
  imageHeight?: number
}

export type PlanGenerativeResult = {
  mediaRequests: MediaRequest[]
  mediaHint?: string
  error?: string
}

export function buildCapabilityRegistry(opts: {
  imageGenEnabled?: boolean
  imageProviderMode?: string
  musicEnabled?: boolean
  videoEnabled?: boolean
  voiceTtsEnabled?: boolean
  gamesEnabled?: boolean
}): CapabilityInfo[] {
  const flags: CapabilityFlags = {
    imageGenEnabled: opts.imageGenEnabled,
    imageProviderMode: opts.imageProviderMode,
    musicGenEnabled: opts.musicEnabled,
    videoGenEnabled: opts.videoEnabled,
    voiceTtsEnabled: opts.voiceTtsEnabled,
    gamesEnabled: opts.gamesEnabled
  }
  return toLegacyCapabilityInfo(flags) as CapabilityInfo[]
}

/**
 * Plan media jobs from user text without throwing.
 */
export function safePlanGenerativeTurn(
  text: string,
  opts: PlanGenerativeInput = {}
): PlanGenerativeResult {
  try {
    return planGenerativeTurn(text, opts)
  } catch (e) {
    return {
      mediaRequests: [],
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

export function planGenerativeTurn(
  text: string,
  opts: PlanGenerativeInput = {}
): PlanGenerativeResult {
  const trimmed = (text || '').trim()
  if (!trimmed) return { mediaRequests: [] }

  const mediaRequests: MediaRequest[] = []
  const imageOn = opts.imageGenEnabled !== false
  const musicOn = opts.musicEnabled === true
  const videoOn = opts.videoEnabled === true

  const intent = detectGenerativeIntent(trimmed)

  // Explicit image request
  const wantsImage =
    intent.modality === 'image' ||
    /\b(genera|generame|genérame|dibuja|crea|haz)\b[\s\S]{0,40}\b(imagen|foto|dibujo|retrato)\b/i.test(
      trimmed
    ) ||
    /\b(foto tuya|imagen tuya|autorretrato|selfie)\b/i.test(trimmed)

  if (wantsImage && imageOn) {
    const self =
      /\b(tuya|tuyo|de ti|autorretrato|selfie|como te ves)\b/i.test(trimmed) ||
      (opts.character?.name &&
        new RegExp(`\\b${escapeRe(opts.character.name)}\\b`, 'i').test(trimmed))

    let prompt = intent.prompt || trimmed
    if (self && opts.useCharacterStyle !== false && opts.character?.visualDescription) {
      prompt = [
        opts.character.name ? `portrait of ${opts.character.name}` : 'self portrait',
        opts.character.visualDescription,
        trimmed
      ]
        .filter(Boolean)
        .join(', ')
    }

    mediaRequests.push({
      modality: 'image',
      prompt,
      width: opts.imageWidth || 1024,
      height: opts.imageHeight || 1024
    })
  }

  const wantsMusic =
    intent.modality === 'music' ||
    /\b(genera|crea|haz|compón|compon)\b[\s\S]{0,50}\b(cancion|canción|m[uú]sica|tema musical)\b/i.test(
      trimmed
    )

  if (wantsMusic && musicOn && mediaRequests.every((m) => m.modality !== 'music')) {
    mediaRequests.push({
      modality: 'music',
      prompt: trimmed,
      stylePrompt: trimmed
    })
  }

  if (videoOn && /\b(video|v[ií]deo)\b/i.test(trimmed) && /\b(genera|crea|haz)\b/i.test(trimmed)) {
    mediaRequests.push({ modality: 'video', prompt: trimmed })
  }

  return {
    mediaRequests,
    mediaHint:
      mediaRequests.length > 0
        ? mediaRequests.map((m) => m.modality).join('+')
        : undefined
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Re-exports used around the app
export { detectGenerativeIntent, isMusicCapabilityQuestion } from './intent'
export {
  composeImagePrompt,
  recommendSdParams,
  parseImageIntent,
  visualDescriptionToTags
} from './prompt-compose'
export { pickBestCheckpoint } from './smart-checkpoint'
export {
  looksLikeImageRevision,
  looksLikeIdentityReject,
  reviseImagePrompt,
  shouldForceImageRevision
} from './image-revision'
export * from './prompt-compose'
