/**
 * C0–C3 — Wardrobe image classification, upload limits, gift intent, safe primary.
 * Pure core (no Electron). VLM JSON optional; heuristic always available.
 */

import type { LegacyGalleryItem } from './wardrobe'
import { approveImageToWardrobe, type CharacterVisualPatch } from './wardrobe-approve'

/** Primary section — mutually exclusive */
export type WardrobeKind =
  | 'portrait_identity'
  | 'full_look'
  | 'garment'
  | 'accessory'
  | 'scene'
  | 'user_other'
  | 'unknown'

export const WARDROBE_KIND_LABELS: Record<WardrobeKind, string> = {
  portrait_identity: 'Retrato / identidad',
  full_look: 'Look completo',
  garment: 'Prenda',
  accessory: 'Accesorio / joya',
  scene: 'Escena / fondo',
  user_other: 'Otra persona / no avatar',
  unknown: 'Sin clasificar'
}

/** Maps kind → legacy gallery role */
export function kindToRole(
  kind: WardrobeKind
): 'face' | 'half' | 'full' | 'scene' | 'outfit' {
  switch (kind) {
    case 'portrait_identity':
      return 'face'
    case 'full_look':
      return 'full'
    case 'scene':
      return 'scene'
    case 'garment':
    case 'accessory':
      return 'outfit'
    default:
      return 'outfit'
  }
}

/** Only these may become chat primary without being a "try-on" product shot */
export function isSafeForPrimary(kind: WardrobeKind): boolean {
  return kind === 'full_look' || kind === 'portrait_identity'
}

export function canEnterAvatarWardrobe(kind: WardrobeKind): boolean {
  return (
    kind === 'portrait_identity' ||
    kind === 'full_look' ||
    kind === 'garment' ||
    kind === 'accessory' ||
    kind === 'scene'
  )
}

/** C0 — upload limits */
export const WARDROBE_UPLOAD = {
  maxBytes: 12 * 1024 * 1024,
  maxLongEdgePx: 1280,
  classifyLongEdgePx: 1024,
  maxImagesPerMessage: 4,
  maxWardrobeItems: 48,
  minConfidenceAuto: 0.55,
  allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'] as const
} as const

export type UploadValidation =
  | { ok: true }
  | { ok: false; reason: string }

export function validateWardrobeUpload(opts: {
  mimeType?: string
  byteLength?: number
  fileName?: string
}): UploadValidation {
  const mime = (opts.mimeType || '').toLowerCase().split(';')[0].trim()
  const name = (opts.fileName || '').toLowerCase()
  const okMime =
    !mime ||
    WARDROBE_UPLOAD.allowedMime.includes(mime as (typeof WARDROBE_UPLOAD.allowedMime)[number]) ||
    /\.(jpe?g|png|webp)$/i.test(name)
  if (!okMime) {
    return { ok: false, reason: 'Formato no soportado (usa JPEG, PNG o WebP)' }
  }
  if (opts.byteLength != null && opts.byteLength > WARDROBE_UPLOAD.maxBytes) {
    return {
      ok: false,
      reason: `Imagen demasiado grande (máx. ${Math.round(WARDROBE_UPLOAD.maxBytes / (1024 * 1024))} MB)`
    }
  }
  return { ok: true }
}

export type WardrobeClassification = {
  kind: WardrobeKind
  confidence: number
  subject?: string
  hasPerson?: boolean
  hasFace?: boolean
  garmentType?: string | null
  suggestedTags: string[]
  safeForWardrobe: boolean
  safeForPrimary: boolean
  notes?: string
  source: 'heuristic' | 'vlm' | 'user'
}

