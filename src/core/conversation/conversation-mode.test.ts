import { describe, expect, it } from 'vitest'
import {
  classifyConversationMode,
  modeToScenePhase,
  buildConversationModePromptRules
} from './conversation-mode'

describe('conversation-mode', () => {
  it('relational trust is not scene', () => {
    const r = classifyConversationMode({
      userText:
        'Bueno princesa, en verdad me has ayudado mucho. Con confianza puedes contarme cualquier duda sobre mí.'
    })
    expect(r.mode).toBe('relational')
    expect(modeToScenePhase(r.mode)).toBe('idle')
  })

  it('explicit physical invite is scene', () => {
    const r = classifyConversationMode({ userText: 'Acércate y bésame, quiero sentirte.' })
    expect(r.mode).toBe('scene')
    expect(modeToScenePhase(r.mode)).toBe('scene_active')
  })

  it('te quiero alone is romantic_soft not scene', () => {
    const r = classifyConversationMode({ userText: 'Te quiero mucho, mi amor.' })
    expect(r.mode).toBe('romantic_soft')
  })

  it('exit leaves scene', () => {
    const r = classifyConversationMode({
      userText: 'Cambiemos de tema un rato',
      priorPhase: 'scene_active'
    })
    expect(r.mode).toBe('casual')
  })

  it('prompt never says juego de rol as instruction to roleplay', () => {
    for (const m of ['casual', 'relational', 'romantic_soft', 'scene'] as const) {
      const p = buildConversationModePromptRules({ mode: m })
      expect(p.toLowerCase()).toMatch(/conversaci[oó]n natural/)
      expect(p).toMatch(/no un "juego de rol"/i)
    }
  })
})
