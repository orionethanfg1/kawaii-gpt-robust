/**
 * C4 — Contextual visual wardrobe initiative (pure, no Electron).
 *
 * Gate before any proposal:
 *  1) WHAT  — concrete full_look / portrait candidate (not garment/scene alone)
 *  2) WHY   — context, time, weather, taste, or allowed spontaneity
 *  3) MODE  — coherent with chat vs spontaneous (both ok if natural)
 *
 * Never mutates primary without UI confirm. Anti-spam: cooldown, stage, messages, random.
 */

import {
  enrichVisualGallery,
  migrateGalleryItem,
  type CharacterWardrobeSource,
  type LegacyGalleryItem,
  type WardrobeItem
} from './wardrobe'
import { isSafeForPrimary, type WardrobeKind } from './wardrobe-classify'

export type RelationshipStageHint =
  | 'stranger'
  | 'acquaintance'
  | 'familiar'
  | 'intimate'
  | string

export type DayPart = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night'

export type WeatherHint = {
  /** e.g. "clear" | "rain" | "cold" | "hot" | "cloudy" */
  condition?: string
  tempC?: number
  /** Free text from a weather API or user city note */
  summary?: string
}

export type VisualWhyKind =
  | 'chat_context'
  | 'time_of_day'
  | 'weather'
  | 'user_taste'
  | 'own_desire'
  | 'spontaneous'

export type VisualProposeMode = 'coherent' | 'spontaneous'

export type VisualProposeCandidate = {
  item: WardrobeItem
  /** Human-readable look label */
  reason: string
  whyKind: VisualWhyKind
  mode: VisualProposeMode
  whyText: string
  dayPart?: DayPart
}

export function maxIntimacyForStage(stage?: RelationshipStageHint | null): number {
  const s = String(stage || '').toLowerCase()
  if (s === 'intimate') return 2
  if (s === 'familiar') return 1
  if (s === 'acquaintance') return 0
  return 0
}

/** 48h between photo proposals — rare, not a habit */
export const VISUAL_INITIATIVE_COOLDOWN_MS = 48 * 60 * 60 * 1000

/** Soft minimum messages in the active chat before another photo proposal */
export const VISUAL_INITIATIVE_MIN_MESSAGES = 16

/** Even when eligible, only ~8% of idle ticks fire (anti-spam) */
export const VISUAL_INITIATIVE_FIRE_PROBABILITY = 0.08

/** Spontaneous path: even rarer when no chat cue */
export const VISUAL_SPONTANEOUS_PROBABILITY = 0.35

export function resolveDayPart(date: Date = new Date()): DayPart {
  const h = date.getHours()
  if (h >= 5 && h < 8) return 'dawn'
  if (h >= 8 && h < 12) return 'morning'
  if (h >= 12 && h < 18) return 'afternoon'
  if (h >= 18 && h < 22) return 'evening'
  return 'night'
}

export function dayPartLabel(part: DayPart): string {
  switch (part) {
    case 'dawn':
      return 'madrugada'
    case 'morning':
      return 'mañana'
    case 'afternoon':
      return 'tarde'
    case 'evening':
      return 'noche temprana'
    case 'night':
      return 'noche'
  }
}

/** Tags / roles that may become chat primary */
function itemKindFromTags(item: WardrobeItem): WardrobeKind | 'legacy' {
  const tag = (item.tags || []).find((t) => t.startsWith('kind:'))
  if (tag) {
    const k = tag.slice(5) as WardrobeKind
    if (
      k === 'full_look' ||
      k === 'portrait_identity' ||
      k === 'garment' ||
      k === 'accessory' ||
      k === 'scene'
    ) {
      return k
    }
  }
  if (item.role === 'face') return 'portrait_identity'
  if (item.role === 'full' || item.role === 'half') return 'full_look'
  if (item.role === 'scene') return 'scene'
  if (item.role === 'outfit') return 'garment'
  return 'legacy'
}

function isPrimaryEligible(item: WardrobeItem): boolean {
  const k = itemKindFromTags(item)
  if (k === 'legacy') {
    // Legacy without kind: allow full/half/face/outfit with person-like role, not pure scene
    return item.role === 'full' || item.role === 'half' || item.role === 'face' || item.role === 'outfit'
  }
  return isSafeForPrimary(k)
}

export type VisualGateInput = {
  enabled?: boolean
  galleryCount: number
  lastProposeAt?: number
  now?: number
  relationshipStage?: RelationshipStageHint | null
  conversationInitiativeEnabled?: boolean
  /** Another initiative already filled this tick */
  hasOtherInitiativeText?: boolean
  messageCount?: number
  /** Professional / assistant-only — no wardrobe flirting */
  relationshipRole?: string | null
  /** Intimate scene active — don't interrupt with outfit changes */
  scenePhase?: string | null
  /** User recently rejected a visual propose */
  lastRejectAt?: number
  /** Skip random for tests */
  forceEligible?: boolean
}

