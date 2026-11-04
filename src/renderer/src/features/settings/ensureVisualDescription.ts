/**
 * Silently fill character.visualDescription from avatar when missing.
 * Runs in background; never blocks the UI.
 */

import { describeAvatarFromDataUrl } from '@core/character/avatar-describe'
import { effectiveVisualDescription } from '@core/character/profile'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

let inFlight = false
let lastAttempt = 0

export async function ensureVisualDescriptionFromAvatar(opts?: {
  force?: boolean
}): Promise<{ ok: boolean; description?: string; source?: string }> {
  if (inFlight) return { ok: false }
  const now = Date.now()
  if (!opts?.force && now - lastAttempt < 15_000) return { ok: false }
  lastAttempt = now

  const s = useSettingsStore.getState().settings
  const char = s.character
  const avatar = (char?.visualImageUrl || '').trim()
  if (!avatar.startsWith('data:') && !avatar.startsWith('http')) {
    return { ok: false }
  }
  const existing = effectiveVisualDescription(char || { name: '', tagline: '', personality: '', style: '', visualEmoji: '', traits: [] })
  if (existing && !opts?.force) return { ok: true, description: existing }

  inFlight = true
  try {
    const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
    const key = keys.openrouter || keys.main || ''
    const res = await describeAvatarFromDataUrl(avatar, {
      apiKey: key,
      characterName: char?.name || 'personaje',
      ollamaBaseUrl: s.localBaseUrl || 'http://127.0.0.1:11434'
    })
    const desc = (res.description || '').trim()
    if (!desc) return { ok: false, source: res.source }
    useSettingsStore.getState().update({
      character: {
        ...useSettingsStore.getState().settings.character,
        visualDescription: desc,
        visualFromAvatar: true
      }
    })
    return { ok: true, description: desc, source: res.source }
  } catch {
    return { ok: false }
  } finally {
    inFlight = false
  }
}
