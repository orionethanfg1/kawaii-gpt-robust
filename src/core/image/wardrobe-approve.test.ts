import { describe, expect, it } from 'vitest'
import { approveImageToWardrobe } from './wardrobe-approve'

describe('approveImageToWardrobe dedupe', () => {
  it('merges same filePath instead of duplicating', () => {
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const path = 'C:/Users/test/AppData/Roaming/kawaii-gpt-robust/wardrobe/look1.png'
    const first = approveImageToWardrobe(
      { visualGallery: [] },
      { dataUrl, filePath: path, title: 'Look A', tags: ['role:outfit'], role: 'outfit' }
    )
    expect(first.visualGallery.length).toBe(1)
    const second = approveImageToWardrobe(
      { visualGallery: first.visualGallery },
      { dataUrl, filePath: path, title: 'Look A2', tags: ['kind:full_look'], role: 'outfit' }
    )
    expect(second.visualGallery.length).toBe(1)
    expect(second.visualGallery[0].tags?.join(' ')).toMatch(/full_look|outfit/)
  })
})
