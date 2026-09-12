/**
 * Local SD prompt composition — identity + style presets (Perchance-like quality without remote APIs).
 * Focus: one consistent character for the app user; host-owned facts only.
 */

export type ImageFraming = 'portrait' | 'half' | 'full' | 'wide'

export type ImageStyleId =
  | 'casual_photo'
  | 'portrait_studio'
  | 'cinematic'
  | 'anime'
  | 'soft_portrait'
  | 'auto'

export type ParsedImageIntent = {
  framing: ImageFraming
  isSelf: boolean
  /** User explicitly asked for someone else (not the character) */
  explicitOther?: boolean
  style: ImageStyleId
  raw: string
}

export type ComposeOpts = {
  visualDescription?: string
  characterName?: string
  useCharacter?: boolean
  /** Override auto style detection */
  style?: ImageStyleId
}

export type StylePreset = {
  id: Exclude<ImageStyleId, 'auto'>
  label: string
  positive: string
  negative: string
  cfgScale: number
  steps: number
}

/** Style packs = prompt injection (same idea as Perchance art-style dropdown). */
export const STYLE_PRESETS: Record<Exclude<ImageStyleId, 'auto'>, StylePreset> = {
  casual_photo: {
    id: 'casual_photo',
    label: 'Foto casual',
    positive:
      'photorealistic, raw photo, casual photography, natural lighting, 85mm lens, shallow depth of field, realistic skin pores, subtle film grain',
    negative:
      'illustration, anime, 3d render, cgi, plastic skin, oversmoothed, heavy makeup airbrush, studio backdrop only',
    cfgScale: 6.5,
    steps: 30
  },
  portrait_studio: {
    id: 'portrait_studio',
    label: 'Retrato estudio',
    positive:
      'photorealistic studio portrait, softbox lighting, catchlights in eyes, detailed iris, professional headshot, clean background',
    negative: 'harsh shadows, underexposed, cartoon, anime, painting, blurry eyes',
    cfgScale: 7,
    steps: 32
  },
  cinematic: {
    id: 'cinematic',
    label: 'Cinemático',
    positive:
      'cinematic still, dramatic lighting, color graded, shallow DOF, film still, anamorphic bokeh, highly detailed',
    negative: 'flat lighting, snapshot, overexposed, low detail',
    cfgScale: 7,
    steps: 32
  },
  anime: {
    id: 'anime',
    label: 'Anime',
    positive:
      'anime style, clean lineart, detailed eyes, vibrant colors, high quality illustration, key visual',
    negative: 'photorealistic, photograph, 3d, western cartoon, blurry lineart',
    cfgScale: 7.5,
    steps: 28
  },
  soft_portrait: {
    id: 'soft_portrait',
    label: 'Retrato suave',
    positive:
      'soft natural portrait, gentle smile, warm ambient light, realistic skin texture, intimate framing',
    negative: 'harsh contrast, horror, grotesque, deformed face',
    cfgScale: 6.5,
    steps: 30
  }
}

const QUALITY_CORE = '(masterpiece:1.2), (best quality:1.2), highly detailed'

const NEG_ANATOMY =
  'two heads, two faces, double head, extra limbs, extra fingers, fused fingers, deformed hands, mutated hands, bad anatomy, bad proportions, disfigured, blurry, low quality, jpeg artifacts, watermark, text, logo, signature, multiple people, crowd, clone, identity mismatch, different person, wrong hair color, asymmetrical eyes'

