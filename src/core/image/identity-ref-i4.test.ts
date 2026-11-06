import { describe, it, expect } from 'vitest'
import { isUsableImageRef, pickAvatarDataUrl, pickIdentityReferenceUrls } from './identity-ref'
import { migrateGalleryItem } from './wardrobe'

describe('I4 identity refs from disk', () => {
  it('isUsableImageRef accepts kawaii-file and data', () => {
    expect(isUsableImageRef('data:image/png;base64,xx')).toBe(true)
    expect(isUsableImageRef('kawaii-file:C:/Users/x/a.png')).toBe(true)
    expect(isUsableImageRef('hola')).toBe(false)
  })

  it('migrateGalleryItem keeps filePath-only items', () => {
    const w = migrateGalleryItem({ id: '1', filePath: 'C:/tmp/face.png', label: 'cara' }, 0)
    expect(w).not.toBeNull()
    expect(w!.dataUrl.startsWith('kawaii-file:')).toBe(true)
  })

  it('pickAvatarDataUrl uses filePath gallery', () => {
    const url = pickAvatarDataUrl({
      visualGallery: [{ filePath: 'D:/wardrobe/face.png', role: 'face', label: 'rostro' }]
    })
    expect(url).toBeTruthy()
    expect(isUsableImageRef(url)).toBe(true)
  })
})
