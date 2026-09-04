/**
 * Intelligent generative instruction → model-ready prompt.
 * FLUX.1 Schnell (and similar): full English prose, subject-first, no tag soup.
 * SD 1.5 local: can use shorter tag-style with quality tokens.
 */

export type ParsedImageIntent = {
  /** Core subject in English for model fidelity */
  subjectEn: string
  /** Original cleaned user words (any language) */
  subjectRaw: string
  isPhoto: boolean
  isPortrait: boolean
  isAnime: boolean
  /** Explicit attributes extracted */
  attributes: {
    gender?: 'female' | 'male' | 'neutral'
    eyeColor?: string
    hairColor?: string
    ageHint?: string
    clothing?: string
    setting?: string
  }
  /** Aspect preference from text if any */
  aspectHint?: 'portrait' | 'landscape' | 'square'
  scaleHint?: number
}

const EYE_COLORS: Record<string, string> = {
  azules: 'blue',
  azul: 'blue',
  blue: 'blue',
  verdes: 'green',
  verde: 'green',
  green: 'green',
  marrones: 'brown',
  cafes: 'brown',
  café: 'brown',
  cafe: 'brown',
  brown: 'brown',
  negros: 'dark brown',
  negro: 'dark brown',
  grises: 'grey',
  grey: 'grey',
  gray: 'grey',
  violetas: 'violet',
  morados: 'purple',
  purple: 'purple'
}

const HAIR_COLORS: Record<string, string> = {
  rubia: 'blonde',
  rubio: 'blonde',
  blonde: 'blonde',
  morena: 'dark brown',
  moreno: 'dark brown',
  castaña: 'brown',
  castaño: 'brown',
  negra: 'black',
  negro: 'black',
  black: 'black',
  pelirroja: 'red',
  red: 'red',
  rosa: 'pink',
  pink: 'pink',
  azul: 'blue',
  blue: 'blue',
  blanca: 'white',
  white: 'white'
}

/**
 * Parse user chat text into structured image intent (ES/EN).
 */
