import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
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
    ? (charRaw.visualGallery as unknown[])
        .filter((g) => {
          if (!g || typeof g !== 'object') return false
          const o = g as { dataUrl?: string; filePath?: string }
          return (
            (typeof o.dataUrl === 'string' && o.dataUrl.length > 0) ||
            (typeof o.filePath === 'string' && o.filePath.length > 0)
          )
        })
        .slice(0, 48)
    : undefined

  const visualDescription = (() => {
    let v =
      typeof charRaw.visualDescription === 'string' ? charRaw.visualDescription.trim() : ''
    if (!v) return charRaw.visualDescription
    // Strip VLM junk like "!!! Niamh has…"
    v = v.replace(/^[!！]{1,6}\s*/g, '').replace(/^[!?¡¿.#*\-\s]+/, '').trim()
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
    localModelIntimate:
      typeof r.localModelIntimate === 'string'
        ? r.localModelIntimate
        : DEFAULT_SETTINGS.localModelIntimate,
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


/** localStorage that never throws QuotaExceeded (P0 settings). */
const safeSettingsStorage = {
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value)
    } catch (e) {
      // Quota: strip huge blobs ONLY if filePath exists (image already on disk)
      try {
        const parsed = JSON.parse(value) as {
          state?: { settings?: Record<string, unknown> }
        }
        const settings = parsed.state?.settings
        if (settings) {
          const MAX = 48_000
          const ch = (settings.character || {}) as Record<string, unknown>
          const gal = Array.isArray(ch.visualGallery)
            ? (ch.visualGallery as Array<Record<string, unknown>>).map((g) => {
                const du = String(g.dataUrl || '')
                const fp = String(g.filePath || '')
                if (du.length > MAX && fp) return { ...g, dataUrl: '' }
                // Still no path: keep a tiny stub marker — better than silent loss
                if (du.length > MAX && !fp)
                  return { ...g, dataUrl: '', label: String(g.label || 'imagen (pendiente disco)') }
                return g
              })
            : []
          const strip = (u: unknown) => {
            const s = typeof u === 'string' ? u : ''
            if (!(s.startsWith('data:image/') && s.length > MAX)) return u
            const hasDisk = gal.some((g) => String(g.filePath || ''))
            return hasDisk ? undefined : u
          }
          const thin = {
            ...parsed,
            state: {
              ...parsed.state,
              settings: {
                ...settings,
                character: {
                  ...ch,
                  visualGallery: gal,
                  visualImageUrl: strip(ch.visualImageUrl),
                  facePrimaryUrl: strip(ch.facePrimaryUrl)
                }
              }
            }
          }
          localStorage.setItem(name, JSON.stringify(thin))
          console.warn(
            '[settings] quota exceeded — stripped base64 only where filePath exists'
          )
          return
        }
      } catch {
        /* */
      }
      try {
        // Last resort: remove oldest backups
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k && k.startsWith('kawaii-settings-backup')) {
            localStorage.removeItem(k)
          }
        }
        localStorage.setItem(name, value)
      } catch (e2) {
        console.error('[settings] persist failed (quota)', e2)
      }
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name)
    } catch {
      /* */
    }
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      update: (patch) => {
        if (patch.adultIntimacyOptIn === false) {
          void import('@core/routing/intimate-sticky')
            .then((m) => m.onAdultOptInChanged(false))
            .catch(() => {
              /* */
            })
        }
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
              : state.settings.cloudSlots,
            assistantMemory: patch.assistantMemory
              ? {
                  ...(state.settings.assistantMemory || {}),
                  ...patch.assistantMemory,
                  likes: Array.isArray(patch.assistantMemory.likes)
                    ? patch.assistantMemory.likes
                    : state.settings.assistantMemory?.likes,
                  favorites: Array.isArray(patch.assistantMemory.favorites)
                    ? patch.assistantMemory.favorites
                    : state.settings.assistantMemory?.favorites,
                  dislikes: Array.isArray(patch.assistantMemory.dislikes)
                    ? patch.assistantMemory.dislikes
                    : state.settings.assistantMemory?.dislikes,
                  habits: Array.isArray(patch.assistantMemory.habits)
                    ? patch.assistantMemory.habits
                    : state.settings.assistantMemory?.habits,
                  boundaries: Array.isArray(patch.assistantMemory.boundaries)
                    ? patch.assistantMemory.boundaries
                    : state.settings.assistantMemory?.boundaries,
                  voiceNotes: Array.isArray(patch.assistantMemory.voiceNotes)
                    ? patch.assistantMemory.voiceNotes
                    : state.settings.assistantMemory?.voiceNotes,
                  relational: Array.isArray(patch.assistantMemory.relational)
                    ? patch.assistantMemory.relational
                    : state.settings.assistantMemory?.relational,
                  version:
                    typeof patch.assistantMemory.version === 'number'
                      ? patch.assistantMemory.version
                      : state.settings.assistantMemory?.version
                }
              : state.settings.assistantMemory,
            userMemory: patch.userMemory
              ? { ...(state.settings.userMemory || {}), ...patch.userMemory }
              : state.settings.userMemory
          }
          const parsed = SettingsSchema.safeParse(next)
          if (parsed.success) {
            let data = parsed.data
            if (
              patch.character &&
              typeof patch.character.visualDescription === 'string' &&
              data.character?.visualDescription !== patch.character.visualDescription
            ) {
              data = {
                ...data,
                character: {
                  ...data.character,
                  visualDescription: patch.character.visualDescription,
                  visualFromAvatar:
                    patch.character.visualFromAvatar === false
                      ? false
                      : data.character?.visualFromAvatar
                }
              }
            }
            saved = data
            return { settings: data }
          }
          const soft = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...next })
          if (soft.success) {
            // Preserve explicit visualDescription from this patch (Zod/defaults can lag)
            let data = soft.data
            if (
              patch.character &&
              typeof patch.character.visualDescription === 'string' &&
              data.character?.visualDescription !== patch.character.visualDescription
            ) {
              data = {
                ...data,
                character: {
                  ...data.character,
                  visualDescription: patch.character.visualDescription,
                  visualFromAvatar:
                    patch.character.visualFromAvatar === false
                      ? false
                      : data.character?.visualFromAvatar
                }
              }
            }
            saved = data
            return { settings: data }
          }
          // Never drop character visual edits: apply merged next without strict parse
          try {
            console.warn('[settings] update schema soft-accept', Object.keys(patch), {
              issues: parsed.error?.issues?.slice(0, 4).map((i) => i.path.join('.') + ': ' + i.message)
            })
          } catch {
            /* */
          }
          // Preserve user identity (userName was missing from schema historically)
          try {
            const umIn = (next as { userMemory?: Record<string, unknown> }).userMemory
            if (umIn && typeof umIn === 'object') {
              ;(next as { userMemory: Record<string, unknown> }).userMemory = {
                ...((state.settings.userMemory as object) || {}),
                ...umIn
              }
            }
          } catch {
            /* */
          }
          saved = next as Settings
          return { settings: next as Settings }
        })
        if (saved) {
          try {
            if (saved.character) {
              syncCharacterFromSettings(saved.character)
              // A2: durable visual sheet on disk
              void import('@features/settings/services/characterIdentityDisk')
                .then(({ saveCharacterIdentityToDisk }) =>
                  saveCharacterIdentityToDisk({
                    visualDescription: saved!.character!.visualDescription,
                    visualFromAvatar: saved!.character!.visualFromAvatar === true,
                    name: saved!.character!.name,
                    personality: saved!.character!.personality,
                    style: saved!.character!.style,
                    tagline: saved!.character!.tagline,
                    relationshipRole: saved!.character!.relationshipRole
                  })
                )
                .catch(() => {
                  /* optional */
                })
            }
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
      storage: createJSONStorage(() => safeSettingsStorage),
      partialize: (s) => {
        const MAX = 48_000
        const ch = s.settings.character || ({} as typeof s.settings.character)
        // Fire-and-forget: ensure disk before next persist cycle
        try {
          void import('@features/settings/services/wardrobeDisk').then((m) => {
            void m.ensureCharacterVisualsOnDisk(ch as never)
          })
        } catch {
          /* */
        }
        const gal = (ch.visualGallery || []).map((g) => {
          const du = (g as { dataUrl?: string }).dataUrl || ''
          const fp = (g as { filePath?: string }).filePath
          // ONLY strip base64 when file is on disk — never delete the only copy
          if (du.length > MAX && fp) {
            return { ...g, dataUrl: '' }
          }
          return g
        })
        const stripPrimary = (u?: string) => {
          if (!u) return u
          if (!u.startsWith('data:image/')) return u // already a path or media ref — keep
          if (u.length <= MAX) return u // small inline ok
          // Large dataUrl: map to matching gallery filePath (never drop to empty → wrong gal[0])
          const match = gal.find((g) => {
            const item = g as { dataUrl?: string; filePath?: string }
            return item.dataUrl === u && item.filePath
          }) as { filePath?: string } | undefined
          if (match?.filePath) return match.filePath
          // Any path that looks like the same wardrobe file name from a prior save
          const pathHit = gal.find((g) => (g as { filePath?: string }).filePath) as
            | { filePath?: string }
            | undefined
          // Do NOT use arbitrary pathHit — only if we cannot match, keep empty and rely on disk identity
          void pathHit
          return undefined
        }
        const settings = {
          ...s.settings,
          character: {
            ...ch,
            visualGallery: gal,
            visualImageUrl: stripPrimary(ch.visualImageUrl),
            facePrimaryUrl: stripPrimary(ch.facePrimaryUrl)
          }
        }
        return { settings }
      },
      onRehydrateStorage: () => (state) => {
        void (async () => {
          try {
            const { runFullSettingsRecovery } = await import('../settings-backup')
            const cur = state?.settings
            if (!cur) return
            const { settings, report } = await runFullSettingsRecovery(cur)
            let next = report.recovered ? settings : cur
            try {
              const { hydrateCharacterVisualFromDisk } = await import(
                '@features/settings/services/wardrobeDisk'
              )
              let ch = next.character || {}
              try {
                const { ensureCharacterVisualsOnDisk } = await import(
                  '@features/settings/services/wardrobeDisk'
                )
                ch = await ensureCharacterVisualsOnDisk(ch)
              } catch {
                /* */
              }
              const { character, hydrated } = await hydrateCharacterVisualFromDisk(ch)
              // Keep dataUrls in MEMORY for UI; partialize strips only when filePath exists
              next = { ...next, character: character as typeof next.character }
              if (hydrated > 0 || report.recovered) {
                console.info('[settings] wardrobe hydrate (in-memory)', {
                  hydrated,
                  recovered: report.recovered
                })
              }
            } catch (e) {
              console.warn('[settings] wardrobe hydrate skip', e)
            }
            const { useSettingsStore } = await import('./settingsStore')
            useSettingsStore.setState({ settings: next })
            if (report.recovered) {
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
          // Prefer loaded settings as first arg so personality/style edits win
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
