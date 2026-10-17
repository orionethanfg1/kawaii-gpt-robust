/**
 * W4 — Visual wardrobe initiative gates (pure, no Electron).
 * Propose changing chat primary; never mutate without UI confirm.
 */

import {
  enrichVisualGallery,
  migrateGalleryItem,
  type CharacterWardrobeSource,
  type LegacyGalleryItem,
  type WardrobeItem
} from './wardrobe'

export type RelationshipStageHint =
  | 'stranger'
  | 'acquaintance'
  | 'familiar'
  | 'intimate'
  | string

export function maxIntimacyForStage(stage?: RelationshipStageHint | null): number {
  const s = String(stage || '').toLowerCase()
  if (s === 'intimate') return 2
  if (s === 'familiar') return 1
  if (s === 'acquaintance') return 0
  return 0
}

export type VisualProposeCandidate = {
  item: WardrobeItem
  reason: string
}

/**
 * Cooldown between visual proposals (app-driven, not the LLM).
 * 36h default — photo changes should feel rare, not a habit every session.
 */
export const VISUAL_INITIATIVE_COOLDOWN_MS = 36 * 60 * 60 * 1000

/** Soft minimum messages in the active chat before another photo proposal */
export const VISUAL_INITIATIVE_MIN_MESSAGES = 14

export function shouldProposeVisualChange(opts: {
  enabled?: boolean
  galleryCount: number
  lastProposeAt?: number
  now?: number
  /** Need some bond before suggesting outfit changes */
  relationshipStage?: RelationshipStageHint | null
  /** Initiative must be on */
  conversationInitiativeEnabled?: boolean
  /**
   * Only propose when we do NOT already have an LLM initiative line.
   * Replacing a warm message with "cambio de foto" felt robotic.
   */
  hasOtherInitiativeText?: boolean
  /** Messages in current conversation (spam guard) */
  messageCount?: number
}): { ok: boolean; reason: string } {
  if (opts.conversationInitiativeEnabled === false || opts.enabled === false) {
    return { ok: false, reason: 'disabled' }
  }
  if (opts.hasOtherInitiativeText) {
    return { ok: false, reason: 'defer_to_llm_text' }
  }
  if ((opts.galleryCount || 0) < 2) {
    return { ok: false, reason: 'need_2_plus_looks' }
  }
  const stage = String(opts.relationshipStage || 'stranger').toLowerCase()
  // Only when there is some bond (not stranger / acquaintance early)
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
  // Soft random gate: even when eligible, only ~12% of idle ticks
  if (Math.random() > 0.12) {
    return { ok: false, reason: 'random_skip' }
  }
  return { ok: true, reason: 'ok' }
}

/**
 * Pick a non-primary look for a gentle proposal.
 * Prefers outfit/scene with tags; respects intimacy vs stage.
 */
export function pickVisualProposeCandidate(opts: {
  character?: CharacterWardrobeSource | null
  relationshipStage?: RelationshipStageHint | null
  recentPrimaryUrl?: string
}): VisualProposeCandidate | null {
  const char = opts.character
  if (!char) return null
  const maxInt = maxIntimacyForStage(opts.relationshipStage)
  const primary = (opts.recentPrimaryUrl || char.visualImageUrl || '').trim()
  const enriched = enrichVisualGallery(char.visualGallery, char.visualImageUrl)
  const items: WardrobeItem[] = []
  for (let i = 0; i < enriched.length; i++) {
    const w = migrateGalleryItem(enriched[i] as LegacyGalleryItem, i)
    if (w) items.push(w)
  }
  const pool = items.filter(
    (it) =>
      it.dataUrl !== primary &&
      it.intimacy <= maxInt &&
      (it.role === 'outfit' ||
        it.role === 'scene' ||
        it.role === 'full' ||
        it.role === 'half' ||
        (it.tags && it.tags.length > 0))
  )
  if (!pool.length) {
    const any = items.find((it) => it.dataUrl !== primary && it.intimacy <= maxInt)
    if (!any) return null
    return {
      item: any,
      reason: 'alternativa de galería'
    }
  }
  // Prefer tagged / non-face
  pool.sort((a, b) => {
    const sa = (a.role === 'face' ? -2 : 2) + (a.tags?.length || 0)
    const sb = (b.role === 'face' ? -2 : 2) + (b.tags?.length || 0)
    return sb - sa
  })
  const pick = pool[Math.floor(Math.random() * Math.min(3, pool.length))]
  const tagHint = pick.tags?.[0] ? ` (${pick.tags[0]})` : ''
  return {
    item: pick,
    reason: `look «${pick.title}»${tagHint}`
  }
}

export function buildVisualProposeMessage(opts: {
  characterName?: string
  candidate: VisualProposeCandidate
}): string {
  const name = opts.characterName || 'Yo'
  const title = opts.candidate.item.title || 'este look'
  return (
    `Oye… ¿te parece si cambio mi foto del chat a «${title}»? ` +
    `Es de mi guardarropa (${opts.candidate.reason}). ` +
    `Tú decides: puedo dejarla como principal o seguir como estoy.`
  )
}


/** Wishes for new looks — text only, no image generation. */
export const VISUAL_WISH_COOLDOWN_MS = 6 * 60 * 60 * 1000

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
}): { ok: boolean; reason: string } {
  if (opts.conversationInitiativeEnabled === false) return { ok: false, reason: 'disabled' }
  const stage = String(opts.relationshipStage || 'stranger').toLowerCase()
  if (stage === 'stranger') return { ok: false, reason: 'stage_stranger' }
  const now = opts.now ?? Date.now()
  if (opts.lastWishAt && now - opts.lastWishAt < VISUAL_WISH_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown' }
  }
  // More useful when wardrobe is still thin
  if ((opts.galleryCount || 0) >= 10) return { ok: false, reason: 'gallery_full' }
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
}): string {
  const name = opts.characterName || 'Yo'
  return (
    `Oye… me gustaría tener ${opts.wish} en mi guardarropa para poder cambiármelo cuando quieras. ` +
    `Cuando tengas una foto mía así (o la generemos más adelante), la añadimos juntos. ` +
    `¿Te animas a buscarme o subirme algo de ese estilo?`
  )
}