/** Parse VLM JSON (tolerant) */
export function parseWardrobeClassifyJson(raw: string): WardrobeClassification | null {
  const t = (raw || '').trim()
  if (!t) return null
  let jsonStr = t
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) jsonStr = fence[1].trim()
  const brace = jsonStr.match(/\{[\s\S]*\}/)
  if (brace) jsonStr = brace[0]
  try {
    const o = JSON.parse(jsonStr) as Record<string, unknown>
    const kindRaw = String(o.kind || o.class || o.type || 'unknown')
      .toLowerCase()
      .trim()
    const kind = normalizeKind(kindRaw)
    const confidence = clamp01(Number(o.confidence ?? o.score ?? 0.6))
    const tags = Array.isArray(o.suggested_tags)
      ? (o.suggested_tags as unknown[]).map(String)
      : Array.isArray(o.suggestedTags)
        ? (o.suggestedTags as unknown[]).map(String)
        : Array.isArray(o.tags)
          ? (o.tags as unknown[]).map(String)
          : []
    return {
      kind,
      confidence,
      subject: o.subject != null ? String(o.subject) : undefined,
      hasPerson: Boolean(o.has_person ?? o.hasPerson),
      hasFace: Boolean(o.has_face ?? o.hasFace),
      garmentType:
        o.garment_type != null
          ? String(o.garment_type)
          : o.garmentType != null
            ? String(o.garmentType)
            : null,
      suggestedTags: tags.map((x) => x.slice(0, 32)).slice(0, 12),
      safeForWardrobe: canEnterAvatarWardrobe(kind),
      safeForPrimary: isSafeForPrimary(kind),
      notes: o.notes != null ? String(o.notes).slice(0, 200) : undefined,
      source: 'vlm'
    }
  } catch {
    return null
  }
}

