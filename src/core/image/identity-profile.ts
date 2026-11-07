/**
 * I0 — IdentityProfile: permanent character identity (face/body).
 * Must NOT include turn-specific outfit, pose, or scene.
 */
import type { CharacterProfile } from '@core/character/profile'
import { effectiveVisualDescription } from '@core/character/profile'

export type IdentityLockedField =
  | 'face'
  | 'hair'
  | 'eyes'
  | 'skin'
  | 'body'
  | 'name'

export type IdentityProfile = {
  id: string
  canonicalName: string
  primaryPhoto?: string
  secondaryRefs: string[]
  appearanceSummary: string
  faceNotes?: string
  hairNotes?: string
  eyesNotes?: string
  bodyNotes?: string
  lockedFields: IdentityLockedField[]
  styleSummary?: string
  updatedAt?: number
}

function wb(body: string): RegExp {
  return new RegExp('\\b(?:' + body + ')\\b[^,.|;]*', 'gi')
}

const OUTFIT_NOISE_PATTERNS: RegExp[] = [
  wb('wearing|dressed in|dressed as'),
  wb('dress|skirt|blouse|jacket|hoodie|sweater|coat|suit|uniform|bikini|outfit|shirt|t-shirt|jeans|pants'),
  wb('vestid[oa]|vestuario|ropa|camisa|camiseta|blusa|falda|pantal[oó]n(?:es)?|abrigo|chaqueta|sudadera|su[eé]ter|uniforme|bikini|traje(?:\s+de\s+ba[nñ]o)?|disfraz|armadura'),
  new RegExp('\\b(?:viste|vistiendo|luce|luciendo|lleva|llevando|usa|usando|pone|poniendo)\\s+(?:un[ao]?|el|la|unos|unas)?\\s*[^,.|;]*', 'gi'),
  new RegExp('\\ben\\s+una\\s+variante\\b[^,.|;]*', 'gi'),
  new RegExp('\\ben\\s+otra(?:\\s+variante)?\\b[^,.|;]*', 'gi'),
  new RegExp('\\ben\\s+ambas\\s+versiones\\b[^,.|;]*', 'gi'),
  wb('joyas?|collar|aretes?|pendientes?|earrings?|necklace|jewelry')
]

const EMPTY_SLOT = new RegExp('\\b(?:un|una|el|la|unos|unas)\\s*[.,;:\\u2026]*\\s*$', 'i')

