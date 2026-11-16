
import { describe, it, expect } from 'vitest'
import {
  isNearDefaultWipe,
  mergeSettingsPreferRecent,
  scoreSettings
} from './settings-backup'
import { DEFAULT_SETTINGS } from '../types/settings'

describe('settings recovery prefers recent user edits', () => {
  it('custom personality is not a wipe', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      character: {
        ...DEFAULT_SETTINGS.character,
        personality: 'Soy una compañera atenta, cálida y directa con Nahum en el día a día.'
      },
      lastUserEditAt: Date.now()
    }
    expect(isNearDefaultWipe(s)).toBe(false)
  })

  it('merge keeps newer personality over richer old gallery snapshot', () => {
    const current = {
      ...DEFAULT_SETTINGS,
      lastUserEditAt: 2_000,
      character: {
        ...DEFAULT_SETTINGS.character,
        name: 'Niamh',
        personality: 'Nueva personalidad editada por el usuario en 2026.'
      }
    }
    const candidate = {
      ...DEFAULT_SETTINGS,
      lastUserEditAt: 1_000,
      character: {
        ...DEFAULT_SETTINGS.character,
        name: 'Niamh',
        personality: 'Personalidad vieja del backup.',
        visualGallery: [
          { id: '1', filePath: '/x/a.png', label: 'a' },
          { id: '2', filePath: '/x/b.png', label: 'b' }
        ],
        visualImageUrl: '/x/a.png'
      }
    }
    const m = mergeSettingsPreferRecent(current, candidate, { candidateAt: 1_000 })
    expect(m.character.personality).toMatch(/Nueva personalidad/)
    expect((m.character.visualGallery || []).length).toBeGreaterThan(0)
  })
})
