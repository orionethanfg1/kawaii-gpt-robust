/**
 * Text ↔ media bridge: chat intent + character → precise generation requests.
 */

import type { CharacterProfile } from '../character/profile'
import type { GenerativePlan } from './types'
import { composeImagePrompt, resolveImageSize } from './prompt-compose'

export type ImageGenRequest = {
  modality: 'image'
  prompt: string
  negativePrompt: string
  width: number
  height: number
  seed?: number
  meta: {
    source: 'user' | 'bridged'
    userPrompt: string
    styleApplied: boolean
    characterName?: string
  }
}

export type MusicGenRequest = {
  modality: 'music'
  stylePrompt: string
  lyrics?: string
  durationHintSec?: number
  meta: {
    source: 'user' | 'bridged'
    userPrompt: string
  }
}

export type VideoGenRequest = {
  modality: 'video'
  prompt: string
  durationHintSec?: number
  meta: {
    source: 'user' | 'bridged'
    userPrompt: string
  }
}

export type BridgedMediaRequest = ImageGenRequest | MusicGenRequest | VideoGenRequest

/** Strip command noise only — keep subject nouns (chica, ojos, etc.) */
export function sanitizeUserMediaPrompt(raw: string): string {
  return raw
    .replace(/^\s*\/(image|img|music|song|audio|video)\b/i, '')
    .replace(
      /\b(por favor|please|hazme|generame|genérame|puedes|podrías|podrias|quisiera|me gustaría|me gustaria)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
}

export function bridgeImageRequest(
  userPrompt: string,
  opts: {
    character?: CharacterProfile | null
    useCharacterStyle?: boolean
    width?: number
    height?: number
    seed?: number
    extraStyle?: string
    family?: 'flux' | 'sd15' | 'generic'
  } = {}
): ImageGenRequest {
  const family = opts.family || 'flux'
  const composed = composeImagePrompt(userPrompt, family)
  let { prompt, negativePrompt, parsed } = composed
  const size = resolveImageSize(opts.width ?? 768, opts.height ?? 1024, parsed)

  const asksForCharacter =
    /\b(tuya|tuyo|tuya para|foto tuya|imagen tuya|de ti(?:\s+misma)?|como t[uú]|tu avatar|autorretrato|selfie tuya|retrátate|retratate)\b/i.test(
      userPrompt
    ) ||
    (opts.character?.name
      ? new RegExp(
          `\\b${opts.character.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
          'i'
        ).test(userPrompt)
      : false)

  // Self-portrait: lead with identity, not a weak suffix (avoids random dual subjects)
  if (
    opts.useCharacterStyle !== false &&
    opts.character &&
    asksForCharacter
  ) {
    const name = (opts.character.name || 'character').trim()
    const look = (opts.character.visualDescription || '').trim().slice(0, 280)
    const vibe = (opts.character.tagline || '').trim().slice(0, 80)
    // Keep scene hints from user after stripping "foto tuya / genera..."
    const scene = sanitizeUserMediaPrompt(userPrompt)
      .replace(
        /\b(genera|generame|genérame|crea|haz|dibuja|ilustra|una|un|foto|imagen|retrato|picture|image|photo|tuya|tuyo|de ti|misma|mismo|por favor|please)\b/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim()
    const identity = look
      ? `solo portrait of one young woman named ${name}, ${look}`
      : `solo portrait of one character named ${name}${vibe ? `, ${vibe}` : ''}`
    prompt = [
      identity,
      'single person, one face only, looking at camera, natural expression',
      scene && scene.length > 3 ? scene : 'upper body, soft natural light',
      'photorealistic, detailed face, coherent identity, no duplicate people'
    ]
      .filter(Boolean)
      .join(', ')
    negativePrompt = [
      negativePrompt,
      'two people, twin, clone, duplicate face, multiple faces, crowd, couple, second person, mirror clone, extra head'
    ]
      .filter(Boolean)
      .join(', ')
  }
  if (opts.extraStyle) prompt = `${prompt} ${opts.extraStyle}`

  return {
    modality: 'image',
    prompt: prompt.replace(/\s+/g, ' ').trim(),
    negativePrompt,
    width: size.width,
    height: size.height,
    seed: opts.seed,
    meta: {
      source: 'bridged',
      userPrompt: parsed.subjectRaw || userPrompt.trim(),
      styleApplied: true,
      characterName: opts.character?.name
    }
  }
}

export function bridgeMusicRequest(userPrompt: string): MusicGenRequest {
  const cleaned = sanitizeUserMediaPrompt(userPrompt) || userPrompt.trim()
  const lyricMatch =
    cleaned.match(/["“]([^"”]+)["”]/) || cleaned.match(/\bletra[:\s]+([\s\S]+)/i)
  let lyrics: string | undefined
  let stylePrompt = cleaned
  if (lyricMatch) {
    lyrics = lyricMatch[1].trim()
    stylePrompt =
      cleaned.replace(lyricMatch[0], '').trim() || 'pop, clear vocals, studio quality'
  }
  if (
    !/\b(bpm|pop|rock|lo-?fi|jazz|electronic|hip-?hop|ballad|metal|ambient)\b/i.test(
      stylePrompt
    )
  ) {
    stylePrompt = `${stylePrompt}, melodic, well-mixed, high quality`.trim()
  }
  return {
    modality: 'music',
    stylePrompt,
    lyrics,
    durationHintSec: 120,
    meta: { source: 'bridged', userPrompt: cleaned }
  }
}

export function bridgeVideoRequest(userPrompt: string): VideoGenRequest {
  const cleaned = sanitizeUserMediaPrompt(userPrompt) || userPrompt.trim()
  return {
    modality: 'video',
    prompt: `${cleaned}, smooth motion, coherent scene, high quality`.replace(/\s+/g, ' '),
    durationHintSec: 4,
    meta: { source: 'bridged', userPrompt: cleaned }
  }
}

export function bridgePlanToRequests(
  plan: GenerativePlan,
  opts: {
    character?: CharacterProfile | null
    useCharacterStyle?: boolean
    imageWidth?: number
    imageHeight?: number
    family?: 'flux' | 'sd15' | 'generic'
  } = {}
): BridgedMediaRequest[] {
  const out: BridgedMediaRequest[] = []
  for (const job of plan.sideJobs) {
    if (job.modality === 'image') {
      out.push(
        bridgeImageRequest(job.prompt, {
          character: opts.character,
          useCharacterStyle: opts.useCharacterStyle,
          width: opts.imageWidth,
          height: opts.imageHeight,
          family: opts.family || 'flux'
        })
      )
    } else if (job.modality === 'music') {
      out.push(bridgeMusicRequest(job.prompt))
    } else if (job.modality === 'video') {
      out.push(bridgeVideoRequest(job.prompt))
    }
  }
  return out
}

export function textHubMediaHint(requests: BridgedMediaRequest[]): string | null {
  if (!requests.length) return null
  const lines = requests.map((r) => {
    if (r.modality === 'image') {
      return `Imagen encolada: "${r.prompt.slice(0, 180)}${r.prompt.length > 180 ? '…' : ''}" (${r.width}×${r.height})`
    }
    if (r.modality === 'music') {
      return `Música encolada: "${r.stylePrompt.slice(0, 120)}"${r.lyrics ? ' + letra' : ''}`
    }
    return `Video encolado: "${r.prompt.slice(0, 120)}"`
  })
  return (
    'El sistema genera medios en paralelo. No inventes URLs ni digas que ya enviaste un archivo. ' +
    lines.join(' ')
  )
}