/** Strip turn-level clothing / broken variant phrases from appearance used as identity. */
export function stripOutfitFromAppearance(text: string): string {
  let s = String(text || '')
  for (const re of OUTFIT_NOISE_PATTERNS) {
    s = s.replace(re, ' ')
  }
  s = s
    .replace(new RegExp('\\b(?:viste|luce|lleva|usa)\\s+un[ao]?\\s*[.,;]*', 'gi'), ' ')
    .replace(new RegExp('\\b(?:suele\\s+usar|usa\\s+joyas?|con\\s+joyas?)\\b[^,.|;]*', 'gi'), ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s*[.,;]\s*[.,;]+/g, '. ')
    .replace(/^[,.;\s]+|[,.;\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  // Drop dangling clause starts after aggressive strip
  s = s.replace(new RegExp('(?:^|[.!?\\s]),\\s*', 'g'), '. ').replace(new RegExp('^[.,\\s]+'), '').trim()

  const parts = s
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter((p) => {
      if (p.length < 8) return false
      if (/^(,|y|and)\s/i.test(p)) return false
      if (EMPTY_SLOT.test(p)) return false
      if (/^(en\s+una\s+variante|en\s+otra)/i.test(p)) return false
      if (!/[a-záéíóúñ]/i.test(p)) return false
      return true
    })
  return parts.join(' ').replace(/\s{2,}/g, ' ').replace(/\b(y|and)\s*$/i, '').replace(/,\s*$/g, '').trim()
}

export function extractIdentityCues(appearance: string): {
  hairNotes?: string
  eyesNotes?: string
  faceNotes?: string
} {
  const t = String(appearance || '')
  const hair =
    t.match(new RegExp('\\b((?:long|short|curly|wavy|straight|pelo|cabello)[^,.]{0,40}(?:red|rojo|rubio|blonde|brown|casta[nñ]o|negro|black|pelirroj[oa])[^,.]{0,20})', 'i')) ||
    t.match(new RegExp('\\b((?:red|rojo|rubio|blonde|brown|casta[nñ]o|negro|black|pelirroj[oa])\\s+(?:hair|pelo|cabello)[^,.]{0,30})', 'i')) ||
    t.match(new RegExp('\\b(cabello[^,.]{0,50}|pelo[^,.]{0,50}|red hair|long curly red hair)', 'i'))
  const eyes =
    t.match(new RegExp('\\b((?:violet|blue|green|brown|hazel|azules?|verdes?|marrones?|violetas?)\\s+eyes?)', 'i')) ||
    t.match(new RegExp('\\b(ojos?\\s+(?:violetas?|azules?|verdes?|marrones?|caf[eé])[^,.]{0,20})', 'i'))
  const face = t.match(new RegExp('\\b(rostro[^,.]{0,50}|face[^,.]{0,50}|forma facial[^,.]{0,40})', 'i'))
  return {
    hairNotes: hair?.[1]?.trim().slice(0, 80),
    eyesNotes: eyes?.[1]?.trim().slice(0, 60),
    faceNotes: face?.[1]?.trim().slice(0, 80)
  }
}

export function buildIdentityProfile(input: {
  character?: CharacterProfile | null
  primaryPhoto?: string | null
  secondaryRefs?: string[]
  id?: string
}): IdentityProfile {
  const c = input.character
  const name = (c?.name || 'character').trim() || 'character'
  const rawAppearance = effectiveVisualDescription(
    c ||
      ({
        name,
        tagline: '',
        personality: '',
        style: '',
        visualEmoji: '',
        traits: []
      } as CharacterProfile)
  )
  const appearanceSummary = stripOutfitFromAppearance(rawAppearance)
  const cues = extractIdentityCues(appearanceSummary)
  const secondary = (input.secondaryRefs || [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 4)
  const primary =
    (input.primaryPhoto && String(input.primaryPhoto).trim()) ||
    (c?.visualImageUrl && String(c.visualImageUrl).trim()) ||
    undefined
  const locked: IdentityLockedField[] = appearanceSummary
    ? ['face', 'hair', 'eyes', 'skin']
    : primary
      ? ['face']
      : []
  return {
    id: input.id || ('identity:' + name.toLowerCase().replace(/\s+/g, '-')),
    canonicalName: name,
    primaryPhoto: primary,
    secondaryRefs: secondary,
    appearanceSummary,
    hairNotes: cues.hairNotes,
    eyesNotes: cues.eyesNotes,
    faceNotes: cues.faceNotes,
    lockedFields: locked,
    styleSummary: c?.style ? String(c.style).slice(0, 120) : undefined,
    updatedAt: Date.now()
  }
}

/** Map free-form appearance to short EN SD tags (FaceID works best with tags, not prose). */
export function appearanceToIdentityTags(text: string): string[] {
  // Prefer explicit hair sections (## Cabello / ## Hair) — but never match the word
  // "hair" inside "brown hair" or the color is lost (section starts at "hair, straight…").
  let t = String(text || '').toLowerCase()
  const hairSection = t.match(
    /(?:##\s*)(?:cabello|pelo|hair)\b[\s\S]{0,800}?(?=##|$)/i
  ) || t.match(
    /(?:^|[\n.;])\s*(?:cabello|pelo)\b[\s\S]{0,500}?(?=[\n]|##|$)/i
  )
  // Color scan: full text with clothing noise removed (reliable for "long brown hair")
  const clothingNoise =
    /\b(?:guantes?|vestidos?|zapatos?|botas?|ropa|outfit|collar|aretes?|pendientes?)\s+negros?\b/gi
  const colorScan = t.replace(clothingNoise, ' ')
  const styleScan = hairSection ? hairSection[0] : t

  const tags: string[] = []
  // One hair color only. Word boundaries: "negros" in clothing must NOT win over "castaño".
  if (/\b(?:pelirroj\w*|redhead)\b|\bred\s+hair\b|\bcabello\s+rojo\b|\bpelo\s+rojo\b/.test(colorScan)) {
    tags.push('long red hair')
  } else if (
    /\b(?:cabello|pelo)\s+negro\b|\bblack\s+hair\b|\bcabello\s+negro\b/.test(colorScan)
  ) {
    tags.push('black hair')
  } else if (/\bcasta[nñ]o?\b|\bbrunette\b|\bbrown\s+hair\b|\bcabello\s+casta/.test(colorScan)) {
    tags.push('brown hair')
  } else if (/\brubi[ao]\b|\bblonde\b|\bblond\b|\bcabello\s+rubio\b/.test(colorScan)) {
    tags.push('blonde hair')
  }

  // Style: "sin rizos" / "no rizado" must NOT count as curly
  const deniesCurly = /\b(?:sin|no|nunca|evitar)\s+(?:los\s+)?(?:rizos?|rizado|curls?|curly)\b/i.test(
    styleScan
  )
  if (
    !deniesCurly &&
    /\b(?:rizado|curly)\b|\brizos\b/.test(styleScan) &&
    !/\bsin\s+rizos\b/.test(styleScan)
  ) {
    tags.push('curly hair')
  } else if (/\bondulado\b|\bwavy\b/.test(styleScan)) {
    tags.push('wavy hair')
  } else if (/\blacio\b|\bstraight\b|\bliso\b/.test(styleScan)) {
    tags.push('straight hair')
  }

  // Eyes / skin — whole text is fine
  if (/ojo[s]?\s+violet|violet eyes/.test(t)) tags.push('violet eyes')
  else if (/ojo[s]?\s+azul|blue eyes/.test(t)) tags.push('blue eyes')
  else if (/ojo[s]?\s+verde|green eyes/.test(t)) tags.push('green eyes')
  else if (/ojo[s]?\s+marr|brown eyes|hazel/.test(t)) tags.push('brown eyes')
  if (/piel clara|fair skin|pale/.test(t)) tags.push('fair skin')
  if (/sonrisa|smile/.test(t)) tags.push('subtle smile')
  return [...new Set(tags)]
}

/** Mutually exclusive identity families for prompt conflict resolution. */
const HAIR_COLOR_FAMILY: Array<{ tag: RegExp; label: string; rivals: RegExp }> = [
  {
    tag: /\b(?:long\s+)?red\s+hair\b|\bredhead\b/i,
    label: 'red hair',
    rivals: /\b(?:blonde|blond|brown|black|brunette)\s+hair\b|\b(?:platinum|silver|white|gray|grey)\s+hair\b/gi
  },
  {
    tag: /\bbrown\s+hair\b|\bbrunette\b/i,
    label: 'brown hair',
    rivals: /\b(?:blonde|blond|red|black)\s+hair\b|\bredhead\b|\b(?:platinum|silver)\s+hair\b/gi
  },
  {
    tag: /\bblonde?\s+hair\b/i,
    label: 'blonde hair',
    rivals: /\b(?:brown|red|black|brunette)\s+hair\b|\bredhead\b/gi
  },
  {
    tag: /\bblack\s+hair\b/i,
    label: 'black hair',
    rivals: /\b(?:blonde|blond|brown|red|brunette)\s+hair\b|\bredhead\b/gi
  }
]

const HAIR_STYLE_FAMILY: Array<{ tag: RegExp; rivals: RegExp }> = [
  { tag: /\bcurly\s+hair\b/i, rivals: /\b(?:straight|wavy)\s+hair\b/gi },
  { tag: /\bstraight\s+hair\b/i, rivals: /\b(?:curly|wavy)\s+hair\b/gi },
  { tag: /\bwavy\s+hair\b/i, rivals: /\b(?:curly|straight)\s+hair\b/gi }
]

const EYE_FAMILY: Array<{ tag: RegExp; rivals: RegExp }> = [
  {
    tag: /\bgreen\s+eyes?\b/i,
    rivals: /\b(?:blue|brown|violet|hazel)\s+eyes?\b/gi
  },
  {
    tag: /\bblue\s+eyes?\b/i,
    rivals: /\b(?:green|brown|violet|hazel)\s+eyes?\b/gi
  },
  {
    tag: /\bbrown\s+eyes?\b/i,
    rivals: /\b(?:green|blue|violet|hazel)\s+eyes?\b/gi
  },
  {
    tag: /\bviolet\s+eyes?\b/i,
    rivals: /\b(?:green|blue|brown|hazel)\s+eyes?\b/gi
  }
]

/**
 * Remove LLM-invented identity traits that conflict with locked DNA tags.
 * Host DNA wins; prevents "blonde curly" + "brown straight" in the same prompt.
 */
export function stripConflictingIdentityFromPrompt(
  llmPositive: string,
  lockedTags: string[]
): { cleaned: string; stripped: string[] } {
  let s = String(llmPositive || '')
  const locked = lockedTags.map((t) => t.toLowerCase()).join(' ')
  const stripped: string[] = []

  const stripRe = (re: RegExp, why: string) => {
    const before = s
    s = s.replace(re, ' ')
    if (s !== before) stripped.push(why)
  }

  for (const fam of HAIR_COLOR_FAMILY) {
    if (fam.tag.test(locked)) {
      stripRe(fam.rivals, 'hair_color_rival:' + fam.label)
      // Weighted rivals only — never strip the locked color itself
      if (/brown/.test(fam.label)) {
        stripRe(
          /\(\s*(?:blonde|blond|red|black|brunette|platinum|silver)\s+hair\s*:[^)]+\)/gi,
          'hair_color_weighted_brown'
        )
      } else if (/blonde/.test(fam.label)) {
        stripRe(
          /\(\s*(?:brown|red|black|brunette|platinum|silver)\s+hair\s*:[^)]+\)/gi,
          'hair_color_weighted_blonde'
        )
      } else if (/red/.test(fam.label)) {
        stripRe(
          /\(\s*(?:blonde|blond|brown|black|brunette|platinum|silver)\s+hair\s*:[^)]+\)/gi,
          'hair_color_weighted_red'
        )
      } else if (/black/.test(fam.label)) {
        stripRe(
          /\(\s*(?:blonde|blond|brown|red|brunette|platinum|silver)\s+hair\s*:[^)]+\)/gi,
          'hair_color_weighted_black'
        )
      }
    }
  }
  for (const fam of HAIR_STYLE_FAMILY) {
    if (fam.tag.test(locked)) {
      stripRe(fam.rivals, 'hair_style_rival')
      // Weighted rival styles only
      if (/straight/.test(fam.tag.source)) {
        stripRe(/\(\s*(?:curly|wavy)\s+hair\s*:[^)]+\)/gi, 'hair_style_weighted')
      } else if (/curly/.test(fam.tag.source)) {
        stripRe(/\(\s*(?:straight|wavy)\s+hair\s*:[^)]+\)/gi, 'hair_style_weighted')
      } else if (/wavy/.test(fam.tag.source)) {
        stripRe(/\(\s*(?:curly|straight)\s+hair\s*:[^)]+\)/gi, 'hair_style_weighted')
      }
    }
  }
  for (const fam of EYE_FAMILY) {
    if (fam.tag.test(locked)) {
      stripRe(fam.rivals, 'eye_color_rival')
      stripRe(/\(\s*(?:green|blue|brown|violet|hazel)\s+eyes?\s*:[^)]+\)/gi, 'eye_color_weighted')
    }
  }

  s = s
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/,\s*$/g, '')
    .replace(/^\s*,\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return { cleaned: s, stripped: [...new Set(stripped)] }
}

