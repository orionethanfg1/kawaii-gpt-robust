import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Settings, DEFAULT_SETTINGS, SettingsSchema } from '../../types/settings'
import { resolveModelId, resolveModelIdForProvider } from '@core/models/free-cloud-catalog'
import {
  autoRecoverIfWiped,
  maybeBackupSettings
} from '../settings-backup'
import {
  readIdentityCharacter,
  syncCharacterFromSettings,
  pickRicherCharacter
} from './characterStore'

interface SettingsState {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  reset: () => void
}

function normalizeLoadedSettings(s: Settings): Settings {
  return {
    ...s,
    cloudModel: resolveModelId(s.cloudModel || 'openrouter/free'),
    preferFreeTiers: s.preferFreeTiers !== false,
    cloudAutoRotate: s.cloudAutoRotate !== false,
    cloudSlots: (s.cloudSlots || []).map((slot) => ({
      ...slot,
      model: resolveModelIdForProvider(slot.id, slot.model || ''),
      enabled: typeof slot.enabled === 'boolean' ? slot.enabled : slot.id === 'openrouter'
    }))
  }
}

/**
 * Never throw away user data. Prefer imperfect merge over DEFAULT_SETTINGS wipe.
 */
function safeParseSettings(raw: unknown): Settings {
  if (raw == null) return DEFAULT_SETTINGS

  const direct = SettingsSchema.safeParse(raw)
  if (direct.success) return normalizeLoadedSettings(direct.data)

  if (typeof raw !== 'object') return DEFAULT_SETTINGS

  const r = raw as Record<string, unknown>
  const charRaw =
    r.character && typeof r.character === 'object'
      ? (r.character as Record<string, unknown>)
      : {}
  const slotsRaw = r.cloudSlots

  // Preserve gallery / avatar even if schema is picky
  const gallery = Array.isArray(charRaw.visualGallery)
    ? (charRaw.visualGallery as unknown[]).filter(
        (g) => g && typeof g === 'object' && typeof (g as { dataUrl?: string }).dataUrl === 'string'
      ).slice(0, 12)
    : undefined

  const visualDescription = (() => {
    const v =
      typeof charRaw.visualDescription === 'string' ? charRaw.visualDescription.trim() : ''
    if (!v) return charRaw.visualDescription
    if (/aspecto definido por el avatar/i.test(v) || /rasgos coherentes con esa imagen/i.test(v)) {
      return ''
    }
    return v
  })()

  const merged: Record<string, unknown> = {
    ...DEFAULT_SETTINGS,
    ...r,
    character: {
      ...DEFAULT_SETTINGS.character,
      ...charRaw,
      name:
        typeof charRaw.name === 'string' && charRaw.name.trim()
          ? charRaw.name.trim()
          : DEFAULT_SETTINGS.character.name,
      traits: Array.isArray(charRaw.traits)
        ? (charRaw.traits as string[])
        : DEFAULT_SETTINGS.character.traits,
      relationshipRole:
        typeof charRaw.relationshipRole === 'string'
          ? charRaw.relationshipRole
          : DEFAULT_SETTINGS.character.relationshipRole,
      visualDescription,
      visualFromAvatar:
        typeof charRaw.visualFromAvatar === 'boolean'
          ? charRaw.visualFromAvatar
          : DEFAULT_SETTINGS.character.visualFromAvatar,
      visualImageUrl:
        typeof charRaw.visualImageUrl === 'string'
          ? charRaw.visualImageUrl
          : DEFAULT_SETTINGS.character.visualImageUrl,
      ...(gallery ? { visualGallery: gallery } : {})
    },
    // Keep user localBaseUrl even if not a perfect URL
    localBaseUrl:
      typeof r.localBaseUrl === 'string' && r.localBaseUrl.trim()
        ? r.localBaseUrl.trim()
        : DEFAULT_SETTINGS.localBaseUrl,
    localModel: typeof r.localModel === 'string' ? r.localModel : DEFAULT_SETTINGS.localModel,
    cloudSlots:
      Array.isArray(slotsRaw) && slotsRaw.length > 0 ? slotsRaw : DEFAULT_SETTINGS.cloudSlots
  }

  const second = SettingsSchema.safeParse(merged)
  if (second.success) return normalizeLoadedSettings(second.data)

  // Last resort: strip unknown keys by walking defaults — still keep character/name/model
  try {
    const soft = {
      ...DEFAULT_SETTINGS,
      ...(merged as object),
      character: {
        ...DEFAULT_SETTINGS.character,
        ...(merged.character as object)
      }
    }
    const third = SettingsSchema.safeParse(soft)
    if (third.success) return normalizeLoadedSettings(third.data)
  } catch {
    /* */
  }

  // Absolute last: return merged cast — better than wiping the user
  console.warn('[settings] schema soft-fail; preserving best-effort merge')
  return normalizeLoadedSettings({ ...DEFAULT_SETTINGS, ...merged, character: {
    ...DEFAULT_SETTINGS.character,
    ...(typeof merged.character === 'object' && merged.character ? merged.character : {})
  } } as Settings)
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      update: (patch) => {
        let saved: Settings | null = null
        set((state) => {
          const next = {
            ...state.settings,
            ...patch,
            character: patch.character
              ? {
                  ...state.settings.character,
                  ...patch.character,
                  traits: Array.isArray(patch.character.traits)
                    ? patch.character.traits
                    : state.settings.character.traits
                }
              : state.settings.character,
            cloudSlots: Array.isArray(patch.cloudSlots)
              ? patch.cloudSlots
              : state.settings.cloudSlots
          }
          const parsed = SettingsSchema.safeParse(next)
          if (parsed.success) {
            saved = parsed.data
            return { settings: parsed.data }
          }
          const soft = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...next })
          if (soft.success) {
            saved = soft.data
            return { settings: soft.data }
          }
          return { settings: state.settings }
        })
        if (saved) {
          try {
            if (saved.character) syncCharacterFromSettings(saved.character)
            maybeBackupSettings(saved)
          } catch {
            /* */
          }
        }
      },
      reset: () => set({ settings: DEFAULT_SETTINGS })
    }),
    {
      name: 'kawaii-settings-v2',
      partialize: (s) => ({ settings: s.settings }),
      onRehydrateStorage: () => (state) => {
        void (async () => {
          try {
            const { runFullSettingsRecovery } = await import('../settings-backup')
            const cur = state?.settings
            if (!cur) return
            const { settings, report } = await runFullSettingsRecovery(cur)
            if (report.recovered) {
              const { useSettingsStore } = await import('./settingsStore')
              useSettingsStore.setState({ settings })
              console.info('[settings] full recovery applied', report.source, report.notes)
            }
          } catch (e) {
            console.warn('[settings] full recovery skip', e)
          }
        })()
      },
      merge: (persisted, current) => {
        const p = persisted as { settings?: unknown } | undefined
        let raw = p?.settings
        // Recover from legacy key if v2 empty
        try {
          if (raw == null && typeof localStorage !== 'undefined') {
            const v1 = localStorage.getItem('kawaii-settings-v1')
            if (v1) {
              const parsed = JSON.parse(v1) as { state?: { settings?: unknown }; settings?: unknown }
              raw = parsed?.state?.settings ?? parsed?.settings ?? parsed
            }
          }
        } catch {
          /* */
        }
        let loaded = safeParseSettings(raw)
        try {
          const rec = autoRecoverIfWiped(loaded)
          if (rec.recovered) {
            loaded = rec.settings
            console.info(
              '[settings] auto-recovered from backup',
              rec.source || '',
              loaded.character?.name
            )
            // Re-persist recovery asynchronously
            queuePromise.resolve().then(() => {
              try {
                maybeBackupSettings(loaded)
              } catch {
                /* */
              }
            })
          }
        } catch (e) {
          console.warn('[settings] auto-recover failed', e)
        }
        // Snapshot after successful load if rich
        try {
          const idChar = readIdentityCharacter()
          loaded = {
            ...loaded,
            character: pickRicherCharacter(loaded.character, idChar)
          }
          syncCharacterFromSettings(loaded.character)
        } catch {
          /* */
        }
        try {
          maybeBackupSettings(loaded)
        } catch {
          /* */
        }
        return {
          ...current,
          settings: loaded
        }
      }
    }
  )
)
