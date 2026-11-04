/**
 * Identity store — separate from runtime settings so schema/runtime wipes
 * cannot erase personality, avatar or gallery.
 *
 * localStorage must NEVER hold base64 dataUrls (QuotaExceeded with 19+ looks).
 * Images live on disk (filePath); dataUrls only in memory after hydrate.
 */
import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { CharacterProfile } from "../../types/settings"
import { DEFAULT_SETTINGS } from "../../types/settings"

export type CharacterState = {
  character: CharacterProfile
  setCharacter: (patch: Partial<CharacterProfile>) => void
  replaceCharacter: (full: CharacterProfile) => void
}

function scoreChar(c: CharacterProfile | null | undefined): number {
  if (!c) return 0
  let s = 0
  const def = DEFAULT_SETTINGS.character.name
  if ((c.name || "").trim() && c.name.trim() !== def) s += 30
  if ((c.visualImageUrl || "").trim()) s += 40
  if (Array.isArray(c.visualGallery) && c.visualGallery.length) s += 15 + Math.min(c.visualGallery.length, 6) * 3
  if ((c.visualDescription || "").trim()) s += 20
  if ((c.personality || "").trim().length > 40) s += 10
  if ((c.tagline || "").trim()) s += 5
  return s
}

/**
 * Merge identity: visuals by score, but text fields prefer the *first* argument
 * when it carries a non-empty string (settings / user edit wins over stale store).
 */
export function pickRicherCharacter(
  a: CharacterProfile,
  b: CharacterProfile
): CharacterProfile {
  const base = scoreChar(a) >= scoreChar(b) ? { ...b, ...a } : { ...a, ...b }
  // Explicit text from `a` always wins when present (user just edited settings)
  const textKeys = [
    'personality',
    'style',
    'tagline',
    'relationshipRole',
    'relationshipReaction',
    'name',
    'visualDescription'
  ] as const
  for (const k of textKeys) {
    const va = (a as Record<string, unknown>)[k]
    if (typeof va === 'string') {
      ;(base as Record<string, unknown>)[k] = va
    }
  }
  if (Array.isArray(a.traits)) base.traits = a.traits
  if (typeof a.visualFromAvatar === 'boolean') base.visualFromAvatar = a.visualFromAvatar
  // Chat primary: never lose a durable path. Prefer `a` (settings/user), else `b` if a empty.
  const aUrl = typeof a.visualImageUrl === 'string' ? a.visualImageUrl.trim() : ''
  const bUrl = typeof b.visualImageUrl === 'string' ? b.visualImageUrl.trim() : ''
  const preferPath = (u: string) => Boolean(u) && !u.startsWith('data:image/')
  if (aUrl) {
    base.visualImageUrl = aUrl
  } else if (preferPath(bUrl)) {
    base.visualImageUrl = bUrl
  } else if (bUrl) {
    base.visualImageUrl = bUrl
  }
  if (Array.isArray(a.visualGallery) && a.visualGallery.length) {
    base.visualGallery = a.visualGallery
  }
  return base
}

/** Strip base64 for localStorage; keep filePath + labels + tags */
export function thinCharacterForLocalStorage(c: CharacterProfile): CharacterProfile {
  const gal = Array.isArray(c.visualGallery)
    ? c.visualGallery.map((g) => {
        const item = g as {
          dataUrl?: string
          filePath?: string
          id?: string
          label?: string
          title?: string
          tags?: string[]
          role?: string
          intimacy?: number
          source?: string
        }
        const hasPath = Boolean(item.filePath && String(item.filePath).length > 4)
        return {
          ...item,
          // Never persist dataUrl in LS
          dataUrl: hasPath ? "" : undefined,
          filePath: item.filePath,
          id: item.id,
          label: item.label || item.title,
          tags: item.tags,
          role: item.role,
          intimacy: item.intimacy,
          source: item.source
        }
      })
    : c.visualGallery

  const url = String(c.visualImageUrl || "")
  const face = String((c as { facePrimaryUrl?: string }).facePrimaryUrl || "")
  /** data: must not be written to localStorage — resolve durable path, NEVER gal[0] fallback. */
  const durableRef = (u: string): string => {
    const s = (u || "").trim()
    if (!s) return ""
    if (!s.startsWith("data:image")) return s
    // Match gallery row that still holds this dataUrl or was the chat primary
    const match = (gal || []).find((g) => {
      const item = g as { dataUrl?: string; filePath?: string }
      return (
        (item.dataUrl && item.dataUrl === s) ||
        (item.filePath && s.includes(String(item.filePath).slice(-20)))
      )
    }) as { filePath?: string } | undefined
    if (match?.filePath && String(match.filePath).length > 4) return String(match.filePath)
    // Keep previous path-shaped primary if somehow mixed (should not happen)
    return ""
  }

  return {
    ...c,
    visualImageUrl: durableRef(url),
    facePrimaryUrl: durableRef(face) || undefined,
    visualGallery: gal as CharacterProfile["visualGallery"]
  } as CharacterProfile
}

let lastCharQuotaLog = 0

