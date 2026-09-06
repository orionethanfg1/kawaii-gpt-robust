/**
 * Intelligent generative instruction → high-quality model prompts.
 * Inspired by Grok / ChatGPT image clients: expand sparse requests,
 * honor detailed descriptions, pick framing (close-up / full body),
 * and emit backend-specific prompt styles (FLUX prose vs SD1.5 tags).
 */

export type ShotFraming =
  | 'close-up'
  | 'portrait'
  | 'upper-body'
  | 'cowboy'
  | 'full-body'
  | 'wide'

export type ParsedImageIntent = {
  subjectEn: string
  subjectRaw: string
  isPhoto: boolean
  isPortrait: boolean
  isAnime: boolean
  framing: ShotFraming
  attributes: {
    gender?: 'female' | 'male' | 'neutral'
    eyeColor?: string
    hairColor?: string
    hairStyle?: string
    ageHint?: string
    expression?: string
    clothing?: string
    setting?: string
    pose?: string
    extras?: string[]
  }
  aspectHint?: 'portrait' | 'landscape' | 'square'
  scaleHint?: number
  /** User gave a rich description — keep more of their wording */
  isDetailed: boolean
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
  hazel: 'hazel',
  miel: 'hazel',
  negros: 'dark brown',
  negro: 'dark brown',
  grises: 'grey',
  grey: 'grey',
  gray: 'grey',
  violetas: 'violet',
  morados: 'purple',
  purple: 'purple',
  rosa: 'pink',
  pink: 'pink',
  rojo: 'vivid red',
  rojos: 'vivid red',
  red: 'vivid red',
  crimson: 'crimson'
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
  pelirrojo: 'red',
  rosa: 'pink',
  pink: 'pink',
  azul: 'blue',
  blue: 'blue',
  blanca: 'white',
  white: 'white',
  plateada: 'silver',
  silver: 'silver'
}

function mapColor(token: string, table: Record<string, string>): string {
  const k = token
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
  return table[k] || table[token.toLowerCase()] || token
}

/**
 * Parse user chat text into structured image intent (ES/EN).
 */
