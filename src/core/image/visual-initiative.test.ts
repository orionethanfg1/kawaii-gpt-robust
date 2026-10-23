import { describe, it, expect } from 'vitest'
import {
  shouldProposeVisualChange,
  pickVisualProposeCandidate,
  maxIntimacyForStage,
  VISUAL_INITIATIVE_COOLDOWN_MS,
  resolveDayPart,
  detectChatLookContext,
  buildVisualProposeMessage
} from './visual-initiative'
import { approveImageToWardrobe, setChatPrimaryFromWardrobe } from './wardrobe-approve'

describe('visual initiative C4', () => {
  it('blocks stranger and low gallery', () => {
    expect(
      shouldProposeVisualChange({
        galleryCount: 1,
        conversationInitiativeEnabled: true,
        relationshipStage: 'familiar',
        forceEligible: true
      }).ok
    ).toBe(false)
    expect(
      shouldProposeVisualChange({
        galleryCount: 3,
        conversationInitiativeEnabled: true,
        relationshipStage: 'stranger',
        forceEligible: true
      }).ok
    ).toBe(false)
  })

  it('blocks professional mode and intimate scene', () => {
    expect(
      shouldProposeVisualChange({
        galleryCount: 4,
        conversationInitiativeEnabled: true,
        relationshipStage: 'familiar',
        relationshipRole: 'asistente profesional',
        forceEligible: true
      }).reason
    ).toBe('professional_mode')
    expect(
      shouldProposeVisualChange({
        galleryCount: 4,
        conversationInitiativeEnabled: true,
        relationshipStage: 'intimate',
        scenePhase: 'scene_active',
        forceEligible: true
      }).reason
    ).toBe('intimate_scene_busy')
  })

  it('respects cooldown and reject', () => {
    const now = 1_000_000
    expect(
      shouldProposeVisualChange({
        galleryCount: 4,
        conversationInitiativeEnabled: true,
        relationshipStage: 'familiar',
        lastProposeAt: now - 1000,
        now,
        forceEligible: true
      }).reason
    ).toBe('cooldown')
    expect(
      shouldProposeVisualChange({
        galleryCount: 4,
        conversationInitiativeEnabled: true,
        relationshipStage: 'familiar',
        lastRejectAt: now - 1000,
        now,
        forceEligible: true
      }).reason
    ).toBe('recent_reject')
    expect(VISUAL_INITIATIVE_COOLDOWN_MS).toBeGreaterThan(60_000)
  })

  it('picks full_look not pure scene for primary', () => {
    const c = pickVisualProposeCandidate({
      character: {
        visualImageUrl: 'data:image/png;base64,a',
        visualGallery: [
          { id: '1', dataUrl: 'data:image/png;base64,a', label: 'main', role: 'face' },
          {
            id: '2',
            dataUrl: 'data:image/png;base64,b',
            label: 'playa vacía',
            role: 'scene',
            tags: ['kind:scene', 'scene:playa']
          },
          {
            id: '3',
            dataUrl: 'data:image/png;base64,c',
            label: 'vestido noche',
            role: 'full',
            tags: ['kind:full_look', 'outfit:noche']
          }
        ]
      },
      relationshipStage: 'familiar',
      forceMode: 'coherent',
      chatBlob: 'vamos a salir esta noche elegante'
    })
    expect(c?.item.dataUrl).toContain('c')
    expect(c?.mode).toBe('coherent')
    expect(c?.whyKind).toBeTruthy()
  })

  it('detectChatLookContext and dayPart', () => {
    expect(detectChatLookContext('qué vestido te pones para la cita').hit).toBe(true)
    expect(['dawn', 'morning', 'afternoon', 'evening', 'night']).toContain(resolveDayPart())
  })

  it('message includes why', () => {
    const msg = buildVisualProposeMessage({
      candidate: {
        item: {
          id: 'x',
          dataUrl: 'data:image/png;base64,z',
          title: 'Look rojo',
          tags: ['kind:full_look'],
          role: 'full',
          intimacy: 0,
          source: 'user'
        },
        reason: '«Look rojo»',
        whyKind: 'spontaneous',
        mode: 'spontaneous',
        whyText: 'quería lucir así para ti'
      }
    })
    expect(msg.toLowerCase()).toMatch(/look rojo|lucir|foto/)
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
