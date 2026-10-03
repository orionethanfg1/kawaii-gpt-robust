/**
 * Pure helpers for chat → image generation (revision + identity + compose).
 * Keeps useChat thinner and testable.
 */
import { parseImageIntent, recommendSdParams, composeImagePrompt } from '@core/generative/prompt-compose'
import {
  reviseImagePrompt,
  looksLikeImageRevision,
  shouldForceImageRevision,
  looksLikeRegenerate,
  extractRevisionMemoryFromMessages,
  type ImageRevisionMemory
} from '@core/generative/image-revision'
import { planIdentityLock } from '@core/image/identity-ref'
import { parseSceneSpecFromText, sceneSpecToSdFragments } from '@core/image/scene-spec'
import { isMajorSceneChange } from '@core/image/scene-force'
import { describeNonHumanSubject } from '@core/image/subject-prompt'
import { chooseImageCanvas, minimum2kImageSize } from '@core/image/image-size'

export type ChatImageBuildInput = {
  userText: string
  requestPrompt: string
  width: number
  height: number
  negativePrompt?: string
  messages?: Array<{
    meta?: Record<string, unknown>
    attachments?: Array<{ mimeType?: string }>
    content?: string
  }>
  character?: {
    name?: string
    visualDescription?: string
    visualImageUrl?: string
    visualGallery?: Array<{ dataUrl?: string; label?: string; scene?: string }>
  } | null
  useCharacterStyle?: boolean
  /** Optional pre-parsed / LLM-refined scene */
  sceneSpecOverride?: import('@core/image/scene-spec').SceneSpec
}


export type ChatImageBuildResult = {
  finalPrompt: string
  negative: string
  width: number
  height: number
  seed?: number
  referenceImage?: string
  referenceImages?: string[]
  referenceDenoisingStrength?: number
  ipAdapterWeight?: number
  isSelf: boolean
  isRevision: boolean
  revisionNote?: string
  suggestedBatch?: number
  cfgScaleHint?: number
  requireFaceId?: boolean
  identityNote?: string
  referenceCount: number
  refSources: string[]
}