/** Negatives for traits that rival the locked DNA (reinforce FaceID). */
export function rivalIdentityNegatives(lockedTags: string[]): string[] {
  const locked = lockedTags.map((t) => t.toLowerCase()).join(' ')
  const neg: string[] = []
  if (/\bbrown\s+hair\b|\bbrunette\b/.test(locked)) {
    neg.push('blonde hair', 'blond hair', 'red hair', 'black hair', 'platinum hair')
  } else if (/\bblonde?\s+hair\b/.test(locked)) {
    neg.push('brown hair', 'brunette', 'red hair', 'black hair')
  } else if (/\bred\s+hair\b|\bredhead\b/.test(locked)) {
    neg.push('blonde hair', 'brown hair', 'black hair')
  } else if (/\bblack\s+hair\b/.test(locked)) {
    neg.push('blonde hair', 'brown hair', 'red hair')
  }
  if (/\bstraight\s+hair\b/.test(locked)) neg.push('curly hair', 'wavy hair', 'afro')
  else if (/\bcurly\s+hair\b/.test(locked)) neg.push('straight hair', 'slicked hair')
  else if (/\bwavy\s+hair\b/.test(locked)) neg.push('straight hair', 'tight curls')
  if (/\bgreen\s+eyes?\b/.test(locked)) neg.push('blue eyes', 'brown eyes', 'violet eyes')
  else if (/\bblue\s+eyes?\b/.test(locked)) neg.push('green eyes', 'brown eyes', 'violet eyes')
  else if (/\bbrown\s+eyes?\b/.test(locked)) neg.push('green eyes', 'blue eyes', 'violet eyes')
  else if (/\bviolet\s+eyes?\b/.test(locked)) neg.push('green eyes', 'blue eyes', 'brown eyes')
  return neg
}