export const useCharacterStore = create<CharacterState>()(
  persist(
    (set, get) => ({
      character: DEFAULT_SETTINGS.character,
      setCharacter: (patch) =>
        set({
          character: {
            ...get().character,
            ...patch,
            traits: Array.isArray(patch.traits) ? patch.traits : get().character.traits
          }
        }),
      replaceCharacter: (full) => set({ character: full })
    }),
    {
      name: "kawaii-character-v1",
      partialize: (s) => ({ character: thinCharacterForLocalStorage(s.character) }),
      storage: createJSONStorage(() => ({
        getItem: (name: string) => {
          try {
            return localStorage.getItem(name)
          } catch {
            return null
          }
        },
        setItem: (name: string, value: string) => {
          try {
            // Hard size gate (~1.5MB) — character identity should be tiny without base64
            if (value.length > 1_500_000) {
              try {
                const parsed = JSON.parse(value) as {
                  state?: { character?: CharacterProfile }
                  version?: number
                }
                const thin = thinCharacterForLocalStorage(
                  parsed?.state?.character || DEFAULT_SETTINGS.character
                )
                // Drop gallery dataUrls entirely; keep max 24 path-only entries
                const gal = (thin.visualGallery || []).slice(0, 24).map((g) => ({
                  ...g,
                  dataUrl: undefined
                }))
                localStorage.setItem(
                  name,
                  JSON.stringify({
                    state: {
                      character: { ...thin, visualGallery: gal, visualImageUrl: stripData(thin.visualImageUrl) }
                    },
                    version: parsed?.version ?? 0
                  })
                )
                return
              } catch {
                /* fall through */
              }
            }
            localStorage.setItem(name, value)
          } catch {
            // QuotaExceeded: write path-only skeleton
            try {
              const parsed = JSON.parse(value) as {
                state?: { character?: CharacterProfile }
                version?: number
              }
              const ch = thinCharacterForLocalStorage(
                parsed?.state?.character || DEFAULT_SETTINGS.character
              )
              const gal = (ch.visualGallery || []).slice(0, 16).map((g) => ({
                id: (g as { id?: string }).id,
                filePath: (g as { filePath?: string }).filePath,
                label: (g as { label?: string }).label,
                tags: (g as { tags?: string[] }).tags,
                role: (g as { role?: string }).role,
                dataUrl: undefined
              }))
              localStorage.setItem(
                name,
                JSON.stringify({
                  state: {
                    character: {
                      ...ch,
                      visualImageUrl: stripData(ch.visualImageUrl),
                      visualGallery: gal
                    }
                  },
                  version: parsed?.version ?? 0
                })
              )
              const now = Date.now()
              if (now - lastCharQuotaLog > 20_000) {
                lastCharQuotaLog = now
                console.warn(
                  "[characterStore] cuota: guardado solo rutas (imágenes en disco / wardrobe)"
                )
              }
            } catch (e2) {
              const now = Date.now()
              if (now - lastCharQuotaLog > 20_000) {
                lastCharQuotaLog = now
                console.error("[characterStore] no se pudo persistir identidad", e2)
              }
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
      }))
    }
  )
)

function stripData(u: string | undefined): string {
  const s = String(u || "")
  return s.startsWith("data:image") ? "" : s
}

/** Sync from settings.character without wiping richer identity store. */
export function syncCharacterFromSettings(char: CharacterProfile): void {
  try {
    const cur = useCharacterStore.getState().character
    const next = pickRicherCharacter(
      { ...cur, ...char, traits: char.traits ?? cur.traits },
      cur
    )
    // Prefer explicit fields from char when present
    const merged: CharacterProfile = {
      ...next,
      ...char,
      traits: Array.isArray(char.traits) ? char.traits : next.traits,
      visualGallery:
        Array.isArray(char.visualGallery) && char.visualGallery.length
          ? char.visualGallery
          : next.visualGallery,
      visualImageUrl: (char.visualImageUrl || "").trim()
        ? char.visualImageUrl
        : next.visualImageUrl
    }
    // Manual description always wins (user edit or clear). Never keep stale "!!! English" sheet.
    if (typeof char.visualDescription === "string") {
      merged.visualDescription = char.visualDescription
      if (char.visualFromAvatar === false) merged.visualFromAvatar = false
    }
    // Last-write from settings wins for identity text — no second pickRicher pass
    useCharacterStore.setState({ character: merged })
    if (typeof char.visualDescription === "string") {
      const after = useCharacterStore.getState().character
      if (after.visualDescription !== char.visualDescription) {
        useCharacterStore.setState({
          character: {
            ...after,
            visualDescription: char.visualDescription,
            visualFromAvatar: char.visualFromAvatar === false ? false : after.visualFromAvatar
          }
        })
      }
    }
    // Same for personality / style (must survive rehydrate)
    if (typeof char.personality === "string" || typeof char.style === "string") {
      const after = useCharacterStore.getState().character
      useCharacterStore.setState({
        character: {
          ...after,
          personality:
            typeof char.personality === "string" ? char.personality : after.personality,
          style: typeof char.style === "string" ? char.style : after.style,
          tagline: typeof char.tagline === "string" ? char.tagline : after.tagline,
          relationshipRole:
            typeof char.relationshipRole === "string"
              ? char.relationshipRole
              : after.relationshipRole
        }
      })
    }
  } catch {
    /* */
  }
}

export function readIdentityCharacter(): CharacterProfile {
  try {
    return useCharacterStore.getState().character
  } catch {
    return DEFAULT_SETTINGS.character
  }
}
