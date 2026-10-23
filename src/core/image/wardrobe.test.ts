import { describe, it, expect } from 'vitest'
import {
  migrateGalleryItem,
  enrichVisualGallery,
  pickWardrobeRefs,
  galleryNeedsEnrichment
} from './wardrobe'

describe('wardrobe W2/W3', () => {
  it('migrates legacy label into role and tags', () => {
    const w = migrateGalleryItem({
      id: '1',
      dataUrl: 'data:image/png;base64,aa',
      label: 'vestido rojo playa'
    })
    expect(w?.title).toMatch(/vestido/i)
    expect(w?.tags.some((t) => /playa|vestido|outfit/i.test(t))).toBe(true)
  })

  it('enrich is idempotent on roles', () => {
    const g = enrichVisualGallery(
      [{ id: 'a', dataUrl: 'data:image/png;base64,x', label: 'face portrait', role: 'face', tags: ['framing:face'] }],
      'data:image/png;base64,x'
    )
    expect(g[0].role).toBe('face')
    expect(galleryNeedsEnrichment(g)).toBe(false)
  })

  it('picks style ref when prompt mentions playa', () => {
    const r = pickWardrobeRefs({
      character: {
        visualImageUrl: 'data:image/png;base64,face',
        visualGallery: [
          {
            id: 'f',
            dataUrl: 'data:image/png;base64,face',
            label: 'retrato',
            role: 'face',
            tags: ['framing:face']
          },
          {
            id: 's',
            dataUrl: 'data:image/png;base64,beach',
            label: 'en la playa',
            role: 'scene',
            tags: ['scene:playa']
          }
        ]
      },
      promptHint: 'hazme una foto tuya en la playa'
    })
    expect(r.faceUrl).toContain('face')
    expect(r.styleUrls.some((u) => u.includes('beach'))).toBe(true)
    expect(r.referenceUrls[0]).toBe(r.faceUrl)
  })

  it('respects maxIntimacy gate', () => {
    const r = pickWardrobeRefs({
      character: {
        visualGallery: [
          {
            id: 'i',
            dataUrl: 'data:image/png;base64,x',
            label: 'íntimo',
            role: 'outfit',
            tags: ['outfit:casual'],
            intimacy: 3
          }
        ]
      },
      maxIntimacy: 1,
      promptHint: 'casual'
    })
    expect(r.styleUrls.length).toBe(0)
  })
})
