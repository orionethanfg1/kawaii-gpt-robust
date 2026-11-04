/**
 * C0–C3 wardrobe classification tests
 */
import { describe, it, expect } from 'vitest'
import {
  validateWardrobeUpload,
  classifyWardrobeHeuristic,
  parseWardrobeClassifyJson,
  detectWardrobeGiftIntent,
  isSafeForPrimary,
  canEnterAvatarWardrobe,
  approveClassifiedToWardrobe,
  filterGalleryByKind,
  needsUserKindConfirm,
  kindToRole,
  WARDROBE_UPLOAD
} from './wardrobe-classify'

describe('C0 upload limits', () => {
  it('rejects non-image mime', () => {
    const v = validateWardrobeUpload({ mimeType: 'application/pdf', fileName: 'x.pdf' })
    expect(v.ok).toBe(false)
  })
  it('accepts jpeg/png/webp', () => {
    expect(validateWardrobeUpload({ mimeType: 'image/jpeg' }).ok).toBe(true)
    expect(validateWardrobeUpload({ mimeType: 'image/png' }).ok).toBe(true)
    expect(validateWardrobeUpload({ mimeType: 'image/webp' }).ok).toBe(true)
  })
  it('rejects oversize', () => {
    const v = validateWardrobeUpload({
      mimeType: 'image/png',
      byteLength: WARDROBE_UPLOAD.maxBytes + 1
    })
    expect(v.ok).toBe(false)
  })
})

describe('C1 heuristic classify', () => {
  it('detects garment from text', () => {
    const c = classifyWardrobeHeuristic({ userText: 'mira este vestido en la percha' })
    expect(c.kind).toBe('garment')
    expect(c.safeForPrimary).toBe(false)
    expect(c.safeForWardrobe).toBe(true)
  })
  it('detects accessory', () => {
    const c = classifyWardrobeHeuristic({ userText: 'te compré este anillo' })
    expect(c.kind).toBe('accessory')
    expect(isSafeForPrimary(c.kind)).toBe(false)
  })
  it('detects scene', () => {
    const c = classifyWardrobeHeuristic({ userText: 'fondo de playa al atardecer' })
    expect(c.kind).toBe('scene')
  })
  it('detects full look', () => {
    const c = classifyWardrobeHeuristic({ userText: 'tu look completo cuerpo entero' })
    expect(c.kind).toBe('full_look')
    expect(isSafeForPrimary(c.kind)).toBe(true)
  })
  it('parse VLM json', () => {
    const c = parseWardrobeClassifyJson(
      '```json\n{"kind":"garment","confidence":0.9,"suggested_tags":["dress"],"has_person":false}\n```'
    )
    expect(c?.kind).toBe('garment')
    expect(c?.confidence).toBe(0.9)
    expect(c?.source).toBe('vlm')
  })
  it('needs confirm when unknown', () => {
    const c = classifyWardrobeHeuristic({ userText: 'asdf' })
    expect(c.kind).toBe('unknown')
    expect(needsUserKindConfirm(c)).toBe(true)
  })
})

describe('C3 gift intent', () => {
  it('detects gift phrases', () => {
    expect(detectWardrobeGiftIntent('mira te compré esto para ti').isGift).toBe(true)
    expect(detectWardrobeGiftIntent('mira lo que tengo para ti').isGift).toBe(true)
    expect(detectWardrobeGiftIntent('hola cómo estás').isGift).toBe(false)
  })
  it('detects try-on', () => {
    expect(detectWardrobeGiftIntent('ponte esto').wantsTryOn).toBe(true)
  })
})

describe('C2/C3 approve by kind', () => {
  it('does not set primary for garment', () => {
    const cls = classifyWardrobeHeuristic({ userText: 'vestido negro flat lay' })
    const patch = approveClassifiedToWardrobe(
      { visualGallery: [], visualImageUrl: 'data:image/png;base64,OLD' },
      {
        dataUrl: 'data:image/png;base64,NEW',
        classification: cls,
        setAsPrimary: true,
        giftFromUser: true,
        source: 'chat_gift'
      }
    )
    expect(patch.visualImageUrl).toBe('data:image/png;base64,OLD')
    expect(patch.visualGallery.length).toBe(1)
    expect(patch.visualGallery[0].tags?.some((t) => t === 'kind:garment' || t.startsWith('kind:'))).toBe(
      true
    )
    expect(patch.visualGallery[0].tags?.includes('gift')).toBe(true)
  })
  it('sets primary for full_look when requested', () => {
    const cls = {
      kind: 'full_look' as const,
      confidence: 0.8,
      suggestedTags: ['full_look'],
      safeForWardrobe: true,
      safeForPrimary: true,
      source: 'user' as const
    }
    const patch = approveClassifiedToWardrobe(
      { visualGallery: [] },
      {
        dataUrl: 'data:image/png;base64,LOOK',
        classification: cls,
        setAsPrimary: true
      }
    )
    expect(patch.visualImageUrl).toBe('data:image/png;base64,LOOK')
  })
  it('rejects user_other', () => {
    const patch = approveClassifiedToWardrobe(
      { visualGallery: [] },
      {
        dataUrl: 'data:image/png;base64,X',
        classification: {
          kind: 'user_other',
          confidence: 0.9,
          suggestedTags: [],
          safeForWardrobe: false,
          safeForPrimary: false,
          source: 'user'
        }
      }
    )
    expect(patch.rejected).toBe('kind_not_for_avatar_wardrobe')
    expect(patch.visualGallery.length).toBe(0)
  })
  it('filterGalleryByKind', () => {
    const gal = [
      { id: '1', dataUrl: 'a', role: 'face' as const, tags: ['kind:portrait_identity'] },
      { id: '2', dataUrl: 'b', role: 'outfit' as const, tags: ['kind:garment'] },
      { id: '3', dataUrl: 'c', role: 'scene' as const, tags: ['kind:scene'] }
    ]
    expect(filterGalleryByKind(gal, 'garment').map((g) => g.id)).toEqual(['2'])
    expect(filterGalleryByKind(gal, 'scene').map((g) => g.id)).toEqual(['3'])
    expect(filterGalleryByKind(gal, 'all').length).toBe(3)
  })
  it('kindToRole mapping', () => {
    expect(kindToRole('portrait_identity')).toBe('face')
    expect(kindToRole('scene')).toBe('scene')
    expect(kindToRole('garment')).toBe('outfit')
  })
  it('canEnterAvatarWardrobe', () => {
    expect(canEnterAvatarWardrobe('garment')).toBe(true)
    expect(canEnterAvatarWardrobe('user_other')).toBe(false)
  })
})