export function parseImageIntent(raw: string): ParsedImageIntent {
  const t = raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  const original = raw.trim()

  const isPhoto =
    /\b(foto|fotografia|photo|photograph|retrato fotograf|realist|selfie)\b/i.test(t) ||
    /\bhaz\s+una\s+foto\b/i.test(t) ||
    /\bgenera\s+(una\s+)?(imagen|foto)\b/i.test(t)
  const isAnime = /\b(anime|manga|dibujo|ilustracion|cartoon)\b/i.test(t)

  // Framing — explicit first, then smart default
  let framing: ShotFraming = 'portrait'
  if (
    /\b(cuerpo completo|full[\s-]?body|de pies a cabeza|enter[ao]|whole body|full length)\b/i.test(
      t
    )
  ) {
    framing = 'full-body'
  } else if (/\b(cowboy shot|3\/4|tres cuartos|plano americano)\b/i.test(t)) {
    framing = 'cowboy'
  } else if (
    /\b(medio cuerpo|half[\s-]?body|upper body|cintura|waist[\s-]?up|torso)\b/i.test(t)
  ) {
    framing = 'upper-body'
  } else if (
    /\b(primer plano|close[\s-]?up|macro|solo la cara|face only|detalle de cara)\b/i.test(t)
  ) {
    framing = 'close-up'
  } else if (/\b(plano general|wide shot|landscape scene|escena amplia)\b/i.test(t)) {
    framing = 'wide'
  } else if (
    // Sparse person request without framing → full-body looks more "ChatGPT-like"
    /\b(chica|chico|mujer|hombre|girl|woman|man|boy|person)\b/i.test(t) &&
    !/\b(cara|face|retrato|portrait|ojos|eyes)\b/i.test(t)
  ) {
    framing = 'full-body'
  } else if (/\b(retrato|portrait|cara|face|ojos)\b/i.test(t)) {
    framing = 'portrait'
  }

  const isPortrait =
    framing === 'close-up' ||
    framing === 'portrait' ||
    framing === 'upper-body' ||
    isPhoto

  const attributes: ParsedImageIntent['attributes'] = {}

  if (/\b(chica|mujer|girl|woman|lady|senorita|señorita|ella)\b/i.test(t)) {
    attributes.gender = 'female'
  } else if (/\b(chico|hombre|boy|man|guy|senor|señor|el )\b/i.test(t)) {
    attributes.gender = 'male'
  }

  // Eyes — multiple patterns: "ojos rojos", "ojos de color rojo", "con ojos azules", "blue eyes"
  const eyePatterns = [
    /\bojos?\s+(?:de\s+color\s+)?([a-záéíóúü]+)/i,
    /\bcon\s+ojos?\s+([a-záéíóúü]+)/i,
    /\b(blue|green|brown|grey|gray|hazel|purple|violet|red|crimson|pink)\s+eyes?\b/i,
    /\beyes?\s+(?:are\s+|of\s+)?(blue|green|brown|grey|gray|hazel|purple|violet|red|crimson|pink)\b/i
  ]
  for (const re of eyePatterns) {
    const m = t.match(re)
    if (m) {
      attributes.eyeColor = mapColor(m[1], EYE_COLORS)
      break
    }
  }

  // Hair color only with hair words
  for (const [k, v] of Object.entries(HAIR_COLORS)) {
    const hairNear =
      new RegExp(`\\b(pelo|cabello|hair)\\s+${k}\\b`, 'i').test(t) ||
      new RegExp(`\\b${k}\\s+(pelo|cabello|hair)\\b`, 'i').test(t) ||
      (/\bpelirroj/i.test(t) && (k === 'pelirroja' || k === 'pelirrojo'))
    if (hairNear) {
      attributes.hairColor = v
      break
    }
  }
  if (attributes.eyeColor && /red|crimson/i.test(attributes.eyeColor)) {
    // avoid red-hair bleed
    if (attributes.hairColor && /red/i.test(attributes.hairColor)) {
      delete attributes.hairColor
    }
  }

  // Hair style
  if (/\b(largo|long hair)\b/i.test(t)) attributes.hairStyle = 'long hair'
  else if (/\b(corto|short hair)\b/i.test(t)) attributes.hairStyle = 'short hair'
  else if (/\b(rizado|curly)\b/i.test(t)) attributes.hairStyle = 'curly hair'
  else if (/\b(liso|straight hair)\b/i.test(t)) attributes.hairStyle = 'straight hair'
  else if (/\b(coleta|pony[\s-]?tail)\b/i.test(t)) attributes.hairStyle = 'ponytail'
  else if (/\b(trenza|braid)\b/i.test(t)) attributes.hairStyle = 'braided hair'

  // Age
  if (/\b(joven|young|teenager|adolescente)\b/i.test(t)) attributes.ageHint = 'young adult'
  const ageM = t.match(/\b(\d{2})\s*a[nñ]os\b/i)
  if (ageM) attributes.ageHint = `about ${ageM[1]} years old`
  if (/\b(madur[ao]|middle[\s-]?aged)\b/i.test(t)) attributes.ageHint = 'middle-aged'

  // Expression
  if (/\b(sonrisa|smiling|smile)\b/i.test(t)) attributes.expression = 'gentle smile'
  else if (/\b(seria|serious)\b/i.test(t)) attributes.expression = 'serious expression'
  else if (/\b(alegre|happy|feliz)\b/i.test(t)) attributes.expression = 'happy expression'
  else if (/\b(triste|sad)\b/i.test(t)) attributes.expression = 'sad expression'

  // Clothing (simple capture)
  const cloth =
    t.match(
      /\b(?:con|in|wearing)\s+(vestido|dress|camiseta|shirt|abrigo|coat|falda|skirt|traje|suit|hoodie|jersey)\b(?:\s+[a-záéíóú]+)?/i
    ) ||
    t.match(
      /\b(vestido|dress|camiseta|shirt|vest|hoodie)\s+(rojo|azul|negro|blanco|rosa|red|blue|black|white|pink)\b/i
    )
  if (cloth) attributes.clothing = cloth[0]

  // Setting / background
  if (/\b(playa|beach)\b/i.test(t)) attributes.setting = 'on a beach, ocean background'
  else if (/\b(ciudad|city|street|calle)\b/i.test(t)) attributes.setting = 'urban street'
  else if (/\b(bosque|forest)\b/i.test(t)) attributes.setting = 'in a forest'
  else if (/\b(estudio|studio)\b/i.test(t)) attributes.setting = 'studio backdrop'
  else if (/\b(noche|night)\b/i.test(t)) attributes.setting = 'night scene'
  else if (/\b(interior|indoor|casa|room)\b/i.test(t)) attributes.setting = 'indoor setting'
  else if (/\b(parque|park)\b/i.test(t)) attributes.setting = 'in a park'

  // Pose
  if (/\b(de pie|standing)\b/i.test(t)) attributes.pose = 'standing'
  else if (/\b(sentad[ao]|sitting)\b/i.test(t)) attributes.pose = 'sitting'
  else if (/\b(caminando|walking)\b/i.test(t)) attributes.pose = 'walking'
  else if (/\b(mirando a la c[aá]mara|looking at (the )?camera|looking at viewer)\b/i.test(t))
    attributes.pose = 'looking at viewer'

  const extras: string[] = []
  if (/\b(maquillaje|makeup)\b/i.test(t)) extras.push('natural makeup')
  if (/\b(freckles|pecas)\b/i.test(t)) extras.push('freckles')
  if (/\b(gafas|glasses)\b/i.test(t)) extras.push('wearing glasses')
  if (extras.length) attributes.extras = extras

  let aspectHint: ParsedImageIntent['aspectHint']
  if (/\b(vertical|retrato|portrait|9:16|3:4)\b/i.test(t)) aspectHint = 'portrait'
  if (/\b(horizontal|landscape|16:9|wide)\b/i.test(t)) aspectHint = 'landscape'
  if (/\b(cuadrad|square|1:1)\b/i.test(t)) aspectHint = 'square'
  if (!aspectHint) {
    aspectHint =
      framing === 'full-body' || framing === 'cowboy' || framing === 'wide'
        ? 'portrait'
        : framing === 'close-up'
          ? 'square'
          : 'portrait'
  }

  let scaleHint: number | undefined
  if (/\b(el doble|2x|2\s*x|doble)\b/i.test(t)) scaleHint = 2
  if (/\b(4k|ultra)\b/i.test(t)) scaleHint = 1.5

  // Subject English core
  let subjectEn = ''
  if (attributes.gender === 'female') subjectEn = 'a young woman'
  else if (attributes.gender === 'male') subjectEn = 'a young man'
  else if (/\b(persona|person|someone)\b/i.test(t)) subjectEn = 'a person'
  else subjectEn = 'a young woman'

  if (attributes.ageHint) subjectEn = subjectEn.replace('young ', '') + `, ${attributes.ageHint}`

  // Detailed if long or many attributes
  const attrCount = Object.keys(attributes).filter((k) => k !== 'extras').length + (extras.length ? 1 : 0)
  const isDetailed = original.length > 80 || attrCount >= 3

  // Strip command verbs for subjectRaw cleanup
  const subjectRaw = original
    .replace(
      /^(haz|genera|crea|dibuja|make|generate|create|draw|paint)\s+(una?\s+)?(foto|imagen|image|picture|retrato)?\s*(de\s+|of\s+)?/i,
      ''
    )
    .trim()

  return {
    subjectEn,
    subjectRaw: subjectRaw || original,
    isPhoto: isPhoto || !isAnime,
    isPortrait,
    isAnime,
    framing,
    attributes,
    aspectHint,
    scaleHint,
    isDetailed
  }
}