/** Expand Spanish (and common) look phrases → English SD tags. */
export function visualDescriptionToTags(desc: string): string {
  let s = (desc || '').trim()
  if (!s) return ''
  const pairs: [RegExp, string][] = [
    [/cabello\s+largo\s+y\s+rojo/gi, 'long red hair'],
    [/cabello\s+rojo\s+largo/gi, 'long red hair'],
    [/pelo\s+largo\s+rojo/gi, 'long red hair'],
    [/cabello\s+rojo/gi, 'red hair'],
    [/pelo\s+rojo/gi, 'red hair'],
    [/cabello\s+casta[nñ]o/gi, 'brown hair'],
    [/cabello\s+rubio/gi, 'blonde hair'],
    [/cabello\s+negro/gi, 'black hair'],
    [/cabello\s+largo/gi, 'long hair'],
    [/cabello\s+corto/gi, 'short hair'],
    [/cabello\s+ondulado/gi, 'wavy hair'],
    [/cabello\s+rizado/gi, 'curly hair'],
    [/ojos?\s+verdes?/gi, 'green eyes'],
    [/ojos?\s+azules?/gi, 'blue eyes'],
    [/ojos?\s+marrones?/gi, 'brown eyes'],
    [/ojos?\s+grises?/gi, 'grey eyes'],
    [/ojos?\s+rojos?/gi, 'red eyes'],
    [/vestido\s+verde/gi, 'green dress'],
    [/vestido\s+rojo/gi, 'red dress'],
    [/vestido\s+azul/gi, 'blue dress'],
    [/vestido\s+blanco/gi, 'white dress'],
    [/falda/gi, 'skirt'],
    [/blusa/gi, 'blouse'],
    [/camiseta/gi, 't-shirt'],
    [/f[ií]bula\s+dorada/gi, 'golden Celtic brooch'],
    [/broche\s+dorado/gi, 'golden brooch'],
    [/piel\s+clara/gi, 'fair skin'],
    [/piel\s+clara\s+con\s+pecas/gi, 'fair skin, light freckles'],
    [/pecas/gi, 'freckles'],
    [/sonrisa\s+suave/gi, 'gentle smile'],
    [/sonrisa/gi, 'gentle smile'],
    [/joven\s+atractiva/gi, 'attractive young woman'],
    [/mujer\s+joven/gi, 'young woman'],
    [/adulta?/gi, 'adult'],
    [/humana?/gi, 'human'],
    [/sin\s+orejas\s+de\s+elfo/gi, 'human ears, no elf ears'],
    [/orejas?\s+humanas?/gi, 'human ears'],
    [/maquillaje\s+natural/gi, 'natural makeup'],
    [/labios\s+rosados/gi, 'pink lips']
  ]
  for (const [re, en] of pairs) s = s.replace(re, en)
  // Drop leftover Spanish filler words that confuse SD
  s = s
    .replace(/\b(es|una|un|con|de|del|la|el|los|las|muy|bastante|algo)\b/gi, ' ')
    .replace(/[.;]/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/,+/g, ',')
    .trim()
  return s
}

export function detectImageStyle(text: string): ImageStyleId {
  const low = (text || '').toLowerCase()
  if (/\b(anime|manga|waifu|2d)\b/.test(low)) return 'anime'
  if (/\b(cinem[aá]tic|pel[ií]cula|dramatic)\b/.test(low)) return 'cinematic'
  if (/\b(estudio|studio|profesional|headshot)\b/.test(low)) return 'portrait_studio'
  if (/\b(suave|soft|tierno|intimate)\b/.test(low)) return 'soft_portrait'
  if (/\b(foto|photoreal|realista|selfie|casual)\b/.test(low)) return 'casual_photo'
  return 'casual_photo'
}

export function parseImageIntent(text: string): ParsedImageIntent {
  const raw = (text || '').trim()
  const low = raw.toLowerCase()
  // Explicit "not you" always wins over self-keywords
  const explicitOther =
    /\b(no seas t[uú]|no te generes|no te pongas|no eres t[uú]|otra persona|de otra|alguien m[aá]s|un desconocid|no el personaje|no niamh|not you|different person|someone else)\b/i.test(
      low
    )
  let isSelf =
    !explicitOther &&
    /\b(tuya|tuyo|de ti|como te ves|autorretrato|selfie|tu foto|foto tuya|imagen tuya|de\s+ti\s+misma|como t[uú]|eres t[uú]|tu misma|t[uú] misma)\b/i.test(
      low
    )
  let framing: ImageFraming = 'portrait'
  if (/\b(cuerpo completo|de cuerpo|full body|entero|de pie|plano entero|head to toe|head-to-toe)\b/i.test(low))
    framing = 'full'
  else if (/\b(de cintura|medio cuerpo|half|waist)\b/i.test(low)) framing = 'half'
  else if (/\b(paisaje|wide|escena|ambiente)\b/i.test(low)) framing = 'wide'
  else if (isSelf) framing = 'half'
  return { framing, isSelf, style: detectImageStyle(raw), raw, explicitOther }
}

export function recommendSdParams(opts: {
  prompt?: string
  framing?: ImageFraming
  style?: ImageStyleId
}): { width: number; height: number; steps: number; cfgScale: number } {
  const styleId = opts.style && opts.style !== 'auto' ? opts.style : 'casual_photo'
  const preset = STYLE_PRESETS[styleId]
  const f = opts.framing || 'portrait'
  let width = 768
  let height = 1024
  if (f === 'full') {
    width = 768
    height = 1152
  } else if (f === 'half') {
    width = 768
    height = 1024
  } else if (f === 'wide') {
    width = 1152
    height = 768
  } else {
    // portrait — closer to chat clients
    width = 768
    height = 1024
  }
  return {
    width,
    height,
    steps: preset.steps,
    cfgScale: preset.cfgScale
  }
}

/**
 * Build a strong local SD prompt. Identity from visualDescription is weighted highest.
 */

const FULL_BODY_POS =
  'full body, entire figure, head to toe, feet visible, standing pose, complete person in frame, no crop at waist'
const FULL_BODY_NEG =
  'close-up, headshot only, cropped legs, missing feet, upper body only, portrait crop'
const ANTI_MULTI_HEAD =
  'two heads, double head, stacked heads, two faces, conjoined, extra head, cloned face, duplicate person'

