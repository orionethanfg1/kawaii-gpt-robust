import { describe, it, expect } from 'vitest'
import { looksLikeOngoingIntimateScene } from './intimacy-stage'
import { resolveLiveIntimatePhase } from './intimacy-memory'

describe('G0 intimacy chip phase', () => {
  it('detects soft romantic film as ongoing', () => {
    const texts = [
      'Mis manos en tus clavículas, tu piel clara',
      'Jadeo profundo, labios y respiración agitada, te siento cerca'
    ]
    expect(looksLikeOngoingIntimateScene(texts)).toBe(true)
  })

  it('resolveLive marks scene_active from recent soft signals', () => {
    const phase = resolveLiveIntimatePhase({
      relationship: { intimacyOpen: true, stage: 'intimate_adult' } as never,
      facts: [],
      recentTexts: [
        'Inmediatamente llevo mis manos a tus clavículas',
        'Suelto un jadeo profundo, sintiendo tu piel y tus labios'
      ],
      now: Date.now()
    })
    expect(phase).toBe('scene_active')
  })

  it('does not keep a physical-scene state when the current turn is casual', () => {
    const phase = resolveLiveIntimatePhase({
      relationship: {
        intimacyOpen: true,
        scenePhase: 'scene_active',
        lastIntimateSceneAt: Date.now() - 60_000
      } as never,
      facts: ['INTIMACY_PHASE: scene_active'],
      recentTexts: ['te deseo más fuerte dentro de mí', 'Hola, ¿cómo estás?'],
      userText: 'Hola, ¿cómo estás?'
    })
    expect(phase).toBe('open')
  })
})
