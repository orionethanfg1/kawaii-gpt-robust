/**
 * Fail-soft facade for generative planning.
 * If intent/bridge/registry throw, chat continues as pure text.
 */

import type { CharacterProfile } from '../character/profile'
import type { BridgedMediaRequest } from './bridge'
import type { GenerativePlan } from './types'
import { buildCapabilityRegistry, modalityAvailable } from './registry'
import { planGenerativeTurn } from './intent'
import { bridgePlanToRequests, textHubMediaHint } from './bridge'

export type SafePlanResult = {
  plan: GenerativePlan
  mediaRequests: BridgedMediaRequest[]
  mediaHint: string | null
  error?: string
}

const PURE_TEXT: SafePlanResult = {
  plan: { useText: true, sideJobs: [], reason: 'Texto (fallback seguro)' },
  mediaRequests: [],
  mediaHint: null
}

export function safePlanGenerativeTurn(
  userText: string,
  opts: {
    imageGenEnabled?: boolean
    imageProviderMode?: 'off' | 'cloud' | 'local' | 'smart'
    musicEnabled?: boolean
    videoEnabled?: boolean
    character?: CharacterProfile | null
    useCharacterStyle?: boolean
    imageWidth?: number
    imageHeight?: number
  }
): SafePlanResult {
  try {
    const genCaps = buildCapabilityRegistry({
      imageGenEnabled: opts.imageGenEnabled,
      imageProviderMode: opts.imageProviderMode,
      musicEnabled: opts.musicEnabled,
      videoEnabled: opts.videoEnabled
    })
    const plan = planGenerativeTurn(userText, {
      image: modalityAvailable(genCaps, 'image'),
      music: modalityAvailable(genCaps, 'music'),
      video: modalityAvailable(genCaps, 'video')
    })
    // Local Forge/A1111 models (Realistic Vision, SD1.5) need tag prompts, not FLUX prose
    const family =
      opts.imageProviderMode === 'local' || opts.imageProviderMode === 'smart'
        ? 'sd15'
        : 'flux'
    const mediaRequests = bridgePlanToRequests(plan, {
      character: opts.character,
      useCharacterStyle: opts.useCharacterStyle,
      imageWidth: opts.imageWidth,
      imageHeight: opts.imageHeight,
      family
    })
    return {
      plan,
      mediaRequests,
      mediaHint: textHubMediaHint(mediaRequests)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[generative:safe] fallback to text-only:', message)
    return { ...PURE_TEXT, error: message }
  }
}
