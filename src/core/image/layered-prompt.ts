/**
 * I1 — Layered image prompt composition.
 * Order: quality/framing → identity → outfit (turn) → scene → user extras.
 * Identity never absorbs outfit from previous turns.
 */
import type { IdentityProfile } from './identity-profile'
import {
  identityNegativeBits,
  identityProfileToPromptBits
} from './identity-profile'
import type { OutfitSpec } from './outfit-spec'
import { emptyOutfitSpec, outfitNegativeBits, outfitSpecToPromptBits } from './outfit-spec'
import type { SceneSpec } from './scene-spec'
import { parseSceneSpecFromText, sceneSpecToSdFragments } from './scene-spec'
import { parseOutfitSpecFromText } from './outfit-spec'

export type LayeredPromptInput = {
  userText: string
  identity?: IdentityProfile | null
  /** If omitted, parsed from userText for this turn only */
  outfit?: OutfitSpec | null
  /** If omitted, parsed from userText */
  scene?: SceneSpec | null
  /** Extra positive tags (style preset, quality already handled upstream optional) */
  extraPositive?: string[]
  extraNegative?: string[]
  /** When false, skip identity layer (e.g. dragon, cat) */
  useIdentity?: boolean
}

export type LayeredPromptResult = {
  positive: string
  negative: string
  layers: {
    identity: string[]
    outfit: string[]
    scene: string[]
    framing: string[]
  }
  outfit: OutfitSpec
  scene: SceneSpec
  isSelf: boolean
}

const QUALITY = ['(masterpiece:1.2)', '(best quality:1.2)', 'highly detailed']

const FRAMING_MAP: Record<string, string[]> = {
  close: ['close-up portrait', 'face focus', 'headshot'],
  half: ['upper body', 'waist-up portrait', 'shoulders visible'],
  full: ['full body', 'head to toe', 'standing full length'],
  wide: ['wide shot', 'environment visible', 'full scene']
}

const BASE_NEG =
  'two heads, two faces, double head, extra limbs, extra fingers, fused fingers, deformed hands, ' +
  'mutated hands, bad anatomy, bad proportions, disfigured, blurry, low quality, jpeg artifacts, ' +
  'watermark, text, logo, signature, multiple people, crowd, clone, illustration, anime, 3d render, cgi'

/**
 * Compose SD prompt with strict layer separation (I1).
 */
export function composeLayeredImagePrompt(input: LayeredPromptInput): LayeredPromptResult {
  const userText = (input.userText || '').trim()
  const scene = input.scene || parseSceneSpecFromText(userText)
  const outfit =
    input.outfit && input.outfit.items.length
      ? input.outfit
      : parseOutfitSpecFromText(userText)
  const useIdentity = input.useIdentity !== false && Boolean(input.identity) && scene.isSelf

  const framingBits = FRAMING_MAP[scene.framing] || FRAMING_MAP.half
  const identityBits =
    useIdentity && input.identity
      ? identityProfileToPromptBits(input.identity)
      : []
  const outfitBits = outfitSpecToPromptBits(outfit.source === 'none' ? emptyOutfitSpec() : outfit)

  // Scene fragments without re-injecting clothing already in outfit layer
  const frag = sceneSpecToSdFragments({
    ...scene,
    clothing: [] // clothing handled exclusively by OutfitSpec this turn
  })

  const sceneBits = [
    ...frag.positive.filter((p) => {
      const l = p.toLowerCase()
      return !outfitBits.some((o) => l.includes(o.toLowerCase().replace(/wearing /i, '')))
    }),
    scene.environment,
    scene.lighting,
    scene.pose,
    scene.mood,
    scene.timeOfDay ? `${scene.timeOfDay} lighting` : ''
  ].filter(Boolean) as string[]

  const positive = [
    ...QUALITY,
    ...framingBits,
    ...identityBits,
    ...outfitBits,
    ...sceneBits,
    ...(input.extraPositive || [])
  ]
    .filter(Boolean)
    .join(', ')

  const negParts = [
    BASE_NEG,
    ...frag.negative,
    ...(useIdentity && input.identity ? identityNegativeBits(input.identity) : []),
    ...outfitNegativeBits(outfit),
    ...(input.extraNegative || [])
  ]

  return {
    positive,
    negative: negParts.filter(Boolean).join(', '),
    layers: {
      identity: identityBits,
      outfit: outfitBits,
      scene: sceneBits,
      framing: framingBits
    },
    outfit,
    scene,
    isSelf: Boolean(scene.isSelf && useIdentity)
  }
}
