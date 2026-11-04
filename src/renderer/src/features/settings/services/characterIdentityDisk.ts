/**
 * Character identity on disk (userData/identity/) — survives localStorage quota/merges.
 * Accessible path: %APPDATA%/kawaii-gpt-robust/identity/character-visual.json
 */
export type CharacterIdentityDisk = {
  visualDescription: string
  visualFromAvatar: boolean
  name: string
  personality?: string
  style?: string
  tagline?: string
  relationshipRole?: string
  updatedAt: number
}

export async function saveCharacterIdentityToDisk(opts: {
  visualDescription?: string
  visualFromAvatar?: boolean
  name?: string
  personality?: string
  style?: string
  tagline?: string
  relationshipRole?: string
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
      personality: opts.personality || '',
      style: opts.style || '',
      tagline: opts.tagline || '',
      relationshipRole: opts.relationshipRole || '',
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
  path?: string
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
      path: r.path,
      data: {
        visualDescription: r.visualDescription || '',
        visualFromAvatar: r.visualFromAvatar === true,
        name: r.name || '',
        personality: r.personality || '',
        style: r.style || '',
        tagline: r.tagline || '',
        relationshipRole: r.relationshipRole || '',
        updatedAt: r.updatedAt || 0
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Restore disk identity into a character object when LS is weaker / missing text. */
export async function restoreCharacterIdentityIfNeeded(char: {
  visualDescription?: string
  visualFromAvatar?: boolean
  name?: string
  personality?: string
  style?: string
  tagline?: string
  relationshipRole?: string
}): Promise<typeof char> {
  const loaded = await loadCharacterIdentityFromDisk()
  if (!loaded.ok || loaded.missing || !loaded.data) return char
  const d = loaded.data
  const next = { ...char }
  if (!(next.visualDescription || '').trim() && (d.visualDescription || '').trim()) {
    next.visualDescription = d.visualDescription
    next.visualFromAvatar = d.visualFromAvatar
  }
  if (!(next.name || '').trim() && (d.name || '').trim()) next.name = d.name
  // Prefer disk when LS personality is empty OR disk is newer and non-empty
  if ((d.personality || '').trim()) {
    if (!(next.personality || '').trim() || (d.personality || '').length >= (next.personality || '').length) {
      // Only overwrite if current looks like default/empty - prefer longer disk if user had rich text on disk
      if (!(next.personality || '').trim()) next.personality = d.personality
    }
  }
  if ((d.style || '').trim() && !(next.style || '').trim()) next.style = d.style
  if ((d.tagline || '').trim() && !(next.tagline || '').trim()) next.tagline = d.tagline
  if ((d.relationshipRole || '').trim() && !(next.relationshipRole || '').trim()) {
    next.relationshipRole = d.relationshipRole
  }
  return next
}