/** Keep at most one hair color, one hair style, one eye color (appearanceSummary wins). */
export function reconcileIdentityTags(tags: string[], preferredSource?: string): string[] {
  const preferred = appearanceToIdentityTags(preferredSource || '')
  const all = [...tags]
  const colorTag =
    preferred.find((t) => /^(?:long\s+)?(?:blonde|brown|black|red)\s+hair$/i.test(t)) ||
    all.find((t) => /^(?:long\s+)?(?:blonde|brown|black|red)\s+hair$/i.test(t))
  const styleTag =
    preferred.find((t) => /^(?:curly|straight|wavy)\s+hair$/i.test(t)) ||
    all.find((t) => /^(?:curly|straight|wavy)\s+hair$/i.test(t))
  const eyeTag =
    preferred.find((t) => /eyes$/i.test(t)) || all.find((t) => /eyes$/i.test(t))
  const rest = all.filter((t) => !/hair$/i.test(t) && !/eyes$/i.test(t))
  return [...new Set([colorTag, styleTag, eyeTag, ...rest].filter(Boolean) as string[])]
}

export function identityProfileToPromptBits(
  profile: IdentityProfile,
  opts?: {
    weight?: number
    /**
     * When FaceID refs are present, omit hair color/style from text DNA.
     * Wrong VLM captions (black/curly vs brown/straight in the photo) fight the adapter.
     */
    faceIdActive?: boolean
  }
): string[] {
  const w = opts?.weight ?? 1.35
  const bits: string[] = []
  const name = profile.canonicalName
  if (name) {
    bits.push('portrait of ' + name)
    bits.push('(same person as ' + name + ':' + w.toFixed(2) + ')')
    bits.push('consistent character identity')
  }
  const hasRefs =
    opts?.faceIdActive === true ||
    Boolean(profile.primaryPhoto) ||
    (profile.secondaryRefs || []).length > 0

  // Prefer structured cues + compact tags — never dump Spanish prose into SD
  const tagSet = new Set<string>()
  for (const x of appearanceToIdentityTags(profile.appearanceSummary || '')) tagSet.add(x)
  if (profile.hairNotes) {
    for (const x of appearanceToIdentityTags(profile.hairNotes)) tagSet.add(x)
  }
  if (profile.eyesNotes) {
    for (const x of appearanceToIdentityTags(profile.eyesNotes)) tagSet.add(x)
  }
  // Official appearance DNA (castaño/liso…) reinforces FaceID — do not drop hair tags.
  // Rival invents from the LLM are stripped in mergeCraftedWithIdentity.
  const reconciled = reconcileIdentityTags([...tagSet], profile.appearanceSummary || '')
  for (const tag of reconciled) {
    const weight = /hair/.test(tag) ? 1.45 : /eyes/.test(tag) ? 1.4 : 1.25
    bits.push('(' + tag + ':' + weight + ')')
  }
  if (hasRefs) {
    bits.push(
      'match reference face and hair, same person as identity photo',
      'natural hair from reference'
    )
  }
  bits.push(
    'photorealistic skin texture, detailed iris, coherent facial structure',
    '(natural hairline:1.25), rooted hair, hair follicles at scalp, hair growing from scalp',
    'individual hair strands, natural hair volume, realistic hair texture',
    'smooth healthy skin, even skin tone, subtle skin pores',
    '(natural neck proportions:1.3), normal length neck, shoulders connected naturally',
    'realistic adult female anatomy, coherent body proportions',
    'solo, single person, (one face:1.45), (one head:1.45)'
  )
  return bits.filter(Boolean)
}

