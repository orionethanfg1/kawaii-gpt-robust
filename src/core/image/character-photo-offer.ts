/**
 * Pending wardrobe / character-photo offer after a user-upload vision turn.
 * Survives Continuar / Regenerar until clear or stale.
 */

export type WardrobeOfferClassification = {
  kind?: string
  tags?: string[]
  confidence?: number
  safeForPrimary?: boolean
  safeForWardrobe?: boolean
  role?: string
}

export type CharacterPhotoOffer = {
  convId: string
  /** Prefer when available (chips / save). */
  dataUrl?: string
  /** Durable ref when dataUrl was purged from chat history. */
  filePath?: string
  title?: string
  classification?: WardrobeOfferClassification
  createdAt: number
}

const pending = new Map<string, CharacterPhotoOffer>()
const STALE_MS = 60 * 60 * 1000

export function setPendingCharacterPhotoOffer(
  offer: Omit<CharacterPhotoOffer, 'createdAt'>
): void {
  if (!offer.convId) return
  const hasData = Boolean(offer.dataUrl?.startsWith('data:image/'))
  const hasPath = Boolean(offer.filePath && String(offer.filePath).trim())
  if (!hasData && !hasPath) return
  pending.set(offer.convId, { ...offer, createdAt: Date.now() })
}

function isStale(o: CharacterPhotoOffer): boolean {
  return Date.now() - o.createdAt > STALE_MS
}

export function peekPendingCharacterPhotoOffer(convId: string): CharacterPhotoOffer | null {
  const o = pending.get(convId)
  if (!o) return null
  if (isStale(o)) {
    pending.delete(convId)
    return null
  }
  return o
}

export function takePendingCharacterPhotoOffer(convId: string): CharacterPhotoOffer | null {
  const o = peekPendingCharacterPhotoOffer(convId)
  if (!o) return null
  pending.delete(convId)
  return o
}

export function clearPendingCharacterPhotoOffer(convId: string): void {
  pending.delete(convId)
}

/** Build chip meta from offer (dataUrl and/or filePath). */
export function wardrobeOfferToMeta(offer: CharacterPhotoOffer): Record<string, unknown> {
  const cls = offer.classification
  return {
    kind: 'wardrobe-propose',
    wardrobeOfferMode: 'user_character_photo',
    wardrobeDataUrl: offer.dataUrl?.startsWith('data:image/') ? offer.dataUrl : undefined,
    wardrobeFilePath: offer.filePath || undefined,
    wardrobeTitle: offer.title || 'Foto compartida',
    wardrobeKind: cls?.kind,
    wardrobeTags: cls?.tags,
    wardrobeRole: cls?.role,
    wardrobeSafePrimary: cls?.safeForPrimary !== false,
    wardrobeConfidence: cls?.confidence
  }
}