function normalizeKind(raw: string): WardrobeKind {
  const k = raw.replace(/[\s-]+/g, '_').toLowerCase()
  if (
    /portrait|identity|face|rostro|cara|selfie|closeup|close_up/.test(k) &&
    !/full|outfit|look/.test(k)
  ) {
    return 'portrait_identity'
  }
  if (/full_look|fulllook|full_body|look_completo|outfit_on_model|on_model/.test(k)) {
    return 'full_look'
  }
  if (/garment|prenda|clothing|dress|shirt|pants|flat_lay|flatlay|hanger|product/.test(k)) {
    return 'garment'
  }
  if (/accessor|jewelry|jewel|joya|anillo|ring|bag|shoe|zapato|collar|necklace/.test(k)) {
    return 'accessory'
  }
  if (/scene|fondo|background|landscape|playa|beach|interior|exterior|place/.test(k)) {
    return 'scene'
  }
  if (/user_other|other_person|not_avatar|stranger|usuario/.test(k)) {
    return 'user_other'
  }
  const allowed: WardrobeKind[] = [
    'portrait_identity',
    'full_look',
    'garment',
    'accessory',
    'scene',
    'user_other',
    'unknown'
  ]
  if (allowed.includes(k as WardrobeKind)) return k as WardrobeKind
  return 'unknown'
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

/**
 * C1 heuristic when no VLM: uses caption/user text + optional flags.
 * Never invents high confidence without signals.
 */
export function classifyWardrobeHeuristic(opts: {
  userText?: string
  fileName?: string
  /** From a prior short caption if any */
  caption?: string
}): WardrobeClassification {
  const blob = `${opts.userText || ''} ${opts.fileName || ''} ${opts.caption || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  const tags: string[] = []
  let kind: WardrobeKind = 'unknown'
  let confidence = 0.4
  let subject: string | undefined
  let garmentType: string | null = null

  if (
    /anillo|collar|arete|pendiente|pulsera|reloj|bolso|zapato|tacones|cinturon|joya|jewelry|necklace|ring\b|earring/.test(
      blob
    )
  ) {
    kind = 'accessory'
    confidence = 0.72
    subject = 'accessory'
    tags.push('accessory')
  } else if (
    /\b(prenda|vestido|falda|blusa|camisa|pantalon|jeans|chaqueta|abrigo|sueter|playera|top\b|dress|skirt|jacket|flat.?lay|percha|maniqui)\b/.test(
      blob
    ) &&
    !/\b(ponermela|puesto|mirame|asi me veo)\b/.test(blob)
  ) {
    kind = 'garment'
    confidence = 0.7
    subject = 'garment'
    garmentType = /vestido|dress/.test(blob)
      ? 'dress'
      : /pantalon|jeans|pants/.test(blob)
        ? 'bottom'
        : /camisa|blusa|top|playera|shirt/.test(blob)
          ? 'top'
          : null
    tags.push('garment')
    if (garmentType) tags.push(`garment:${garmentType}`)
  } else if (
    /\b(playa|bosque|oficina|ciudad|atardecer|fondo|escena|paisaje|habitacion|cuarto|calle|beach|landscape|background only)\b/.test(
      blob
    ) &&
    !/\b(yo|ella|vestid|outfit|persona)\b/.test(blob)
  ) {
    kind = 'scene'
    confidence = 0.68
    subject = 'scene'
    tags.push('scene')
  } else if (
    /\b(retrato|primer plano|solo cara|close.?up|faceid|rostro|avatar)\b/.test(blob)
  ) {
    kind = 'portrait_identity'
    confidence = 0.65
    subject = 'face'
    tags.push('framing:face')
  } else if (
    /\b(look|outfit completo|cuerpo entero|asi te ves|esta foto tuya|full body)\b/.test(blob)
  ) {
    kind = 'full_look'
    confidence = 0.62
    subject = 'full_look'
    tags.push('full_look')
  } else if (/\b(yo soy|esta soy yo|mi foto|selfie mia)\b/.test(blob)) {
    kind = 'user_other'
    confidence = 0.6
    tags.push('user_other')
  } else if (
    /\b(niamh|avatar|guardarropa|wardrobe|look_|outfit_|principal)\b/.test(blob) ||
    /coqueta|sensual|vestuario|cuero|bosque|retrato/.test(blob)
  ) {
    // App-generated / wardrobe filenames → treat as full_look when person implied
    kind = /retrato|face|cara|close/.test(blob) ? 'portrait_identity' : 'full_look'
    confidence = 0.58
    subject = kind === 'portrait_identity' ? 'face' : 'full_look'
    tags.push(kind === 'portrait_identity' ? 'framing:face' : 'full_look')
  }

  // Color / vibe tags (non-kind)
  if (/rojo|red|pelirroj/.test(blob)) tags.push('color:red_hair')
  if (/negro|black|oscuro/.test(blob)) tags.push('color:dark')
  if (/blanco|white|claro/.test(blob)) tags.push('color:light')
  if (/elegante|formal|noche|elegant/.test(blob)) tags.push('elegant')
  if (/casual|diario|street/.test(blob)) tags.push('casual')
  if (/intimo|sensual|lenceria|lingerie/.test(blob)) tags.push('intimate')
  if (/cuero|leather/.test(blob)) tags.push('material:leather')

  return {
    kind,
    confidence,
    subject,
    hasPerson: kind === 'full_look' || kind === 'portrait_identity',
    hasFace: kind === 'portrait_identity' || kind === 'full_look',
    garmentType,
    suggestedTags: [...new Set(tags)].slice(0, 12),
    safeForWardrobe: canEnterAvatarWardrobe(kind),
    safeForPrimary: isSafeForPrimary(kind),
    notes: kind === 'unknown' ? 'needs_user_section' : undefined,
    source: 'heuristic'
  }
}

/** Merge VLM + heuristic; prefer higher confidence; user override wins */
export function mergeClassification(
  primary: WardrobeClassification | null,
  fallback: WardrobeClassification
): WardrobeClassification {
  if (!primary) return fallback
  if (primary.source === 'user') return primary
  if (primary.confidence >= fallback.confidence) return primary
  if (primary.kind !== 'unknown' && primary.confidence >= WARDROBE_UPLOAD.minConfidenceAuto) {
    return primary
  }
  if (fallback.kind !== 'unknown' && fallback.confidence > primary.confidence) {
    return { ...fallback, notes: primary.notes || fallback.notes }
  }
  return primary.kind !== 'unknown' ? primary : fallback
}

export function needsUserKindConfirm(c: WardrobeClassification): boolean {
  return (
    c.kind === 'unknown' ||
    c.confidence < WARDROBE_UPLOAD.minConfidenceAuto ||
    c.source === 'heuristic' && c.kind === 'unknown'
  )
}

/** Prompt for local VLM — strict JSON only */
export const WARDROBE_CLASSIFY_VLM_PROMPT = `Clasifica esta imagen para un guardarropa de avatar. Responde SOLO un JSON válido, sin markdown:
{"kind":"portrait_identity|full_look|garment|accessory|scene|user_other|unknown","confidence":0.0,"subject":"breve","has_person":true,"has_face":false,"garment_type":null,"suggested_tags":[],"notes":""}
Reglas:
- portrait_identity: solo cara/busto del personaje (identidad).
- full_look: persona completa con ropa (look para foto de chat).
- garment: prenda sola (percha, flat lay, maniquí sin cara clara).
- accessory: joya, bolso, zapatos, cinturón.
- scene: lugar/fondo sin protagonista de identidad.
- user_other: otra persona, selfie del usuario, meme, captura.
- unknown: no seguro.
Una sola kind. confidence 0-1.`

/** C3 — gift / "for you" intent from user text */
/** User shared a photo meant to *be* the character (avatar update). */
export function detectCharacterPhotoIntent(userText: string): {
  isCharacterPhoto: boolean
  score: number
} {
  const t = (userText || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  let score = 0
  if (
    /nueva\s+foto\s+de\s+ti|foto\s+(nueva\s+)?(de\s+)?ti\b|esta\s+eres\s+tu|eres\s+tu\s+(en\s+)?(esta|la)\s+foto|tu\s+nueva\s+foto|actualiza\s+tu\s+(foto|avatar|imagen)|foto\s+principal|esta\s+es\s+(tu\s+)?(nueva\s+)?foto|foto\s+tuya|de\s+ti\s+mism[oa]|asi\s+te\s+ves|como\s+te\s+ves\s+(aqui|ahi)|te\s+cambie\s+la\s+foto|te\s+puse\s+esta\s+foto|nueva\s+imagen\s+de\s+ti/i.test(
      t
    )
  ) {
    score += 0.78
  }
  if (/guardarropa|avatar|principal/.test(t) && /foto|imagen|mira|ve\b/.test(t)) score += 0.15
  if (/mira\s+mi\s+amor/.test(t) && /foto/.test(t)) score += 0.1
  // Soft: "mira esto" / "qué te parece" with an attached image (handled with hasImage in host)
  if (/\b(mira|ve|ves|que te parece|te gusta)\b/.test(t) && /\b(foto|imagen|look|outfit|vestid)/.test(t)) {
    score += 0.35
  }
  return { isCharacterPhoto: score >= 0.55, score: Math.min(1, score) }
}

/**
 * Host helper: offer wardrobe when any relevant image is attached.
 * Does not require gift phrasing — classification decides safety.
 */
export function shouldOfferWardrobeForAttachment(opts: {
  classification: WardrobeClassification
  characterPhotoScore: number
  giftScore: number
  userText?: string
  hasImage: boolean
}): boolean {
  if (!opts.hasImage) return false
  const c = opts.classification
  if (c.kind === 'user_other' && !c.safeForWardrobe) return false
  if (opts.characterPhotoScore >= 0.55 || opts.giftScore >= 0.55) return true
  if (c.safeForWardrobe && c.kind !== 'unknown') return true
  // Bare image + soft "mira/ve" or empty caption → soft offer (LLM classifies in reply)
  const t = (opts.userText || '').toLowerCase()
  if (c.kind === 'unknown' && (/\b(mira|ve|ves|foto|imagen|look)\b/.test(t) || !t.trim())) {
    return true
  }
  return false
}

/** Unified system block: see + classify + ask (LLM must not auto-save). */
export function buildWardrobeClassifyAndOfferNudge(opts: {
  classification: WardrobeClassification
  characterName?: string
  userHint?: string
  mode?: 'character_photo' | 'gift' | 'general'
}): string {
  const name = (opts.characterName || 'el asistente').trim()
  const c = opts.classification
  const kindLabel = WARDROBE_KIND_LABELS[c.kind] || c.kind
  const tags = (c.tags || []).slice(0, 8).join(', ') || '(sin tags aún)'
  const mode =
    opts.mode === 'gift'
      ? 'regalo / algo para ti'
      : opts.mode === 'character_photo'
        ? 'posible foto tuya / look nuevo'
        : 'imagen compartida'
  return [
    `[GUARDARROPA — ver + clasificar + ofrecer]`,
    `Modo: ${mode}. Clase heurística: «${kindLabel}» (conf. ${c.confidence.toFixed(2)}, fuente ${c.source}).`,
    `Tags sugeridos: ${tags}.`,
    c.notes ? `Nota: ${c.notes}` : '',
    opts.userHint ? `Usuario: «${opts.userHint.slice(0, 140)}»` : '',
    `1) Describe lo que VES en la imagen (visión); no inventes lo que no se ve.`,
    `2) Opina en personaje (${name}) con naturalidad.`,
    `3) Si encaja en tu guardarropa, clasifica mentalmente (cara / look / prenda / escena / accesorio) y`,
    `   PIDE permiso para guardarla (la app mostrará botones). NUNCA digas que ya la guardaste.`,
    !c.safeForPrimary
      ? `4) NO propongas esta imagen como foto principal del chat (clase ${kindLabel}).`
      : `4) Si el usuario quiere, también puedes ofrecerla como foto principal.`,
    !c.safeForWardrobe
      ? `5) Si no es de ti (otra persona / meme), dilo y no pidas guardarropa del avatar.`
      : `5) Si confirma, se guardará con rol/tags «${kindLabel}».`
  ]
    .filter(Boolean)
    .join('\n')
}

/** Nudge: react + ask wardrobe and/or primary — confirmation via UI chips or explicit yes. */
export function buildCharacterPhotoOfferNudge(opts: {
  characterName?: string
  userHint?: string
}): string {
  const name = (opts.characterName || 'el personaje').trim()
  return [
    '[FOTO DE PERSONAJE — oferta guardarropa / principal]',
    `El usuario te muestra una imagen como **nueva foto de ti** (${name}).`,
    opts.userHint ? `Contexto: «${opts.userHint.slice(0, 140)}»` : '',
    '1) Reacciona en personaje a lo que **ves en la imagen** (no inventes rasgos que no estén).',
    '2) Pregunta con naturalidad (1–2 frases) si quieres:',
    '   · guardarla en **tu guardarropa**, y/o',
    '   · usarla como **foto principal** del chat.',
    '3) NO digas que ya la guardaste ni que ya cambiaste la principal: la app mostrará botones; el usuario confirma o escribe que sí.',
    '4) Evita menús robotizados; tono de pareja/compañía según el vínculo.'
  ]
    .filter(Boolean)
    .join('\n')
}

export function detectWardrobeGiftIntent(userText: string): {
  isGift: boolean
  wantsTryOn: boolean
  score: number
} {
  const t = (userText || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  let score = 0
  const giftRe =
    /(?:mira|ve|ves).{0,24}(?:para\s+ti)|(?:te\s+)?(?:compr[eé]|regal[eé]|traj[eé]|consegu[ií]|hic[eé]|prepar[eé]).{0,48}para\s+ti|para\s+ti.{0,24}(?:compr|regal|traj|consegu|hic)|esto\s+es\s+para\s+ti|te\s+lo\s+regalo|para\s+tu\s+guardarropa|guarda(?:lo|la)\s+en\s+(?:tu\s+)?guardarropa|mira\s+lo\s+que\s+(?:tengo|consegu|hic).{0,20}para\s+ti|te\s+compr[eé]\s+esto/i
  if (giftRe.test(t) || (/para\s+ti/.test(t) && /mira|ve\b|compr|regal|traj|hic/.test(t))) {
    score += 0.7
  }
  if (/guardarropa|wardrobe|tu\s+galeria/.test(t)) score += 0.2
  const tryOn =
    /(?:pon(?:te|ertelo|erselo|ertela)|prueba(?:te)?lo|te\s+queda|en\s+ti|vistete|vístete)/i.test(
      t
    )
  if (tryOn) score += 0.25
  return {
    isGift: score >= 0.55,
    wantsTryOn: tryOn,
    score: Math.min(1, score)
  }
}

/** System nudge after classified gift image */
export function buildWardrobeGiftSystemNudge(opts: {
  classification: WardrobeClassification
  characterName?: string
  userHint?: string
}): string {
  const name = (opts.characterName || 'el asistente').trim()
  const c = opts.classification
  const kindLabel = WARDROBE_KIND_LABELS[c.kind]
  const lines = [
    `[GUARDARROPA — regalo del usuario]`,
    `Clase detectada: ${kindLabel} (confianza ${c.confidence.toFixed(2)}, fuente ${c.source}).`,
    c.notes ? `Nota: ${c.notes}` : '',
    opts.userHint ? `Usuario dijo algo como: «${opts.userHint.slice(0, 120)}»` : '',
    `Opina en personaje (${name}), con genuina reacción según personalidad.`,
    `Si te gusta, PIDE permiso explícito para guardarlo en tu guardarropa. No digas que ya lo guardaste.`,
    !c.safeForPrimary
      ? `Esta clase NO debe proponerse como foto principal del chat (es ${kindLabel}).`
      : `Si el usuario confirma, puede proponerse como look/foto de chat.`,
    !c.safeForWardrobe
      ? `No pertenece al guardarropa del avatar; no pidas guardarlo ahí.`
      : `Si confirma, la app lo guardará en la sección «${kindLabel}».`
  ]
  return lines.filter(Boolean).join('\n')
}

export type ApproveClassifiedInput = {
  dataUrl: string
  filePath?: string
  title?: string
  classification: WardrobeClassification
  source?: 'user' | 'generated' | 'imported' | 'chat_gift'
  giftFromUser?: boolean
  setAsPrimary?: boolean
}

/**
 * C2/C3 — approve into gallery with kind tags; primary only if safe + requested.
 */
export function approveClassifiedToWardrobe(
  character: {
    visualImageUrl?: string
    visualGallery?: LegacyGalleryItem[]
  },
  input: ApproveClassifiedInput
): CharacterVisualPatch & { rejected?: string } {
  const c = input.classification
  if (!canEnterAvatarWardrobe(c.kind)) {
    return {
      visualGallery: [...(character.visualGallery || [])],
      visualImageUrl: character.visualImageUrl,
      rejected: 'kind_not_for_avatar_wardrobe'
    }
  }
  const role = kindToRole(c.kind)
  const tags = [
    `kind:${c.kind}`,
    ...c.suggestedTags,
    input.giftFromUser || input.source === 'chat_gift' ? 'gift' : '',
    input.source === 'chat_gift' ? 'source:chat_gift' : ''
  ].filter(Boolean) as string[]

  const wantPrimary = Boolean(input.setAsPrimary) && isSafeForPrimary(c.kind)
  const patch = approveImageToWardrobe(
    character,
    {
      dataUrl: input.dataUrl,
      filePath: input.filePath,
      title: input.title || c.subject || WARDROBE_KIND_LABELS[c.kind],
      tags,
      role,
      source: input.source === 'chat_gift' ? 'user' : input.source || 'user'
    },
    {
      setAsPrimary: wantPrimary,
      maxItems: WARDROBE_UPLOAD.maxWardrobeItems
    }
  )
  return patch
}

/** Filter gallery by kind tag or role */
export function filterGalleryByKind(
  gallery: LegacyGalleryItem[] | undefined | null,
  kind: WardrobeKind | 'all'
): LegacyGalleryItem[] {
  const list = gallery || []
  if (kind === 'all') return list
  return list.filter((g) => {
    const tags = g.tags || []
    if (tags.some((t) => t === `kind:${kind}` || t.startsWith(`kind:${kind}`))) return true
    const role = (g.role || '').toLowerCase()
    if (kind === 'portrait_identity' && role === 'face') return true
    if (kind === 'full_look' && (role === 'full' || role === 'half')) return true
    if (kind === 'scene' && role === 'scene') return true
    if ((kind === 'garment' || kind === 'accessory') && role === 'outfit') {
      if (kind === 'accessory') return tags.some((t) => /accessor|jewelry|joya/.test(t))
      return !tags.some((t) => /accessor|jewelry|joya/.test(t))
    }
    return false
  })
}

export function inventoryByKind(
  gallery: LegacyGalleryItem[] | undefined | null
): Record<WardrobeKind | 'untyped', number> {
  const counts: Record<string, number> = {
    portrait_identity: 0,
    full_look: 0,
    garment: 0,
    accessory: 0,
    scene: 0,
    user_other: 0,
    unknown: 0,
    untyped: 0
  }
  for (const g of gallery || []) {
    const tag = (g.tags || []).find((t) => t.startsWith('kind:'))
    if (tag) {
      const k = tag.slice(5) as WardrobeKind
      counts[k] = (counts[k] || 0) + 1
    } else if (g.role === 'face') counts.portrait_identity++
    else if (g.role === 'scene') counts.scene++
    else if (g.role === 'full' || g.role === 'half') counts.full_look++
    else if (g.role === 'outfit') counts.garment++
    else counts.untyped++
  }
  return counts as Record<WardrobeKind | 'untyped', number>
}


/**
 * Parse light classification from model reply (chat classification).
 * Does NOT invent wardrobe rows — only structured hints for UI / approve.
 */
export function parseClassificationHintsFromText(text: string): {
  kind?: WardrobeKind
  tags: string[]
  title?: string
} {
  const t = String(text || '')
  const low = t.toLowerCase()
  const tags: string[] = []
  let kind: WardrobeKind | undefined
  if (/\b(retrato|primer plano|solo (la )?cara|close-?up|rostro)\b/i.test(t)) kind = 'portrait_identity'
  else if (/\b(escena|fondo|paisaje|ambiente)\b/i.test(t) && !/\b(vestid|outfit|look)\b/i.test(t))
    kind = 'scene'
  else if (/\b(accesorio|collar|anillo|joya)\b/i.test(t)) kind = 'accessory'
  else if (/\b(prenda|solo (la )?ropa|sin persona)\b/i.test(t)) kind = 'garment'
  else if (/\b(look|outfit|cuerpo|entero|pose)\b/i.test(t)) kind = 'full_look'

  const tagHits = t.match(/(?:tags?|etiquetas?)\s*[:：]\s*([^\n.]+)/i)
  if (tagHits) {
    for (const p of tagHits[1].split(/[,;/|]/)) {
      const s = p.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 24)
      if (s.length >= 2) tags.push(s)
    }
  }
  if (/casual/i.test(low)) tags.push('casual')
  if (/elegante|formal/i.test(low)) tags.push('elegant')
  if (/sensual|íntim|intim/i.test(low)) tags.push('intimate')

  const titleHit = t.match(/(?:t[ií]tulo|title|nombre)\s*[:：]\s*[«"']?([^»"'\n]{3,48})/i)
  return {
    kind,
    tags: [...new Set(tags)].slice(0, 10),
    title: titleHit ? titleHit[1].trim() : undefined
  }
}