export function buildChatImageRequest(input: ChatImageBuildInput): ChatImageBuildResult {
  const trimmed = input.userText.trim()
  const prevMem: ImageRevisionMemory | null = input.messages
    ? extractRevisionMemoryFromMessages(input.messages)
    : null

  let finalPrompt = (input.requestPrompt || trimmed).trim()
  let width = input.width
  let height = input.height
  let negative = input.negativePrompt || ''
  let seed: number | undefined
  let revisionNote: string | undefined
  let isRevision = false

  let intent
  try {
    intent = parseImageIntent(trimmed)
  } catch {
    intent = { isSelf: false, explicitOther: false, framing: 'portrait' as const }
  }
  // Framing drives canvas: full body needs taller AR or SD defaults to face crop
  try {
    const rec = recommendSdParams({
      prompt: trimmed,
      framing: intent.framing as 'full' | 'half' | 'wide' | 'portrait',
      style: (intent as { style?: string }).style as never
    })
    width = rec.width
    height = rec.height
  } catch {
    /* keep input size */
  }

  const previousImageIsSelf = prevMem?.wasSelf === true
  const requestedNonHuman = Boolean(describeNonHumanSubject(trimmed))
  const hasImageRevisionCue =
    Boolean(prevMem) &&
    (looksLikeRegenerate(trimmed) ||
      looksLikeImageRevision(trimmed, true) ||
      shouldForceImageRevision(trimmed, true))
  const wantsSelfRev =
    !intent.explicitOther &&
    (intent.isSelf ||
      (previousImageIsSelf &&
        !requestedNonHuman &&
        (hasImageRevisionCue ||
          /\b(como t[uú]|igual que t[uú]|tu misma|tu mismo|hazla|hazlo)\b/i.test(trimmed))))
  const lockCharacterIdentity =
    !intent.explicitOther &&
    (intent.isSelf ||
      (previousImageIsSelf && hasImageRevisionCue && !requestedNonHuman))

  const forceRegen = looksLikeRegenerate(trimmed)

  if (
    prevMem &&
    (forceRegen ||
      looksLikeImageRevision(trimmed, true) ||
      shouldForceImageRevision(trimmed, true)) &&
    (wantsSelfRev || (forceRegen && !previousImageIsSelf))
  ) {
    isRevision = true
    const revised = reviseImagePrompt(
      {
        ...prevMem,
        wasSelf: prevMem.wasSelf !== false,
        prompt:
          prevMem.prompt ||
          'photorealistic portrait of a young woman, detailed face, natural lighting'
      },
      trimmed,
      {
        characterLook:
          lockCharacterIdentity && input.useCharacterStyle !== false
            ? (input.character?.visualDescription || '').trim() || undefined
            : undefined,
        characterName: input.character?.name,
        forceSelf: lockCharacterIdentity && input.useCharacterStyle !== false
      }
    )
    finalPrompt = revised.prompt
    width = revised.width || width
    height = revised.height || height
    negative = revised.negativePrompt || negative
    seed = forceRegen ? undefined : revised.seed
    revisionNote = forceRegen
      ? (revised.note || '') + ' · regenerar (nueva seed)'
      : revised.note
  }

  const effectiveSelf = lockCharacterIdentity
  const identity = planIdentityLock({
    isSelf: effectiveSelf,
    explicitOther: intent.explicitOther,
    useCharacterStyle: input.useCharacterStyle,
    character: input.character,
    framing: (intent as { framing?: string }).framing,
    preferBatch: true,
    promptHint: input.userText || trimmed
  })

  if (!isRevision) {
    try {
      const composed = composeImagePrompt(trimmed || input.requestPrompt.trim(), 'sd15', {
        visualDescription: (input.character?.visualDescription || '').trim() || undefined,
        characterName: input.character?.name,
        useCharacter: effectiveSelf && input.useCharacterStyle !== false
      })
      finalPrompt = composed.prompt
      negative = [negative, composed.negativePrompt].filter(Boolean).join(', ')
    } catch {
      /* keep */
    }
  }

  // Major scene/outfit change → new seed (never lock previous composition)
  try {
    if (isMajorSceneChange(trimmed, prevMem?.prompt)) {
      seed = undefined
    }
  } catch {
    /* */
  }

  // I1 SceneSpec — rich scene fragments (framing, outfit, environment)
  try {
    const scene = {
      ...(input.sceneSpecOverride || parseSceneSpecFromText(trimmed)),
      isSelf: effectiveSelf
    }
    const previousScene =
      isRevision && prevMem?.prompt ? parseSceneSpecFromText(prevMem.prompt) : undefined
    const explicitSceneFraming =
      /\b(cuerpo completo|cuerpo entero|full body|full-body|de pie|head to toe|de cintura|medio cuerpo|waist-up|upper body|primer plano|close[- ]?up|headshot|wide|paisaje)\b/i.test(
        trimmed
      )
    if (!explicitSceneFraming && (intent.framing === 'full' || intent.framing === 'wide')) {
      scene.framing = intent.framing
    }
    if (
      scene.clothing.length &&
      !/\b(de cintura|medio cuerpo|waist-up|upper body|primer plano|close[- ]?up|headshot)\b/i.test(
        trimmed
      ) &&
      !/\b(cuerpo completo|cuerpo entero|full body|full-body|de pie|head to toe|wide|paisaje)\b/i.test(
        trimmed
      )
    ) {
      scene.framing = 'full'
    }
    if (effectiveSelf && !scene.environment) {
      scene.environment =
        previousScene?.environment || 'natural lifestyle setting'
    }
    const canvas = chooseImageCanvas(trimmed, scene.framing)
    width = canvas.width
    height = canvas.height
    const frag = sceneSpecToSdFragments(scene)
    if (frag.positive.length) {
      finalPrompt = [...frag.positive, finalPrompt].join(', ')
    }
    if (effectiveSelf && scene.environment) {
      finalPrompt = `environmental composition, visible background, candid natural pose, ${finalPrompt}`
    }
    if (frag.negative.length) {
      negative = [negative, ...frag.negative].filter(Boolean).join(', ')
    }
  } catch {
    /* optional */
  }

  // Preserve a requested dress color without banning that same color.
  {
    const dress = input.userText.match(
      /\b(?:vestido|dress)\s+(rojo|roja|azul|verde|negro|negra|blanco|blanca|rosa)\b/i
    ) || input.userText.match(/\b(azul|rojo|verde|negro|blanco|rosa)\s+(?:vestido|dress)\b/i)
    if (dress) {
      const map: Record<string, string> = {
        azul: 'blue',
        rojo: 'red',
        roja: 'red',
        verde: 'green',
        negro: 'black',
        negra: 'black',
        blanco: 'white',
        blanca: 'white',
        rosa: 'pink'
      }
      const eng = map[(dress[1] || '').toLowerCase()] || dress[1]
      finalPrompt = `${finalPrompt}, (${eng} dress:1.45), wearing ${eng} dress, ${eng} outfit`
      const conflictingDressColors = ['red', 'blue', 'green', 'black', 'white', 'pink']
        .filter((color) => color !== eng)
        .map((color) => `${color} dress`)
      negative = [negative, ...conflictingDressColors, 'wrong clothing color']
        .filter(Boolean)
        .join(', ')
    }
  }

  const outputSize = minimum2kImageSize(width, height)
  width = outputSize.width
  height = outputSize.height

  return {
    finalPrompt,
    negative,
    width,
    height,
    seed,
    referenceImage: identity.referenceImage,
    referenceImages: identity.referenceImages,
    referenceDenoisingStrength: identity.referenceDenoisingStrength,
    ipAdapterWeight: identity.ipAdapterWeight || undefined,
    isSelf: Boolean(effectiveSelf && input.useCharacterStyle !== false),
    isRevision,
    revisionNote,
    suggestedBatch: identity.suggestedBatch,
    cfgScaleHint: identity.cfgScaleHint,
    requireFaceId: identity.requireFaceId,
    identityNote: identity.note,
    referenceCount: identity.referenceImages?.length || (identity.referenceImage ? 1 : 0),
    refSources: identity.refSources || []
  }
}
