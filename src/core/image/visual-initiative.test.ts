import { describe, it, expect } from 'vitest'
import {
  shouldProposeVisualChange,
  pickVisualProposeCandidate,
  maxIntimacyForStage,
  VISUAL_INITIATIVE_COOLDOWN_MS
} from './visual-initiative'
import { approveImageToWardrobe, setChatPrimaryFromWardrobe } from './wardrobe-approve'

describe('visual initiative W4', () => {
  it('blocks stranger and low gallery', () => {
    expect(
      shouldProposeVisualChange({
        galleryCount: 1,
        conversationInitiativeEnabled: true,
        relationshipStage: 'familiar'
      }).ok
    ).toBe(false)
    expect(
      shouldProposeVisualChange({
        galleryCount: 3,
        conversationInitiativeEnabled: true,
        relationshipStage: 'stranger'
      }).ok
    ).toBe(false)
  })

  it('respects cooldown', () => {
    const now = 1_000_000
    expect(
      shouldProposeVisualChange({
        galleryCount: 4,
        conversationInitiativeEnabled: true,
        relationshipStage: 'familiar',
        lastProposeAt: now - 1000,
        now
      }).reason
    ).toBe('cooldown')
    expect(VISUAL_INITIATIVE_COOLDOWN_MS).toBeGreaterThan(60_000)
  })

  it('picks non-primary look', () => {
    const c = pickVisualProposeCandidate({
      character: {
        visualImageUrl: 'data:image/png;base64,a',
        visualGallery: [
          { id: '1', dataUrl: 'data:image/png;base64,a', label: 'main', role: 'face' },
          {
            id: '2',
            dataUrl: 'data:image/png;base64,b',
            label: 'playa',
            role: 'scene',
            tags: ['scene:playa']
          }
        ]
      },
      relationshipStage: 'familiar'
    })
    expect(c?.item.dataUrl).toContain('b')
  })

  it('maxIntimacy scales with stage', () => {
    expect(maxIntimacyForStage('stranger')).toBe(0)
    expect(maxIntimacyForStage('intimate')).toBe(2)
  })
})

describe('wardrobe approve W5', () => {
  it('appends generated look without forcing primary', () => {
    const patch = approveImageToWardrobe(
      {
        visualImageUrl: 'data:image/png;base64,main',
        visualGallery: []
      },
      {
        dataUrl: 'data:image/png;base64,gen',
        title: 'Look noche',
        tags: ['scene:noche'],
        source: 'generated'
      }
    )
    expect(patch.visualGallery.length).toBe(1)
    expect(patch.visualImageUrl).toBe('data:image/png;base64,main')
    expect(patch.visualGallery[0].label).toMatch(/noche/i)
  })

  it('setChatPrimaryFromWardrobe updates url only', () => {
    const p = setChatPrimaryFromWardrobe(
      { visualImageUrl: 'data:image/png;base64,a', visualGallery: [] },
      'data:image/png;base64,b'
    )
    expect(p.visualImageUrl).toBe('data:image/png;base64,b')
  })
})
