/**
 * A2 — Character visual description backup on disk (userData/identity/).
 * Survives localStorage quota and accidental store merges.
 */

export type CharacterIdentityDisk = {
  visualDescription: string
  visualFromAvatar: boolean
  name: string
  updatedAt: number
}

export async function saveCharacterIdentityToDisk(opts: {
  visualDescription?: string
  visualFromAvatar?: boolean
  name?: string
}): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const api = window.kawaii
    if (!api?.filesSaveCharacterIdentity) {
      return { ok: false, error: 'IPC no disponible' }
    }
    return await api.filesSaveCharacterIdentity({
      visualDescription: opts.visualDescription || '',
      visualFromAvatar: opts.visualFromAvatar === true,
      name: opts.name || '',
      updatedAt: Date.now()
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function loadCharacterIdentityFromDisk(): Promise<{
  ok: boolean
  missing?: boolean
  data?: CharacterIdentityDisk
  error?: string
}> {
  try {
    const api = window.kawaii
    if (!api?.filesLoadCharacterIdentity) {
      return { ok: false, error: 'IPC no disponible' }
    }
    const r = await api.filesLoadCharacterIdentity()
    if (!r.ok) return { ok: false, error: r.error }
    if (r.missing) return { ok: true, missing: true }
    return {
      ok: true,
      data: {
        visualDescription: String(r.visualDescription || ''),
        visualFromAvatar: r.visualFromAvatar === true,
        name: String(r.name || ''),
        updatedAt: r.updatedAt || 0
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Merge disk sheet into settings when LS is empty/weaker.
 * Never overwrite a longer manual sheet already in memory.
 */
export async function restoreCharacterIdentityIfNeeded(current: {
  visualDescription?: string
  visualFromAvatar?: boolean
  name?: string
}): Promise<{
  applied: boolean
  visualDescription?: string
  visualFromAvatar?: boolean
}> {
  const cur = String(current.visualDescription || '').trim()
  const disk = await loadCharacterIdentityFromDisk()
  if (!disk.ok || disk.missing || !disk.data) return { applied: false }
  const d = disk.data.visualDescription.trim()
  if (!d) return { applied: false }
  // Prefer disk if memory empty or disk is clearly richer and was manual
  const preferDisk =
    !cur ||
    (disk.data.visualFromAvatar === false && d.length >= cur.length) ||
    (cur.length < 20 && d.length >= 20)
  if (!preferDisk) return { applied: false }
  return {
    applied: true,
    visualDescription: d,
    visualFromAvatar: disk.data.visualFromAvatar
  }
}