function framingTags(framing: ShotFraming): string[] {
  switch (framing) {
    case 'close-up':
      return ['close-up', 'face focus', 'detailed face', 'head only']
    case 'portrait':
      return ['portrait', 'head and shoulders', 'upper body']
    case 'upper-body':
      return ['upper body', 'waist up']
    case 'cowboy':
      return ['cowboy shot', 'thighs up', 'medium full shot']
    case 'full-body':
      return ['full body', 'standing full length', 'head to toe', 'entire figure visible']
    case 'wide':
      return ['wide shot', 'environmental portrait', 'full scene']
    default:
      return ['portrait']
  }
}

function framingProse(framing: ShotFraming): string {
  switch (framing) {
    case 'close-up':
      return 'Extreme close-up on the face, eyes and skin texture highly detailed.'
    case 'portrait':
      return 'Head-and-shoulders portrait, subject fills the frame.'
    case 'upper-body':
      return 'Upper body from the waist up, natural posture.'
    case 'cowboy':
      return 'Cowboy shot from mid-thigh up.'
    case 'full-body':
      return 'Full-body shot, head to toe, entire figure visible, balanced composition.'
    case 'wide':
      return 'Wide environmental shot with the subject in context.'
    default:
      return 'Portrait framing.'
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
  const a = parsed.attributes

  const negPhoto =
    'blurry, low quality, watermark, text, ugly, bad anatomy, extra limbs, ' +
    '(two people:1.45), (multiple people:1.4), (twins:1.35), (clone:1.3), ' +
    '(double face:1.6), (two faces:1.6), (multiple faces:1.55), (extra head:1.45), twin, clone, second person, couple, crowd, stacked faces, face on face, ' +
    'mirror reflection, split face, fused faces, mutated hands, ' +
    'anime, cartoon, illustration, painting, 3d render, cgi, doll, plastic skin, ' +
    'animal, bird, chick, puppy, kitten, non-human, fur, beak, feathers'

  const negAnime =
    'blurry, lowres, bad anatomy, watermark, photorealistic skin pores, 3d render'

  if (family === 'flux' || family === 'generic') {
    const sentences: string[] = []

    if (parsed.isAnime) {
      sentences.push(`Anime illustration of ${parsed.subjectEn}.`)
    } else {
      sentences.push(
        `Professional photograph of ${parsed.subjectEn}, ${framingProse(parsed.framing)}`
      )
    }

    if (a.eyeColor) {
      const unusual = /red|crimson|violet|purple|pink/i.test(a.eyeColor)
      sentences.push(
        unusual
          ? `Irises are distinctly ${a.eyeColor} (eye color only — not the hair). Natural hair color unless specified.`
          : `Eyes are clearly ${a.eyeColor}.`
      )
    }
    if (a.hairColor) sentences.push(`Hair is ${a.hairColor}.`)
    else if (a.eyeColor && /red|crimson/i.test(a.eyeColor))
      sentences.push('Brown or dark natural hair (not red).')
    if (a.hairStyle) sentences.push(a.hairStyle + '.')
    if (a.expression) sentences.push(`${a.expression}.`)
    if (a.clothing) sentences.push(`Wearing ${a.clothing}.`)
    if (a.pose) sentences.push(`Pose: ${a.pose}.`)
    if (a.setting) sentences.push(`Setting: ${a.setting}.`)
    if (a.extras?.length) sentences.push(a.extras.join(', ') + '.')

    if (parsed.isDetailed && parsed.subjectRaw.length < 220) {
      sentences.push(`Details from user: ${parsed.subjectRaw}.`)
    }

    if (!parsed.isAnime) {
      sentences.push(
        'Single subject only, one face. Photorealistic, natural skin texture, soft daylight, ' +
          'shot on 85mm lens, shallow depth of field, high detail, editorial quality.'
      )
    } else {
      sentences.push('Clean lines, detailed face, vibrant colors, single character.')
    }

    return {
      prompt: sentences.join(' ').replace(/\s+/g, ' ').trim(),
      negativePrompt: parsed.isAnime ? negAnime : negPhoto,
      parsed
    }
  }

  // —— SD 1.5 / Realistic Vision tags ——
  const tags: string[] = []
  if (parsed.isAnime) {
    tags.push('masterpiece', 'best quality', 'anime style')
  } else {
    tags.push('(masterpiece:1.15)', '(best quality:1.15)', 'photorealistic', 'raw photo', '8k')
  }

  tags.push(parsed.subjectEn)
  tags.push('solo', 'single person', 'one face only', 'one head only')
  tags.push(...framingTags(parsed.framing))

  if (a.eyeColor) {
    const ec = a.eyeColor
    const unusual = /red|crimson|violet|purple|pink/i.test(ec)
    if (unusual) {
      tags.push(`(${ec} eyes:1.55)`, `(${ec} irises:1.4)`, 'detailed eyes')
    } else {
      tags.push(`(${ec} eyes:1.3)`, 'detailed eyes')
    }
  }
  if (a.hairColor) tags.push(`${a.hairColor} hair`)
  else if (a.eyeColor && /red|crimson/i.test(a.eyeColor)) {
    tags.push('brown hair', 'natural brunette hair')
  }
  if (a.hairStyle) tags.push(a.hairStyle)
  if (a.ageHint) tags.push(a.ageHint)
  if (a.expression) tags.push(a.expression)
  if (a.clothing) tags.push(a.clothing)
  if (a.pose) tags.push(a.pose)
  if (a.setting) tags.push(a.setting)
  if (a.extras) tags.push(...a.extras)

  // Quality / camera — denser when user was sparse (Grok/ChatGPT-like uplift)
  if (!parsed.isAnime) {
    tags.push(
      'natural skin texture',
      'soft daylight',
      '85mm lens',
      'shallow depth of field',
      'sharp focus',
      'looking at viewer'
    )
  }

  // Echo key user phrases if detailed (clip budget ~75 tokens — keep short)
  if (parsed.isDetailed && parsed.subjectRaw.length < 100) {
    tags.push(parsed.subjectRaw.slice(0, 80))
  }

  let negSd = parsed.isAnime
    ? negAnime + ', photorealistic, 3d render'
    : negPhoto +
      ', (worst quality:1.2), (low quality:1.2), jpeg artifacts, deformed face, asymmetrical eyes'

  if (a.eyeColor && /red|crimson|violet|purple|pink/i.test(a.eyeColor)) {
    negSd +=
      ', brown eyes, hazel eyes, dark eyes, black eyes, green eyes, blue eyes, grey eyes, ' +
      'red hair, auburn hair, ginger hair, dyed red hair, pink hair'
  } else if (a.eyeColor && /blue/i.test(a.eyeColor)) {
    negSd += ', brown eyes, hazel eyes, green eyes, red eyes'
  } else if (a.eyeColor && /green/i.test(a.eyeColor)) {
    negSd += ', brown eyes, hazel eyes, blue eyes, red eyes'
  }

  if (parsed.framing === 'full-body') {
    negSd += ', cropped head, cut off feet, out of frame, incomplete body'
  }

  return {
    prompt: tags.filter(Boolean).join(', '),
    negativePrompt: negSd,
    parsed
  }
}

/** ChatGPT/Grok-like defaults; local SD prefers slightly smaller native sizes */
const SIZE_PRESETS = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 896, height: 1152 },
  landscape: { width: 1152, height: 896 }
}

