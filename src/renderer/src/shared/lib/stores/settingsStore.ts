import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Settings, DEFAULT_SETTINGS, SettingsSchema } from '../../types/settings'
import { resolveModelId, resolveModelIdForProvider } from '@core/models/free-cloud-catalog'

interface SettingsState {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  reset: () => void
}

function safeParseSettings(raw: unknown): Settings {
  // Full parse first
  const direct = SettingsSchema.safeParse(raw)
  if (direct.success) {
    const s = direct.data
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

  // Merge with defaults (handles upgrades from older persisted shapes)
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    const charRaw =
      r.character && typeof r.character === 'object'
        ? (r.character as Record<string, unknown>)
        : {}
    const slotsRaw = r.cloudSlots
    const merged = {
      ...DEFAULT_SETTINGS,
      ...r,
      character: {
        ...DEFAULT_SETTINGS.character,
        ...charRaw,
        traits: Array.isArray(charRaw.traits)
          ? (charRaw.traits as string[])
          : DEFAULT_SETTINGS.character.traits,
        relationshipRole:
          typeof charRaw.relationshipRole === 'string'
            ? charRaw.relationshipRole
            : DEFAULT_SETTINGS.character.relationshipRole,
        visualDescription: (() => {
          const raw =
            typeof charRaw.visualDescription === 'string'
              ? charRaw.visualDescription.trim()
              : ''
          // Drop legacy weak fallback that made the chat invent nothing useful
          if (
            !raw ||
            /aspecto definido por el avatar/i.test(raw) ||
            /rasgos coherentes con esa imagen/i.test(raw)
          ) {
            return ''
          }
          return raw
        })(),
        visualFromAvatar:
          typeof charRaw.visualFromAvatar === 'boolean'
            ? charRaw.visualFromAvatar
            : DEFAULT_SETTINGS.character.visualFromAvatar
      },
      cloudSlots: Array.isArray(slotsRaw) && slotsRaw.length > 0
        ? slotsRaw
        : DEFAULT_SETTINGS.cloudSlots
    }
    const second = SettingsSchema.safeParse(merged)
    if (second.success) return second.data
  }
  return DEFAULT_SETTINGS
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      update: (patch) =>
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
          if (parsed.success) return { settings: parsed.data }
          // Soft merge: keep next keys that are valid on a default-backed object
          const soft = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...next })
          return { settings: soft.success ? soft.data : state.settings }
        }),
      reset: () => set({ settings: DEFAULT_SETTINGS })
    }),
    {
      name: 'kawaii-settings-v2',
      partialize: (s) => ({ settings: s.settings }),
      merge: (persisted, current) => {
        const p = persisted as { settings?: unknown } | undefined
        return {
          ...current,
          settings: safeParseSettings(p?.settings)
        }
      }
    }
  )
)