export function identityNegativeBits(profile: IdentityProfile): string[] {
  const bits = [
    'identity mismatch',
    'different person',
    'wrong person',
    'face mismatch',
    'cloned face',
    'duplicate person',
    // hair / scalp (wig look, exposed skull, floating hair)
    'wig',
    'hairpiece',
    'fake hair',
    'synthetic hair',
    'nylon hair',
    'plastic hair',
    'helmet hair',
    'bald scalp showing through',
    'visible skull',
    'receding hairline artifacts',
    'floating hair',
    'hair not attached to head',
    'uneven hair density',
    'patchy hair',
    'hair plugs',
    'greasy hair clumps',
    // skin growths / bumps
    'skin bumps',
    'cysts',
    'tumors',
    'warts',
    'skin tags',
    'goiter',
    'neck growth',
    'extra lumps on skin',
    'bubbly skin',
    'blistered skin',
    'acne clusters',
    'rash',
    'orange peel skin',
    'airbrushed skin',
    'mannequin skin',
    'deformed neck',
    'swollen throat',
    // general face quality
    'plastic skin',
    'waxy skin',
    'oversmoothed skin',
    'melted face',
    'asymmetrical face',
    // neck / torso proportions (common SD half-body failure)
    'long neck',
    'elongated neck',
    'giraffe neck',
    'stretched neck',
    'thin long neck',
    'broken neck',
    'twisted neck',
    'no neck',
    'neck too long',
    'disproportionate neck',
    'floating head',
    'head detached from body',
    'tiny head',
    'huge head',
    'bad torso',
    'distorted shoulders',
    'uneven shoulders'
  ]
  if (profile.lockedFields.includes('hair')) {
    bits.push('wrong hair color', 'different hairstyle')
  }
  if (profile.lockedFields.includes('eyes')) {
    bits.push('wrong eye color', 'asymmetrical eyes')
  }
  return bits
}