export function parseImageIntent(raw: string): ParsedImageIntent {
  const t = raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  const original = raw.trim()

  const isPhoto =
    /\b(foto|fotografia|photo|photograph|retrato fotograf|realist)\b/i.test(t) ||
    /\bhaz\s+una\s+foto\b/i.test(t)
  const isAnime = /\b(anime|manga|dibujo|ilustracion|cartoon)\b/i.test(t)
  const isPortrait =
    isPhoto ||
    /\b(retrato|portrait|primer plano|close[\s-]?up|cara|face)\b/i.test(t) ||
    /\b(chica|chico|mujer|hombre|girl|woman|man|boy)\b/i.test(t)

  const attributes: ParsedImageIntent['attributes'] = {}

  // Gender / person type
  if (/\b(chica|mujer|girl|woman|lady|senorita|señorita)\b/i.test(t)) {
    attributes.gender = 'female'
  } else if (/\b(chico|hombre|boy|man|guy|senor|señor)\b/i.test(t)) {
    attributes.gender = 'male'
  }

  // Eye color: "ojos azules" / "blue eyes"
  const eyeEs = t.match(/\bojos?\s+([a-záéíóú]+)/i)
  const eyeEn = t.match(/\b(blue|green|brown|grey|gray|hazel|purple|violet)\s+eyes?\b/i)
  if (eyeEs) {
    const c = EYE_COLORS[eyeEs[1]] || eyeEs[1]
    attributes.eyeColor = c
  } else if (eyeEn) {
    attributes.eyeColor = eyeEn[1].toLowerCase()
  }

  // Hair
  for (const [k, v] of Object.entries(HAIR_COLORS)) {
    if (new RegExp(`\\b(pelo|cabello|hair)\\s+${k}\\b`, 'i').test(t) || new RegExp(`\\b${k}\\s+(pelo|cabello|hair)\\b`, 'i').test(t)) {
      attributes.hairColor = v
      break
    }
  }

  // Age hints
  if (/\b(joven|young|teenager|adolescente)\b/i.test(t)) attributes.ageHint = 'young adult'
  if (/\b(\d{2})\s*años\b/i.test(t)) {
    const m = t.match(/\b(\d{2})\s*años\b/)
    if (m) attributes.ageHint = `about ${m[1]} years old`
  }

  // Aspect from text
  let aspectHint: ParsedImageIntent['aspectHint']
  if (/\b(vertical|retrato|portrait|9:16|3:4)\b/i.test(t)) aspectHint = 'portrait'
  if (/\b(horizontal|landscape|paisaje|16:9|4:3)\b/i.test(t)) aspectHint = 'landscape'
  if (/\b(cuadrad|square|1:1)\b/i.test(t)) aspectHint = 'square'

  let scaleHint: number | undefined
  if (/\b(el doble|2x|doble de grande|twice)\b/i.test(t)) scaleHint = 2
  if (/\b(mitad|0\.5x|más pequeña|mas pequena)\b/i.test(t)) scaleHint = 0.5

  // Build explicit English subject (critical for FLUX)
  const subjectParts: string[] = []
  if (attributes.gender === 'female') {
    subjectParts.push(attributes.ageHint ? `a ${attributes.ageHint} woman` : 'a young woman')
  } else if (attributes.gender === 'male') {
    subjectParts.push(attributes.ageHint ? `a ${attributes.ageHint} man` : 'a young man')
  } else if (isPortrait) {
    subjectParts.push('a person')
  }

  if (attributes.eyeColor) {
    subjectParts.push(`with striking ${attributes.eyeColor} eyes`)
  }
  if (attributes.hairColor) {
    subjectParts.push(`and ${attributes.hairColor} hair`)
  }

  // If we failed to parse gender but user said chica-like leftover text, keep raw
  let subjectEn = subjectParts.join(' ')
  if (!subjectEn || subjectEn === 'a person') {
    // Fallback: light cleanup of Spanish command words only
    subjectEn = original
      .replace(
        /\b(haz|genera|generame|genérame|crea|dibuja|por favor|please|una imagen de|una foto de|un dibujo de)\b/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Force human when gender detected (prevents animal/eye-only hallucinations)
  if (attributes.gender) {
    const human =
      attributes.gender === 'female'
        ? 'human female person, woman'
        : 'human male person, man'
    subjectEn = `${subjectEn}, ${human}`
  }

  const subjectRaw = original
    .replace(
      /\b(haz|genera|generame|genérame|crea|dibuja|por favor|please)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()

  return {
    subjectEn,
    subjectRaw,
    isPhoto: isPhoto || (!isAnime && isPortrait),
    isPortrait,
    isAnime,
    attributes,
    aspectHint,
    scaleHint
  }
}

/**
 * Compose final prompt for a specific backend family.
 */
export function composeImagePrompt(
  rawUser: string,
  family: 'flux' | 'sd15' | 'generic' = 'flux'
): { prompt: string; negativePrompt: string; parsed: ParsedImageIntent } {
  const parsed = parseImageIntent(rawUser)

  const negPhoto =
    'blurry, low quality, watermark, text, ugly, bad anatomy, extra limbs, ' +
    'anime, cartoon, illustration, painting, 3d render, cgi, doll, plastic skin, ' +
    'animal, bird, chick, puppy, kitten, non-human, fur, beak, feathers'

  const negAnime =
    'blurry, lowres, bad anatomy, watermark, photorealistic skin pores'

  if (family === 'flux' || family === 'generic') {
    // Natural language prose — FLUX best practice
    const sentences: string[] = []

    if (parsed.isPhoto || parsed.isPortrait) {
      sentences.push(
        `Professional photograph of ${parsed.subjectEn}.`
      )
      if (parsed.attributes.eyeColor) {
        sentences.push(
          `Her eyes are clearly ${parsed.attributes.eyeColor} and look natural, not animal-like.`
        )
      }
      sentences.push(
        'Head-and-shoulders portrait of a real human, natural skin texture, soft daylight, ' +
          'shot on 85mm lens at f/1.8, shallow depth of field, editorial portrait style.'
      )
      sentences.push('Photorealistic, not an illustration or cartoon.')
    } else if (parsed.isAnime) {
      sentences.push(`Anime illustration of ${parsed.subjectEn}.`)
      sentences.push('Clean lines, detailed face, vibrant colors.')
    } else {
      sentences.push(`Image of ${parsed.subjectEn}.`)
      sentences.push('High detail, coherent composition.')
    }

    // Keep a short echo of user wording for fidelity
    if (parsed.subjectRaw && parsed.subjectRaw.length < 120) {
      sentences.push(`User request: ${parsed.subjectRaw}.`)
    }

    return {
      prompt: sentences.join(' ').replace(/\s+/g, ' ').trim(),
      negativePrompt: parsed.isAnime ? negAnime : negPhoto,
      parsed
    }
  }

  // SD 1.5 tag style
  const tags = [
    parsed.subjectEn,
    parsed.isPhoto ? 'photorealistic, raw photo, 8k uhd' : '',
    parsed.attributes.eyeColor ? `${parsed.attributes.eyeColor} eyes` : '',
    'detailed face, sharp focus'
  ].filter(Boolean)
  return {
    prompt: tags.join(', '),
    negativePrompt: parsed.isAnime ? negAnime : negPhoto,
    parsed
  }
}

/**
 * Resolve width/height from settings + text hints.
 */
export function resolveImageSize(
  baseW: number,
  baseH: number,
  parsed: ParsedImageIntent
): { width: number; height: number } {
  let w = baseW || 768
  let h = baseH || 1024
  if (parsed.aspectHint === 'portrait' && w >= h) {
    // swap to portrait
    const a = Math.max(w, h)
    const b = Math.min(w, h)
    w = b
    h = a
  } else if (parsed.aspectHint === 'landscape' && h >= w) {
    const a = Math.max(w, h)
    const b = Math.min(w, h)
    w = a
    h = b
  } else if (parsed.aspectHint === 'square') {
    const s = Math.min(w, h)
    w = s
    h = s
  }
  if (parsed.scaleHint && parsed.scaleHint > 0) {
    w = Math.round(w * parsed.scaleHint)
    h = Math.round(h * parsed.scaleHint)
  }
  // Clamp sensible bounds for local SD / CF
  w = Math.min(1536, Math.max(256, Math.round(w / 8) * 8))
  h = Math.min(1536, Math.max(256, Math.round(h / 8) * 8))
  return { width: w, height: h }
}