const SIZE_SD15 = {
  'close-up': { width: 768, height: 768 },
  portrait: { width: 768, height: 1024 },
  'upper-body': { width: 768, height: 1024 },
  cowboy: { width: 768, height: 1152 },
  'full-body': { width: 768, height: 1152 },
  wide: { width: 1024, height: 768 }
}

/**
 * Resolve width/height from settings + text hints.
 */
export function resolveImageSize(
  rawUser: string,
  opts?: { width?: number; height?: number; family?: 'flux' | 'sd15' | 'generic' }
): { width: number; height: number } {
  const parsed = parseImageIntent(rawUser)
  if (opts?.width && opts?.height) {
    let w = opts.width
    let h = opts.height
    if (parsed.scaleHint) {
      w = Math.round(w * parsed.scaleHint)
      h = Math.round(h * parsed.scaleHint)
    }
    const clamp = (n: number) => Math.min(1536, Math.max(256, Math.round(n / 64) * 64))
    return { width: clamp(w), height: clamp(h) }
  }

  if (opts?.family === 'sd15') {
    const base = SIZE_SD15[parsed.framing] || SIZE_SD15.portrait
    let w = base.width
    let h = base.height
    if (parsed.scaleHint) {
      w = Math.round(w * parsed.scaleHint)
      h = Math.round(h * parsed.scaleHint)
    }
    const clamp = (n: number) => Math.min(1536, Math.max(256, Math.round(n / 64) * 64))
    return { width: clamp(w), height: clamp(h) }
  }

  const aspect = parsed.aspectHint || 'portrait'
  let { width: w, height: h } =
    aspect === 'landscape'
      ? SIZE_PRESETS.landscape
      : aspect === 'square'
        ? SIZE_PRESETS.square
        : SIZE_PRESETS.portrait
  if (parsed.framing === 'full-body' || parsed.framing === 'cowboy') {
    w = 896
    h = 1344
  }
  if (parsed.scaleHint) {
    w = Math.round(w * parsed.scaleHint)
    h = Math.round(h * parsed.scaleHint)
  }
  const clamp = (n: number) => Math.min(1536, Math.max(256, Math.round(n / 64) * 64))
  return { width: clamp(w), height: clamp(h) }
}

/** Recommended sampler settings for local SD (Realistic Vision / SD1.5) */
export function recommendSdParams(opts: {
  prompt: string
  unusualAttributes?: boolean
  framing?: ShotFraming
}): { steps: number; cfgScale: number; width: number; height: number } {
  const unusual =
    opts.unusualAttributes ||
    /\(red eyes|crimson|violet|purple eyes|pink eyes|:1\.[3-9]/i.test(opts.prompt)
  const framing = opts.framing || 'portrait'
  const size = SIZE_SD15[framing] || SIZE_SD15.portrait
  return {
    steps: unusual ? 32 : 28,
    cfgScale: unusual ? 9 : 6.5,
    width: size.width,
    height: size.height
  }
}
