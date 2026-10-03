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
import {
  describeNonHumanSubject,
  translateImagePromptText
} from '../image/subject-prompt'

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
  'two heads, two faces, multiple faces, double head, extra limbs, extra fingers, fused fingers, deformed hands, mutated hands, bad anatomy, bad proportions, disfigured, blurry, low quality, jpeg artifacts, watermark, text, logo, signature, multiple people, crowd, clone, identity mismatch, different person, wrong hair color, asymmetrical eyes'

/** Expand Spanish (and common) look phrases → English SD tags. */
export function visualDescriptionToTags(desc: string): string {
  let s = (desc || '').trim()
  if (!s) return ''
  const pairs: [RegExp, string][] = [
    [/cabello\s+largo\s+y\s+rojo/gi, 'long red hair'],
    [/cabello\s+rojo\s+largo/gi, 'long red hair'],
    [/pelo\s+largo\s+rojo/gi, 'long red hair'],
    [/cabello\s+rojo\s+ondulado/gi, 'long wavy red hair'],
    [/cabello\s+rojo/gi, 'red hair'],
    [/pelo\s+rojo/gi, 'red hair'],
    [/pelo\s+colorado|cabello\s+colorado/gi, 'red hair'],
    [/cabello\s+casta[nñ]o/gi, 'brown hair'],
    [/cabello\s+rubio/gi, 'blonde hair'],
    [/cabello\s+negro/gi, 'black hair'],
    [/cabello\s+largo/gi, 'long hair'],
    [/cabello\s+corto/gi, 'short hair'],
    [/cabello\s+ondulado/gi, 'wavy hair'],
    [/cabello\s+rizado/gi, 'curly hair'],
    [/cabello\s+liso/gi, 'straight hair'],
    [/ojos?\s+verdes?/gi, 'green eyes'],
    [/ojos?\s+azules?/gi, 'blue eyes'],
    [/ojos?\s+violetas?/gi, 'violet eyes'],
    [/ojos?\s+marrones?/gi, 'brown eyes'],
    [/ojos?\s+grises?/gi, 'grey eyes'],
    [/ojos?\s+avellana/gi, 'hazel eyes'],
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
    [/collar\s+dorado/gi, 'gold necklace'],
    [/piel\s+clara\s+con\s+pecas/gi, 'fair skin, light freckles'],
    [/piel\s+clara/gi, 'fair skin'],
    [/piel\s+morena/gi, 'tan skin'],
    [/pecas/gi, 'freckles'],
    [/sonrisa\s+suave/gi, 'gentle smile'],
    [/sonrisa/gi, 'gentle smile'],
    [/joven\s+atractiva/gi, 'attractive young woman'],
    [/mujer\s+joven/gi, 'young woman'],
    [/rostro\s+ovalado/gi, 'oval face'],
    [/cara\s+ovalada/gi, 'oval face'],
    [/p[oó]mulos\s+altos/gi, 'high cheekbones'],
    [/labios\s+llenos/gi, 'full lips'],
    [/labios\s+rosados/gi, 'pink lips'],
    [/cejas\s+definidas/gi, 'defined eyebrows'],
    [/adulta?/gi, 'adult'],
    [/humana?/gi, 'human'],
    [/sin\s+orejas\s+de\s+elfo/gi, 'human ears, no elf ears'],
    [/orejas?\s+humanas?/gi, 'human ears'],
    [/maquillaje\s+natural/gi, 'natural makeup']
  ]
  for (const [re, en] of pairs) s = s.replace(re, en)
  s = s
    .replace(/\b(es|una|un|con|de|del|la|el|los|las|muy|bastante|algo|tiene|lleva|su|sus)\b/gi, ' ')
    .replace(/[.;]/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/,+/g, ',')
    .trim()
  return s
}

/**
 * Extract ordered identity anchors from a description (hair → eyes → skin → face → outfit → accessory).
 * Used to build weighted SD tags that survive style injection.
 */
