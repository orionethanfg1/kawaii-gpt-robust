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

export function pickRicherCharacter(
  a: CharacterProfile,
  b: CharacterProfile
): CharacterProfile {
  return scoreChar(a) >= scoreChar(b) ? a : b
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
  const stripUrl = (u: string) =>
    u.startsWith("data:image") ? "" : u

  return {
    ...c,
    visualImageUrl: stripUrl(url) || (gal?.[0] as { filePath?: string } | undefined)?.filePath || "",
    facePrimaryUrl: stripUrl(face) || undefined,
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
    useCharacterStore.setState({
      character: pickRicherCharacter(merged, cur)
    })
    // Re-assert description after score merge (pickRicher must not revive old junk)
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
