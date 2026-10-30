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
  const t = String(text || '').toLowerCase()
  const tags: string[] = []
  if (/pelirroj|red hair|cabello rojo|pelo rojo|redhead/.test(t)) tags.push('long red hair')
  else if (/rubi[ao]|blonde|blond|cabello rubio/.test(t)) tags.push('blonde hair')
  else if (/casta[nñ]|brunette|brown hair|cabello casta/.test(t)) tags.push('brown hair')
  else if (/negro|black hair|cabello negro/.test(t)) tags.push('black hair')
  if (/rizado|curly|rizos/.test(t)) tags.push('curly hair')
  else if (/ondulado|wavy/.test(t)) tags.push('wavy hair')
  else if (/lacio|straight|liso/.test(t)) tags.push('straight hair')
  if (/ojo[s]? violet|violet eyes/.test(t)) tags.push('violet eyes')
  else if (/ojo[s]? azul|blue eyes/.test(t)) tags.push('blue eyes')
  else if (/ojo[s]? verde|green eyes/.test(t)) tags.push('green eyes')
  else if (/ojo[s]? marr|brown eyes|hazel/.test(t)) tags.push('brown eyes')
  if (/piel clara|fair skin|pale/.test(t)) tags.push('fair skin')
  if (/sonrisa|smile/.test(t)) tags.push('subtle smile')
  return [...new Set(tags)]
}

export function identityProfileToPromptBits(
  profile: IdentityProfile,
  opts?: { weight?: number }
): string[] {
  const w = opts?.weight ?? 1.35
  const bits: string[] = []
  const name = profile.canonicalName
  if (name) {
    bits.push('portrait of ' + name)
    bits.push('(same person as ' + name + ':' + w.toFixed(2) + ')')
    bits.push('consistent character identity')
  }
  // Prefer structured cues + compact tags — never dump Spanish prose into SD
  const tagSet = new Set<string>()
  for (const x of appearanceToIdentityTags(profile.appearanceSummary || '')) tagSet.add(x)
  if (profile.hairNotes) {
    for (const x of appearanceToIdentityTags(profile.hairNotes)) tagSet.add(x)
  }
  if (profile.eyesNotes) {
    for (const x of appearanceToIdentityTags(profile.eyesNotes)) tagSet.add(x)
  }
  for (const tag of tagSet) {
    const weight = /hair/.test(tag) ? 1.45 : /eyes/.test(tag) ? 1.4 : 1.25
    bits.push('(' + tag + ':' + weight + ')')
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