export function shouldProposeVisualChange(opts: VisualGateInput): {
  ok: boolean
  reason: string
} {
  if (opts.conversationInitiativeEnabled === false || opts.enabled === false) {
    return { ok: false, reason: 'disabled' }
  }
  if (opts.hasOtherInitiativeText) {
    return { ok: false, reason: 'defer_to_llm_text' }
  }
  if ((opts.galleryCount || 0) < 2) {
    return { ok: false, reason: 'need_2_plus_looks' }
  }

  const role = String(opts.relationshipRole || '').toLowerCase()
  if (
    /profesional|assistant only|solo asistente|mentor|coach|trabajo|laboral/.test(role) &&
    !/novia|pareja|románt|romant|íntim|intim|cercan/.test(role)
  ) {
    return { ok: false, reason: 'professional_mode' }
  }

  const phase = String(opts.scenePhase || '').toLowerCase()
  if (phase === 'scene_active' || phase === 'aftercare') {
    return { ok: false, reason: 'intimate_scene_busy' }
  }

  const stage = String(opts.relationshipStage || 'stranger').toLowerCase()
  if (stage === 'stranger' || stage === 'acquaintance' || !stage) {
    return { ok: false, reason: 'stage_too_early' }
  }

  if (
    typeof opts.messageCount === 'number' &&
    opts.messageCount < VISUAL_INITIATIVE_MIN_MESSAGES
  ) {
    return { ok: false, reason: 'need_more_messages' }
  }

  const now = opts.now ?? Date.now()
  const last = opts.lastProposeAt || 0
  if (last > 0 && now - last < VISUAL_INITIATIVE_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown' }
  }

  const rejectAt = opts.lastRejectAt || 0
  if (rejectAt > 0 && now - rejectAt < VISUAL_INITIATIVE_COOLDOWN_MS) {
    return { ok: false, reason: 'recent_reject' }
  }

  if (!opts.forceEligible && Math.random() > VISUAL_INITIATIVE_FIRE_PROBABILITY) {
    return { ok: false, reason: 'random_skip' }
  }

  return { ok: true, reason: 'ok' }
}

