/**
 * Text ↔ media bridge: chat intent + character → precise generation requests.
 */

import type { CharacterProfile } from '../character/profile'
import { effectiveVisualDescription } from '../character/profile'
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


/** Pull hard visual tokens from free-text description for SD weighting */
function lookTraitsFromDescription(look: string): string {
  const t = look.toLowerCase()
  const tags: string[] = []
  if (/cabello\s+rojo|pelo\s+rojo|red\s+hair|ginger|pelirroj/i.test(look)) {
    tags.push('(long wavy red hair:1.35)', 'auburn red hair', 'ginger hair')
  } else if (/rubia|blonde|cabello\s+rubio|pelo\s+rubio/i.test(look)) {
    tags.push('(blonde hair:1.3)')
  } else if (/casta[nñ]o|brunette|brown hair|pelo\s+casta/i.test(look)) {
    tags.push('(brown hair:1.25)')
  } else if (/negro|black hair|pelo\s+negro|cabello\s+negro/i.test(look)) {
    tags.push('(black hair:1.25)')
  }
  if (/ojos\s+verdes|green eyes/i.test(look)) tags.push('(green eyes:1.2)')
  if (/ojos\s+azules|blue eyes/i.test(look)) tags.push('(blue eyes:1.2)')
  if (/ojos\s+(caf[eé]|marr[oó]n|brown)|brown eyes/i.test(look)) tags.push('(brown eyes:1.15)')
  if (/p[aá]lida|fair skin|piel clara/i.test(look)) tags.push('fair skin')
  if (/vestido\s+rojo|red dress/i.test(look)) tags.push('red dress')
  if (/cuero|leather/i.test(look)) tags.push('black leather outfit')
  return tags.join(', ')
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
    /\b(tuya|tuyo|foto tuya|imagen tuya|de ti(?:\s+misma)?|como t[uú]|tu avatar|autorretrato|selfie|env[ií]a(?:me|rme).*foto|m[aá]nda(?:me|rme).*foto)\b/i.test(
      userPrompt
    ) ||
    (opts.character?.name
      ? new RegExp(
          `\\b${opts.character.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
          'i'
        ).test(userPrompt)
      : false)

  // Self-portrait: identity FIRST (ChatGPT/Grok-style consistent character)
  if (opts.useCharacterStyle !== false && opts.character && asksForCharacter) {
    const name = (opts.character.name || 'character').trim()
    const look = (
      effectiveVisualDescription(opts.character) ||
      (opts.character.visualDescription || '').trim()
    ).slice(0, 480)
    const scene = sanitizeUserMediaPrompt(userPrompt)
      .replace(
        /\b(genera|generame|genérame|crea|haz|dibuja|env[ií]a(?:me|rme)|m[aá]nda(?:me|rme)|muéstrame|muestrame|una|un|foto|imagen|retrato|picture|image|photo|tuya|tuyo|de ti|misma|mismo|por favor|please|selfie|autorretrato)\b/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim()
    // Keep look near the start of the prompt (SD pays more attention to early tokens)
    const traitTags = look ? lookTraitsFromDescription(look) : ''
    const identity = look
      ? `(masterpiece:1.2), (best quality:1.15), photorealistic portrait of ${name}, ${traitTags ? traitTags + ', ' : ''}(${look}:1.3)`
      : `(masterpiece:1.1), photorealistic portrait of one young woman named ${name}`
    prompt = [
      identity,
      'solo one person, single subject, one face only, looking at camera',
      'upper body headshot, shallow depth of field, soft natural light, realistic skin texture',
      scene && scene.length > 3 ? scene : '',
      'coherent identity matching description, detailed face, sharp eyes, accurate hair color'
    ]
      .filter(Boolean)
      .join(', ')
    const antiHair = /red hair|pelirroj|cabello rojo|pelo rojo/i.test(look)
      ? '(black hair:1.2), (brown hair:1.2), (brunette:1.2), (blonde hair:1.15),'
      : ''
    negativePrompt = [
      negativePrompt,
      antiHair,
      '(two people:1.4), (twin:1.3), (clone:1.3), (duplicate:1.3), (multiple faces:1.4), (double face:1.4),',
      'extra head, second person, couple, crowd, mirror image, split face, fused faces,',
      'deformed face, asymmetrical eyes, blurry, lowres, worst quality, watermark, text, wrong hair color'
    ]
      .filter(Boolean)
      .join(' ')
  }
  // Any human portrait: force single subject (SD often doubles faces otherwise)
  const looksHumanPortrait =
    /\b(chica|chico|mujer|hombre|girl|woman|man|person|retrato|portrait|cara|face|ojos|eyes|selfie)\b/i.test(
      userPrompt
    ) || parsed.isPortrait || parsed.isPhoto
  if (looksHumanPortrait && !asksForCharacter) {
    prompt = [
      prompt,
      'solo one person, single subject, one face only, looking at camera',
      'upper body headshot, coherent anatomy'
    ].join(', ')
    negativePrompt = [
      negativePrompt,
      '(two people:1.45), (multiple faces:1.5), (double face:1.5), twins, clone, extra head,',
      'second person, couple, crowd, mirror image, split face, fused faces'
    ].join(' ')
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