export function composeImagePrompt(
  userText: string,
  _engine: 'sd15' | 'sdxl' | 'cloud' = 'sd15',
  opts?: ComposeOpts
): { prompt: string; negativePrompt: string; parsed: ParsedImageIntent; styleId: Exclude<ImageStyleId, 'auto'> } {
  const parsed = parseImageIntent(userText)
  const styleId =
    opts?.style && opts.style !== 'auto'
      ? opts.style
      : parsed.style === 'auto'
        ? 'casual_photo'
        : parsed.style
  const preset = STYLE_PRESETS[styleId]
  const useChar =
    typeof opts?.useCharacter === 'boolean'
      ? opts.useCharacter
      : Boolean(parsed.isSelf && !parsed.explicitOther)

  const name = (opts?.characterName || '').trim()
  const lookRaw = (opts?.visualDescription || '').trim()
  const lookTags = useChar && lookRaw ? visualDescriptionToTags(lookRaw) : ''

  const framingTag =
    parsed.framing === 'full'
      ? FULL_BODY_POS
      : parsed.framing === 'half'
        ? 'upper body, waist-up portrait, shoulders visible'
        : parsed.framing === 'wide'
          ? 'environmental wide shot, character in scene'
          : 'close portrait, face focus, looking at viewer'

  const identityBits: string[] = []
  if (useChar && (lookTags || name)) {
    identityBits.push('solo, single person, (one face:1.45), (one head:1.45), (single head:1.4), human, adult woman')
    // Hard anti-elf / fantasy ears when description says human
    if (/human|humana|adulto/i.test(lookRaw + lookTags) || true) {
      identityBits.push('(human ears:1.2), natural human anatomy')
    }
    if (name) identityBits.push(`character ${name}`)
    if (lookTags) {
      if (/red hair|long red/i.test(lookTags)) identityBits.push('(long red hair:1.4)')
      if (/green eyes/i.test(lookTags)) identityBits.push('(green eyes:1.25)')
      if (/blue eyes/i.test(lookTags)) identityBits.push('(blue eyes:1.25)')
      if (/green dress/i.test(lookTags)) identityBits.push('(green dress:1.25)')
      if (/red dress/i.test(lookTags)) identityBits.push('(red dress:1.25)')
      if (/brooch|f[ií]bula|celtic/i.test(lookTags + lookRaw))
        identityBits.push('(golden Celtic brooch:1.2)')
      identityBits.push(`(${lookTags}:1.3)`)
    }
  } else {
    identityBits.push('solo, single person, (one face:1.25), (one head:1.25)')
  }

  let userExtra = userText
    .replace(
      /\b(haz|genera|generame|gen[eé]rame|dibuja|crea|quiero|una|foto|imagen|tuya|tuyo|de ti|por favor|please|draw|generate|make)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
  if (userExtra.length < 4) userExtra = ''
  // Translate Spanish subject traits for SD (ojos azules → blue eyes, etc.)
  if (!useChar && userExtra) {
    const tagged = visualDescriptionToTags(userExtra)
    if (tagged && tagged.length >= 4) userExtra = tagged
    // Explicit subject gender/age cues
    if (/\b(chica|mujer|girl|woman)\b/i.test(userText)) identityBits.push('young woman')
    if (/\b(chico|hombre|boy|man)\b/i.test(userText)) identityBits.push('young man')
    if (/\bcabello\s+liso|pelo\s+liso|straight hair\b/i.test(userText + ' ' + userExtra)) {
      identityBits.push('(straight hair:1.25)')
    }
    if (/\bojos?\s+azules?|blue eyes\b/i.test(userText + ' ' + userExtra)) {
      identityBits.push('(blue eyes:1.3)')
    }
  }
  // Don't let free-form user text overwrite identity colors if character is locked
  if (useChar && lookTags) {
    userExtra = userExtra
      .replace(/\b(blonde|brunette|black hair|brown hair|blue eyes|straight hair)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const prompt = [
    QUALITY_CORE,
    preset.positive,
    ...identityBits,
    framingTag,
    userExtra,
    'coherent face, consistent identity, sharp eyes'
  ]
    .filter(Boolean)
    .join(', ')

  let negative = [NEG_ANATOMY, ANTI_MULTI_HEAD, preset.negative].filter(Boolean).join(', ')
  if (parsed.framing === 'full') negative += ', ' + FULL_BODY_NEG
  if (/red hair/i.test(lookTags)) {
    negative += ', brown hair, black hair, blonde hair, brunette, pink hair'
  }
  if (/green eyes/i.test(lookTags)) negative += ', blue eyes, brown eyes'
  if (name) negative += ', different character, occluded face'
  // Always discourage fantasy ears for this app's human avatars
  negative += ', elf ears, pointed ears, fairy, non-human, animal ears'

  return { prompt, negativePrompt: negative, parsed, styleId }
}

export function listStylePresets(): Array<{ id: string; label: string }> {
  return Object.values(STYLE_PRESETS).map((p) => ({ id: p.id, label: p.label }))
}
