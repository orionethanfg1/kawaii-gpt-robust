/**
 * Identity store — separate from runtime settings so schema/runtime wipes
 * cannot erase personality, avatar or gallery.
 */
import { create } from "zustand"
import { persist } from "zustand/middleware"
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
      partialize: (s) => ({ character: s.character })
    }
  )
)

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
    useCharacterStore.setState({
      character: pickRicherCharacter(merged, cur)
    })
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