/** Detect outfit/look cues in recent chat */
export function detectChatLookContext(chatBlob?: string): {
  hit: boolean
  cues: string[]
} {
  const t = (chatBlob || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  if (!t.trim()) return { hit: false, cues: [] }
  const cues: string[] = []
  const rules: Array<[RegExp, string]> = [
    [/\b(vestid|ropa|outfit|look|ponerte|cambiar.*foto|foto del chat)\b/, 'outfit'],
    [/\b(salir|cita|cenar|evento|fiesta)\b/, 'salida'],
    [/\b(frio|frío|abrigo|lluvia|calor|soleado)\b/, 'clima_chat'],
    [/\b(bonita|linda|guapa|hermosa|te ves)\b/, 'compliment'],
    [/\b(negro|rojo|blanco|azul|elegante|casual)\b/, 'style_word']
  ]
  for (const [re, cue] of rules) {
    if (re.test(t) && !cues.includes(cue)) cues.push(cue)
  }
  return { hit: cues.length > 0, cues }
}

function scoreCandidate(
  item: WardrobeItem,
  opts: {
    dayPart: DayPart
    weather?: WeatherHint | null
    chatCues: string[]
    primary: string
  }
): number {
  let s = 0
  const blob = `${item.title} ${item.tags.join(' ')} ${item.role}`.toLowerCase()
  if (!isPrimaryEligible(item)) return -100
  if (item.dataUrl === opts.primary) return -100
  if (item.role === 'face') s += 1
  if (item.role === 'full' || item.role === 'half') s += 3
  if ((item.tags || []).some((t) => t.includes('kind:full_look'))) s += 4
  if ((item.tags || []).some((t) => t.includes('kind:portrait'))) s += 2

  // Time affinity
  if (opts.dayPart === 'morning' || opts.dayPart === 'dawn') {
    if (/casual|manana|mañana|dia|día|fresco|suave/.test(blob)) s += 3
    if (/noche|evening|fiesta|lenceria/.test(blob)) s -= 2
  }
  if (opts.dayPart === 'evening' || opts.dayPart === 'night') {
    if (/noche|elegante|formal|salida|dark|negro/.test(blob)) s += 3
    if (/playa|sol|deport/.test(blob)) s -= 1
  }
  if (opts.dayPart === 'afternoon') {
    if (/casual|paseo|ciudad|oficina/.test(blob)) s += 2
  }

  // Weather
  const w = opts.weather
  if (w) {
    const cond = `${w.condition || ''} ${w.summary || ''}`.toLowerCase()
    const cold = (w.tempC != null && w.tempC < 14) || /cold|frio|frío|rain|lluvia/.test(cond)
    const hot = (w.tempC != null && w.tempC > 28) || /hot|calor|heat/.test(cond)
    if (cold && /abrigo|abriga|chaqueta|sweater|cold|invierno/.test(blob)) s += 4
    if (hot && /verano|ligero|fresco|short|sin manga/.test(blob)) s += 3
    if (/rain|lluvia/.test(cond) && /lluvia|rain|interior/.test(blob)) s += 2
  }

  // Chat cues
  for (const cue of opts.chatCues) {
    if (cue === 'salida' && /elegante|noche|formal|salida/.test(blob)) s += 3
    if (cue === 'style_word') {
      // weak boost if any style tag
      if (item.tags.length) s += 1
    }
    if (cue === 'compliment') s += 1
  }

  // Prefer less recently implied: diversity via tag count
  s += Math.min(3, item.tags?.length || 0) * 0.3
  return s
}

export type PickVisualOpts = {
  character?: CharacterWardrobeSource | null
  relationshipStage?: RelationshipStageHint | null
  recentPrimaryUrl?: string
  /** Recent user+assistant text for coherence */
  chatBlob?: string
  now?: number
  weather?: WeatherHint | null
  /** Skip spontaneous random for tests */
  forceMode?: VisualProposeMode
}

/**
 * C4 pick: returns null if WHAT or WHY cannot be filled honestly.
 */
export function pickVisualProposeCandidate(opts: PickVisualOpts): VisualProposeCandidate | null {
  const char = opts.character
  if (!char) return null
  const maxInt = maxIntimacyForStage(opts.relationshipStage)
  const primary = (opts.recentPrimaryUrl || char.visualImageUrl || '').trim()
  const dayPart = resolveDayPart(opts.now ? new Date(opts.now) : new Date())
  const chat = detectChatLookContext(opts.chatBlob)

  const enriched = enrichVisualGallery(char.visualGallery, char.visualImageUrl)
  const items: WardrobeItem[] = []
  for (let i = 0; i < enriched.length; i++) {
    const w = migrateGalleryItem(enriched[i] as LegacyGalleryItem, i)
    if (w && w.intimacy <= maxInt) items.push(w)
  }

  const pool = items
    .map((it) => ({
      it,
      score: scoreCandidate(it, {
        dayPart,
        weather: opts.weather,
        chatCues: chat.cues,
        primary
      })
    }))
    .filter((x) => x.score > -50)
    .sort((a, b) => b.score - a.score)

  if (!pool.length) return null

  // Prefer top 3 by score
  const top = pool.slice(0, 3)
  const pick = top[Math.floor(Math.random() * top.length)].it

  // WHY + MODE
  let whyKind: VisualWhyKind
  let mode: VisualProposeMode
  let whyText: string

  if (chat.hit && pool[0].score >= 2) {
    mode = 'coherent'
    whyKind = 'chat_context'
    whyText = 'encaja con lo que estábamos hablando'
  } else if (opts.weather && (opts.weather.summary || opts.weather.condition || opts.weather.tempC != null)) {
    mode = 'coherent'
    whyKind = 'weather'
    const wsum =
      opts.weather.summary ||
      opts.weather.condition ||
      (opts.weather.tempC != null ? `${Math.round(opts.weather.tempC)}°C` : 'el clima de hoy')
    whyText = `por el clima (${wsum})`
  } else if (dayPart === 'morning' || dayPart === 'evening' || dayPart === 'night') {
    // Time can justify coherent OR soft spontaneous
    const timeLed = pool[0].score >= 2
    if (timeLed) {
      mode = 'coherent'
      whyKind = 'time_of_day'
      whyText = `me apetecía algo de ${dayPartLabel(dayPart)}`
    } else {
      // Spontaneous only with probability
      if (opts.forceMode === 'coherent') return null
      if (opts.forceMode !== 'spontaneous' && Math.random() > VISUAL_SPONTANEOUS_PROBABILITY) {
        return null
      }
      mode = 'spontaneous'
      whyKind = 'spontaneous'
      whyText = 'quería lucir así para ti'
    }
  } else {
    if (opts.forceMode === 'coherent') return null
    if (opts.forceMode !== 'spontaneous' && Math.random() > VISUAL_SPONTANEOUS_PROBABILITY) {
      return null
    }
    mode = 'spontaneous'
    whyKind = 'own_desire'
    whyText = 'me apetecía cambiar un poco el look'
  }

  const tagHint = pick.tags?.[0] ? ` · ${pick.tags[0]}` : ''
  return {
    item: pick,
    reason: `«${pick.title}»${tagHint}`,
    whyKind,
    mode,
    whyText,
    dayPart
  }
}

export function buildVisualProposeMessage(opts: {
  characterName?: string
  candidate: VisualProposeCandidate
}): string {
  const title = opts.candidate.item.title || 'este look'
  const why = opts.candidate.whyText
  const mode = opts.candidate.mode

  if (mode === 'spontaneous') {
    const variants = [
      `Oye… me apetecía ponerme «${title}» para ti. ${capitalize(why)}. ¿La dejo de foto del chat?`,
      `Quería lucir así un rato: «${title}». ¿Te late si la pongo de principal, o mejor la dejo solo en el guardarropa?`,
      `Se me antojó este look («${title}»). ${capitalize(why)} — ¿cambiamos la foto del chat o lo dejamos estar?`
    ]
    return variants[Math.floor(Math.random() * variants.length)]
  }

  const variants = [
    `Con lo de ahora, me encajaría «${title}» — ${why}. ¿Te parece si la pongo de foto del chat?`,
    `Pensé en «${title}» (${why}). ¿La dejamos de principal o sigo como estoy?`,
    `Si te parece bien, cambiaría mi foto a «${title}» porque ${why}. Tú decides.`
  ]
  return variants[Math.floor(Math.random() * variants.length)]
}

function capitalize(s: string): string {
  const t = (s || '').trim()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Wishes for new looks — text only, no image generation. */
export const VISUAL_WISH_COOLDOWN_MS = 36 * 60 * 60 * 1000

const WISH_IDEAS = [
  'un look de lluvia / día gris',
  'algo más casual para estar en casa',
  'un outfit de noche / salida',
  'ropa cómoda de mañana',
  'un estilo distinto al que ya tienes de mí'
]

export function shouldProposeWardrobeWish(opts: {
  conversationInitiativeEnabled?: boolean
  lastWishAt?: number
  galleryCount: number
  relationshipStage?: RelationshipStageHint | null
  now?: number
  hasOtherInitiativeText?: boolean
}): { ok: boolean; reason: string } {
  if (opts.conversationInitiativeEnabled === false) return { ok: false, reason: 'disabled' }
  if (opts.hasOtherInitiativeText) return { ok: false, reason: 'defer' }
  const stage = String(opts.relationshipStage || 'stranger').toLowerCase()
  if (stage === 'stranger' || stage === 'acquaintance') return { ok: false, reason: 'stage' }
  const now = opts.now ?? Date.now()
  if (opts.lastWishAt && now - opts.lastWishAt < VISUAL_WISH_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown' }
  }
  // Soft cap: enough looks already — prefer other initiative types
  if ((opts.galleryCount || 0) >= 16) return { ok: false, reason: 'gallery_full' }
  return { ok: true, reason: 'ok' }
}

export function pickWardrobeWishIdea(recent?: string[]): string {
  const pool = WISH_IDEAS.filter(
    (w) => !(recent || []).some((r) => r && w.includes(r.slice(0, 12)))
  )
  const list = pool.length ? pool : WISH_IDEAS
  return list[Math.floor(Math.random() * list.length)]
}

export function buildVisualWishMessage(opts: {
  characterName?: string
  wish: string
  dayPart?: DayPart
}): string {
  const when =
    opts.dayPart === 'morning'
      ? 'para las mañanas'
      : opts.dayPart === 'evening' || opts.dayPart === 'night'
        ? 'para la noche'
        : ''
  return (
    `Oye… me gustaría tener ${opts.wish}${when ? ` ${when}` : ''} en el guardarropa. ` +
    `Cuando tengas una foto así (o la generemos más adelante), la añadimos juntos. ¿Te animas?`
  )
}

/** Resolve optional weather from settings-like bag (city only → no invent) */
export function weatherHintFromSettings(settings: {
  weatherSummary?: string
  weatherTempC?: number
  weatherCondition?: string
  userCity?: string
} | null | undefined): WeatherHint | null {
  if (!settings) return null
  if (
    !settings.weatherSummary &&
    settings.weatherTempC == null &&
    !settings.weatherCondition
  ) {
    return null
  }
  return {
    summary: settings.weatherSummary,
    tempC: settings.weatherTempC,
    condition: settings.weatherCondition
  }
}