export function extractIdentityAnchors(desc: string): {
  hair: string[]
  eyes: string[]
  skin: string[]
  face: string[]
  outfit: string[]
  accessory: string[]
  other: string[]
} {
  const tags = visualDescriptionToTags(desc).toLowerCase()
  const hair: string[] = []
  const eyes: string[] = []
  const skin: string[] = []
  const face: string[] = []
  const outfit: string[] = []
  const accessory: string[] = []
  const other: string[] = []

  if (/long\s+wavy\s+red\s+hair|long\s+red\s+hair|wavy\s+red\s+hair/.test(tags))
    hair.push('long wavy red hair')
  else if (/red\s+hair|auburn|copper/.test(tags)) hair.push('(long auburn copper hair:1.45)')
  if (/straight\s+hair/.test(tags) && !hair.length) hair.push('straight hair')
  if (/wavy\s+hair/.test(tags) && !/red/.test(hair.join(' '))) hair.push('wavy hair')
  if (/curly\s+hair/.test(tags)) hair.push('curly hair')
  if (/long\s+hair/.test(tags) && !hair.some((h) => /long/.test(h))) hair.push('long hair')
  if (/blonde/.test(tags)) hair.push('blonde hair')
  if (/brown\s+hair/.test(tags)) hair.push('brown hair')
  if (/black\s+hair/.test(tags)) hair.push('black hair')

  if (/green\s+eyes/.test(tags)) eyes.push('green eyes')
  if (/blue\s+eyes/.test(tags)) eyes.push('blue eyes')
  if (/violet\s+eyes/.test(tags)) eyes.push('violet eyes')
  if (/brown\s+eyes/.test(tags)) eyes.push('brown eyes')
  if (/hazel\s+eyes/.test(tags)) eyes.push('hazel eyes')
  if (/grey\s+eyes|gray\s+eyes/.test(tags)) eyes.push('grey eyes')

  if (/fair\s+skin/.test(tags)) skin.push('fair skin')
  if (/freckles/.test(tags)) skin.push('light freckles')
  if (/tan\s+skin/.test(tags)) skin.push('tan skin')

  if (/oval\s+face/.test(tags)) face.push('oval face')
  if (/high\s+cheekbones/.test(tags)) face.push('high cheekbones')
  if (/full\s+lips/.test(tags)) face.push('full lips')
  if (/pink\s+lips/.test(tags)) face.push('pink lips')
  if (/gentle\s+smile/.test(tags)) face.push('gentle smile')

  if (/green\s+dress/.test(tags)) outfit.push('green dress')
  if (/red\s+dress/.test(tags)) outfit.push('red dress')
  if (/blue\s+dress/.test(tags)) outfit.push('blue dress')
  if (/white\s+dress/.test(tags)) outfit.push('white dress')

  if (/celtic\s+brooch|golden\s+brooch/.test(tags)) accessory.push('golden Celtic brooch')
  if (/gold\s+necklace/.test(tags)) accessory.push('gold necklace')

  return { hair, eyes, skin, face, outfit, accessory, other }
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
  const nonHumanSubject = describeNonHumanSubject(raw)
  const samePersonCue =
    /\b(?:la\s+misma\s+persona|mismo\s+personaje|misma\s+cara|mismo\s+rostro|same\s+person|same\s+character|same\s+face|same\s+look|same\s+girl|same\s+guy)\b/i.test(
      low
    )
  // Explicit "not you" always wins over self-keywords
  const explicitOther =
    /\b(no seas t[uú]|no te generes|no te pongas|no eres t[uú]|otra persona|de otra|alguien m[aá]s|un desconocid|no el personaje|no niamh|not you|different person|someone else|not the same person|no es la misma persona)\b/i.test(
      low
    )
  let isSelf =
    !explicitOther &&
    /\b(tuya|tuyo|de ti|como te ves|autorretrato|selfie|tu foto|foto tuya|imagen tuya|de\s+ti\s+misma|como t[uú]|eres t[uú]|tu misma|t[uú] misma|la\s+misma\s+persona|mismo\s+personaje|misma\s+cara|mismo\s+rostro|same\s+person|same\s+character|same\s+face|same\s+look)\b/i.test(
      low
    )
  if (!isSelf && samePersonCue && !explicitOther) {
    isSelf = true
  }
  const explicitCloseFraming =
    /\b(primer plano|close[- ]?up|headshot|solo (?:la )?cara|face only|retrato de cerca)\b/i.test(low)
  const requestsWardrobe =
    /\b(vestido|dress|catsuit|uniforme|traje|ropa|vestuario|outfit|camiseta|camisa|blusa|chaqueta|abrigo|falda|pantal[oó]n|jeans|bikini|armadura|disfraz|cosplay|suit|jacket|coat|skirt|pants|clothing|costume|uniform)\b/i.test(
      low
    )
  const requestsScene =
    /\b(playa|beach|bosque|forest|ciudad|city|calle|street|caf[eé]|oficina|office|parque|park|casa|home|monta[nñ]a|mountain|restaurante|restaurant)\b/i.test(
      low
    )
  let framing: ImageFraming = 'portrait'
  if (/\b(cuerpo completo|cuerpo entero|de cuerpo|full body|full-body|entero|de pie|plano entero|head to toe|head-to-toe|de la cabeza a los pies)\b/i.test(low))
    framing = 'full'
  else if (/\b(de cintura|medio cuerpo|half|waist)\b/i.test(low)) framing = 'half'
  else if (/\b(paisaje|wide|escena|ambiente)\b/i.test(low)) framing = 'wide'
  else if (requestsWardrobe && !explicitCloseFraming) framing = 'full'
  else if (requestsScene && !explicitCloseFraming) framing = 'wide'
  else if (nonHumanSubject && !explicitCloseFraming) framing = 'wide'
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
  '(full body:1.5), (full body shot:1.4), (head to toe:1.45), entire figure visible, feet visible, shoes visible, standing on floor, long shot, wide framing, complete person in frame, not a close-up'
const FULL_BODY_NEG =
  'close-up, closeup, headshot, face only, portrait crop, upper body only, cropped legs, missing feet, missing legs, out of frame, cut off at waist, selfie angle, tight crop'
const ANTI_MULTI_HEAD =
  'two heads, double head, stacked heads, two faces, conjoined, extra head, cloned face, duplicate person'


/** Pull garment/outfit cues so SD does not default to bare portrait */
export function extractOutfitTags(userText: string): string[] {
  const t = userText || ''
  const tags: string[] = []
  const low = t.toLowerCase()
  if (/\bcatsuit\b|\bcuerpo entero de l[aá]tex\b|\btraje ajustado\b/i.test(t)) {
    tags.push('(catsuit:1.45)', 'tight full-body catsuit', 'covered body', 'sleeves', 'legs covered')
  }
  if (/\bvestido\b|\bdress\b/i.test(t)) {
    const color = t.match(
      /\b(?:vestido|dress)\s+(rojo|roja|azul|verde|negro|negra|blanco|blanca|rosa|rojo)\b/i
    ) || t.match(/\b(azul|rojo|verde|negro|blanco|rosa)\s+(?:vestido|dress)\b/i)
    if (color) {
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
      const eng = map[(color[1] || '').toLowerCase()] || color[1]
      tags.push(`(${eng} dress:1.45)`, `wearing ${eng} dress`)
    } else {
      tags.push('(dress:1.25)', 'wearing a dress')
    }
  }
  if (/\bcamiseta\b|\bt-?shirt\b/i.test(t)) tags.push('t-shirt')
  if (/\bchaqueta\b|\bjacket\b/i.test(t)) tags.push('jacket')
  if (/\bfalda\b|\bskirt\b/i.test(t)) tags.push('skirt')
  if (/\bpantal[oó]n(?:es)?\b|\bpants\b|\bjeans\b/i.test(t)) tags.push('pants', 'long pants')
  if (/\btraje\b|\bsuit\b/i.test(t) && !/catsuit/i.test(t)) tags.push('suit')
  if (/\bbikini\b|\btraje de ba[nñ]o\b/i.test(t)) tags.push('bikini')
  // Eyes
  if (/\bojos?\s+azules?\b|\bblue eyes\b/i.test(t)) tags.push('(blue eyes:1.35)')
  if (/\bojos?\s+verdes?\b|\bgreen eyes\b/i.test(t)) tags.push('(green eyes:1.3)')
  return tags
}


/** Negatives that fight the locked look (e.g. block blonde when ficha says red/auburn). */
export function identityConflictNegatives(visualDescription?: string): string {
  const d = (visualDescription || '').toLowerCase()
  if (!d.trim()) return ''
  const neg: string[] = []
  if (/rojo|roja|red hair|auburn|cobrizo|cobriza|colorado|pelirroj|ginger|copper/.test(d)) {
    neg.push(
      'blonde hair',
      'platinum blonde',
      'yellow hair',
      'light brown hair',
      'dirty blonde',
      'golden hair'
    )
  }
  if (/casta[nñ]o|brown hair|brunette/.test(d) && !/rojo|red|auburn|cobriz/.test(d)) {
    neg.push('blonde hair', 'platinum blonde', 'red hair')
  }
  if (/rubio|rubia|blonde/.test(d)) {
    neg.push('red hair', 'black hair', 'dark brown hair')
  }
  if (/azul|blue eyes/.test(d)) {
    neg.push('brown eyes', 'dark eyes')
  }
  if (/verde|green eyes/.test(d)) {
    neg.push('brown eyes')
  }
  if (/ondulado|wavy/.test(d)) {
    neg.push('straight slick hair')
  }
  return neg.join(', ')
}

export function composeImagePrompt(
  userText: string,
  _engine: 'sd15' | 'sdxl' | 'cloud' = 'sd15',
  opts?: ComposeOpts
): { prompt: string; negativePrompt: string; parsed: ParsedImageIntent; styleId: Exclude<ImageStyleId, 'auto'> } {
  const parsed = parseImageIntent(userText)
  const nonHumanSubject = describeNonHumanSubject(userText)
  const styleId =
    opts?.style && opts.style !== 'auto'
      ? opts.style
      : parsed.style === 'auto'
        ? 'casual_photo'
        : parsed.style
  const preset = STYLE_PRESETS[styleId]
  const hairColor = /\b(?:pelo|cabello)\s+(rojo|roja|rubio|rubia|casta[nñ]o|casta[nñ]a|negro|negra|violeta|violeta)\b|\b(?:pelirroja|pelirrojo|redhead)\b/i.test(
    userText
  )
    ? /\b(?:pelo|cabello)\s+(rojo|roja|rubio|rubia|casta[nñ]o|casta[nñ]a|negro|negra|violeta)\b|\b(?:pelirroja|pelirrojo|redhead)\b/i
        .exec(userText)?.[0]?.toLowerCase() || 'red'
    : 'brown'
  const eyeColor = /\b(?:ojos?|eyes)\s+(violeta|violetas|azules?|verdes?|marrones?|caf[eé]s?)\b/i.test(userText)
    ? /\b(?:ojos?|eyes)\s+(violeta|violetas|azules?|verdes?|marrones?|caf[eé]s?)\b/i.exec(userText)?.[1]?.toLowerCase() || 'brown'
    : 'brown'
  const narrativeHair = /rojo|roja|pelirroja|redhead/i.test(hairColor) ? 'red' : /rubio|blonde/i.test(hairColor) ? 'blonde' : /casta[nñ]o|brown/i.test(hairColor) ? 'brown' : /negro|black/i.test(hairColor) ? 'black' : /violeta|purple/i.test(hairColor) ? 'violet' : 'brown'
  const narrativeEyes = /violeta|purple/i.test(eyeColor) ? 'violet' : /azul|blue/i.test(eyeColor) ? 'blue' : /verde|green/i.test(eyeColor) ? 'green' : /marron|brown|caf[eé]/i.test(eyeColor) ? 'brown' : eyeColor
  if (_engine === 'generic' || _engine === 'cloud') {
    if (nonHumanSubject) {
      return {
        prompt: [
          'Professional photorealistic image',
          nonHumanSubject.prompt,
          translateImagePromptText(userText),
          /playa|beach/i.test(userText)
            ? 'on a beach by the ocean'
            : /bosque|forest/i.test(userText)
              ? 'in a forest'
              : /noche|night/i.test(userText)
                ? 'at night'
                : 'cinematic natural environment',
          'accurate creature anatomy, highly detailed scales and texture, no human subject'
        ]
          .filter(Boolean)
          .join(', '),
        negativePrompt:
          'human, person, woman, man, portrait, human face, extra limbs, deformed creature anatomy, blurry, low quality',
        parsed,
        styleId
      }
    }
    const subject = /(?:mujer|woman|girl|chica|persona|person)/i.test(userText) ? 'woman' : 'person'
    const location = /playa|beach/i.test(userText) ? 'on a beach at sunset' : /atardecer|sunset/i.test(userText) ? 'at sunset' : /noche|night/i.test(userText) ? 'at night' : 'in a natural setting'
    const narrative = [
      'Professional photograph',
      'single person',
      parsed.isSelf || /misma persona|same person|same character/.test(userText) ? 'same person, same face, same hair color, same eye color' : `a ${subject}`,
      `Hair is ${narrativeHair}`,
      `Eyes are ${narrativeEyes}`,
      location,
      'clear face, natural skin texture, realistic lighting'
    ]
      .filter(Boolean)
      .join(', ')
    return {
      prompt: narrative,
      negativePrompt:
        'second person, multiple faces, wrong person, different person, duplicate face, blurry, low quality, extra head, deformed face',
      parsed,
      styleId
    }
  }

  const useChar =
    typeof opts?.useCharacter === 'boolean'
      ? opts.useCharacter
      : Boolean(parsed.isSelf && !parsed.explicitOther)

  const name = (opts?.characterName || '').trim()
  const lookRaw = (opts?.visualDescription || '').trim()
  const anchors = useChar && lookRaw ? extractIdentityAnchors(lookRaw) : null
  const lookTags = useChar && lookRaw ? visualDescriptionToTags(lookRaw) : ''

  const framingTag =
    nonHumanSubject
      ? 'wide cinematic composition, entire creature visible, subject and environment in frame'
      : parsed.framing === 'full'
      ? FULL_BODY_POS
      : parsed.framing === 'half'
        ? 'upper body, waist-up portrait, shoulders visible, chest up'
        : parsed.framing === 'wide'
          ? 'environmental wide shot, character in scene'
          : 'close portrait, face focus, looking at viewer'

  // ——— Identity DNA (must come early; weights keep face/hair stable) ———
  const identityBits: string[] = []
  if (nonHumanSubject) {
    identityBits.push(nonHumanSubject.prompt)
  } else if (useChar && (anchors || lookTags || name)) {
    identityBits.push(
      'solo, single person, (one face:1.55), (one head:1.55), (single head:1.5)',
      'human female, adult woman, natural human anatomy, (human ears:1.3), no elf ears'
    )
    if (name) {
      identityBits.push(`portrait of ${name}`, `(same person as ${name}:1.4)`, 'consistent character identity')
    }
    // Weighted anchors — hair & eyes are the strongest identity signals for SD1.5
    const w = (tag: string, weight: number) => `(${tag}:${weight})`
    for (const h of anchors?.hair || []) identityBits.push(w(h, 1.45))
    for (const e of anchors?.eyes || []) identityBits.push(w(e, 1.4))
    for (const s of anchors?.skin || []) identityBits.push(w(s, 1.25))
    for (const f of anchors?.face || []) identityBits.push(w(f, 1.2))
    for (const o of anchors?.outfit || []) identityBits.push(w(o, 1.25))
    for (const a of anchors?.accessory || []) identityBits.push(w(a, 1.25))
    // Residual free-form tags not already covered
    if (lookTags) {
      const covered = new Set(
        [...(anchors?.hair || []), ...(anchors?.eyes || []), ...(anchors?.skin || []), ...(anchors?.face || []), ...(anchors?.outfit || []), ...(anchors?.accessory || [])].map(
          (x) => x.toLowerCase()
        )
      )
      const residual = lookTags
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x.length > 2 && ![...covered].some((c) => x.toLowerCase().includes(c) || c.includes(x.toLowerCase())))
        .slice(0, 8)
      if (residual.length) identityBits.push(`(${residual.join(', ')}:1.2)`)
    }
    identityBits.push('photorealistic skin texture, detailed iris, coherent facial structure')
  } else if (/\b(?:mujer|woman|girl|chica|hombre|man|boy|chico|persona|person|rubia|rubio|blond|blonde|pelirroja|pelirrojo|redhead)\b/i.test(userText)) {
    identityBits.push('solo, single person, (one face:1.3), (one head:1.3)')
    if (/\b(mujer|woman|girl|chica|rubia|rubio|blonde|blond|pelirroja|pelirrojo|redhead)\b/i.test(userText)) {
      identityBits.push('adult woman')
    } else if (/\b(hombre|man|boy|chico)\b/i.test(userText)) {
      identityBits.push('adult man')
    }
    if (/\b(rubia|rubio|blonde|blond)\b/i.test(userText)) identityBits.push('(blonde hair:1.35)')
    if (/\b(pelirroja|pelirrojo|redhead)\b/i.test(userText)) identityBits.push('(red hair:1.35)')
    if (/\b(casta[nñ]a?|brunette)\b/i.test(userText)) identityBits.push('(brown hair:1.3)')
    if (/\b(cabello|pelo)\s+negro\b/i.test(userText)) identityBits.push('(black hair:1.3)')
  } else if (!nonHumanSubject) {
    identityBits.push('coherent subject, accurate anatomy')
  }

  // User variation (pose/background) — strip self-request filler; keep traits if NOT character-locked
  let userExtra = userText
    .replace(
      /\b(haz|genera|generame|gen[eé]rame|dibuja|crea|quiero|una|foto|imagen|tuya|tuyo|de ti|por favor|please|draw|generate|make|podr[ií]as|puedes)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
  if (userExtra.length < 4) userExtra = ''

  if (!useChar && userExtra) {
    const tagged = visualDescriptionToTags(translateImagePromptText(userExtra))
    userExtra = translateImagePromptText(userExtra)
    if (tagged && tagged.length >= 4) userExtra = tagged
    if (/\b(chica|mujer|girl|woman)\b/i.test(userText)) identityBits.push('young woman')
    if (/\b(chico|hombre|boy|man)\b/i.test(userText)) identityBits.push('young man')
    if (/\bcabello\s+liso|pelo\s+liso|straight hair\b/i.test(userText)) {
      identityBits.push('(straight hair:1.25)')
    }
    if (/\bojos?\s+violetas?|violet eyes\b/i.test(userText)) {
      identityBits.push('(violet eyes:1.4)')
    }
    if (/\bojos?\s+azules?|blue eyes\b/i.test(userText)) {
      identityBits.push('(blue eyes:1.3)')
    }
  }

  // When identity is locked, strip conflicting color/hair words from free text
  if (useChar && (lookTags || anchors)) {
    userExtra = userExtra
      .replace(/\b(blonde|brunette|black hair|brown hair|blue eyes|green eyes|straight hair|red hair)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const outfitTags = extractOutfitTags(userText)
  // Order: framing first when full body (SD bias is face-closeup otherwise)
  const lead =
    parsed.framing === 'full'
      ? [framingTag, QUALITY_CORE]
      : [QUALITY_CORE, framingTag]
  // Order: quality/framing → identity → outfit → style → user
  const prompt = [
    ...lead,
    ...identityBits,
    ...outfitTags,
    // Tone down portrait-lens bias on full body and self
    (parsed.framing === 'full'
      ? preset.positive
          .replace(/85mm lens,?/gi, '')
          .replace(/close-?up,?/gi, '')
          .replace(/portrait,?/gi, 'full length,')
          .trim()
      : useChar
        ? preset.positive.replace(/85mm lens,?/i, '').trim()
        : nonHumanSubject
          ? preset.positive.replace(/realistic skin pores/gi, 'highly detailed natural surface texture')
          : preset.positive),
    userExtra,
    useChar
      ? 'must match character identity, same face, same hair color, same eye color'
      : nonHumanSubject
        ? 'accurate creature anatomy, detailed natural texture'
        : 'coherent face, sharp eyes'
  ]
    .filter(Boolean)
    .join(', ')

  // ——— Negatives: anatomy + identity protection ———
  let negative = [NEG_ANATOMY, ANTI_MULTI_HEAD, preset.negative].filter(Boolean).join(', ')
  if (parsed.framing === 'full' && !nonHumanSubject) negative += ', ' + FULL_BODY_NEG

  if (useChar) {
    negative +=
      ', different person, wrong person, face mismatch, identity shift, aging, child, elderly'
    const hairJoined = (anchors?.hair || []).join(' ')
    const eyesJoined = (anchors?.eyes || []).join(' ')
    if (/red|auburn|copper|cobriz/i.test(hairJoined + lookTags + ' ' + lookRaw)) {
      negative += ', brown hair, black hair, blonde hair, platinum blonde, dirty blonde, golden hair, yellow hair, brunette, pink hair, blue hair, silver hair, light brown hair'
    }
    const conflict = identityConflictNegatives(lookRaw)
    if (conflict) negative += ', ' + conflict
    if (/blonde/i.test(hairJoined)) negative += ', black hair, brown hair, red hair'
    if (/black hair/i.test(hairJoined)) negative += ', blonde hair, red hair, brown hair'
    if (/green eyes/i.test(eyesJoined + lookTags)) negative += ', blue eyes, brown eyes, red eyes'
    if (/blue eyes/i.test(eyesJoined + lookTags)) negative += ', green eyes, brown eyes, red eyes'
    if (/brown eyes/i.test(eyesJoined)) negative += ', blue eyes, green eyes'
    if (name) negative += ', different character, occluded face, heavy face obstruction'
  }
  negative += nonHumanSubject
    ? ', human face, human body, person, people, humanoid, extra limbs, deformed creature anatomy'
    : ', elf ears, pointed ears, fairy, non-human, animal ears, multiple people, clone'

  return { prompt, negativePrompt: negative, parsed, styleId }
}

export function listStylePresets(): Array<{ id: string; label: string }> {
  return Object.values(STYLE_PRESETS).map((p) => ({ id: p.id, label: p.label }))
}
