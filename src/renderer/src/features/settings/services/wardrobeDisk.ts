/**
 * Wardrobe on disk (userData/wardrobe) + thin settings payloads.
 * Rule: NEVER drop a dataUrl from settings unless filePath is set (image on disk).
 * Backup copies under userData/wardrobe-backup/.
 */

export const WARDROBE_INLINE_MAX_CHARS = 48_000

/** Durable chat-primary pointer (path only — survives quota / wrong gal[0]). */
const CHAT_PRIMARY_KEY = 'kawaii-chat-primary-v1'

export function rememberChatPrimaryPath(filePath?: string | null): void {
  const p = String(filePath || '').trim()
  if (!p || p.startsWith('data:')) return
  try {
    localStorage.setItem(CHAT_PRIMARY_KEY, p)
  } catch {
    /* */
  }
}

export function recallChatPrimaryPath(): string {
  try {
    return String(localStorage.getItem(CHAT_PRIMARY_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function clearChatPrimaryPath(): void {
  try {
    localStorage.removeItem(CHAT_PRIMARY_KEY)
  } catch {
    /* */
  }
}


export type GalleryVisualItem = {
  id?: string
  dataUrl?: string
  filePath?: string
  label?: string
  scene?: string
  tags?: string[]
  role?: string
  intimacy?: number
}

export type CharacterVisualSlice = {
  visualImageUrl?: string
  facePrimaryUrl?: string
  visualGallery?: GalleryVisualItem[]
  name?: string
  [key: string]: unknown
}

export async function persistWardrobeDataUrl(
  dataUrl: string,
  fileNameHint?: string
): Promise<{ filePath?: string; dataUrl: string; purged?: boolean }> {
  if (!dataUrl?.startsWith('data:image/')) return { dataUrl }
  try {
    const res = await window.kawaii?.filesSaveWardrobeImage?.({
      dataUrl,
      fileName: fileNameHint
    })
    if (res?.ok && res.filePath) {
      // Optional backup copy
      try {
        await window.kawaii?.filesBackupWardrobeFile?.(res.filePath)
      } catch {
        /* */
      }
      if (dataUrl.length > WARDROBE_INLINE_MAX_CHARS) {
        return { filePath: res.filePath, dataUrl: '', purged: true }
      }
      return { filePath: res.filePath, dataUrl, purged: false }
    }
  } catch {
    /* optional disk */
  }
  // Disk failed — keep dataUrl so we do not lose the image
  return { dataUrl }
}

export async function openWardrobeFolder(): Promise<void> {
  try {
    await window.kawaii?.filesOpenWardrobeDir?.()
  } catch {
    /* */
  }
}

function normalizeFsPath(raw?: string): string {
  let p = String(raw || '').trim()
  if (!p) return ''
  if (p.startsWith('kawaii-file:')) p = p.slice('kawaii-file:'.length)
  if (p.startsWith('file:')) {
    p = p.replace(/^file:\/\//i, '')
    if (p.startsWith('localhost/')) p = p.slice(10)
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
    try {
      p = decodeURIComponent(p)
    } catch {
      /* */
    }
  }
  return p
}

export async function loadDataUrlFromFilePath(
  filePath?: string
): Promise<string | undefined> {
  const primary = normalizeFsPath(filePath)
  if (!primary) return undefined

  const tryPath = async (fp: string): Promise<string | undefined> => {
    if (!fp) return undefined
    try {
      const res = await window.kawaii?.filesToDataUrl?.(fp)
      if (res?.ok && res.dataUrl?.startsWith('data:image/')) return res.dataUrl
    } catch {
      /* */
    }
    try {
      const res = await window.kawaii?.filesToDataUrlFromWardrobeBackup?.(fp)
      if (res?.ok && res.dataUrl?.startsWith('data:image/')) return res.dataUrl
    } catch {
      /* */
    }
    return undefined
  }

  let url = await tryPath(primary)
  if (url) return url
  if (primary.includes('\\')) {
    url = await tryPath(primary.replace(/\\/g, '/'))
    if (url) return url
  }
  if (primary.includes('/')) {
    url = await tryPath(primary.replace(/\//g, '\\'))
    if (url) return url
  }

  try {
    const base = primary.split(/[/\\]/).pop() || ''
    if (base && window.kawaii?.filesListWardrobe) {
      const listed = await window.kawaii.filesListWardrobe()
      const hit = (listed?.items || []).find(
        (it) => String(it.name || '').toLowerCase() === base.toLowerCase()
      )
      if (hit?.path) {
        url = await tryPath(hit.path)
        if (url) return url
      }
    }
  } catch {
    /* */
  }
  return undefined
}

/** Disk is source of truth for wardrobe files. */
export async function listWardrobeOnDisk(): Promise<
  Array<{ name: string; path: string; size: number }>
> {
  try {
    const res = await window.kawaii?.filesListWardrobe?.()
    if (res?.ok && Array.isArray(res.items)) return res.items
  } catch {
    /* */
  }
  return []
}


/**
 * Ensure every gallery / primary image with a dataUrl is written to disk
 * and has filePath before settings are thinned for localStorage.
 */
export async function ensureCharacterVisualsOnDisk<T extends CharacterVisualSlice>(
  character: T
): Promise<T> {
  const gal = [...(character.visualGallery || [])]
  let changed = false
  for (let i = 0; i < gal.length; i++) {
    const g = gal[i]
    const du = g.dataUrl || ''
    if (!du.startsWith('data:image/')) continue
    if (g.filePath && g.filePath.length > 4) continue
    const hint = `${g.id || 'look'}-${i}.png`
    const r = await persistWardrobeDataUrl(du, hint)
    if (r.filePath) {
      gal[i] = {
        ...g,
        filePath: r.filePath,
        dataUrl: r.purged ? '' : du
      }
      changed = true
    }
  }

  let visualImageUrl = character.visualImageUrl
  let facePrimaryUrl = character.facePrimaryUrl
  const persistPrimary = async (url?: string, role?: string) => {
    if (!url?.startsWith('data:image/')) return url
    const r = await persistWardrobeDataUrl(url, role || 'primary.png')
    if (r.filePath && r.purged) {
      // Keep path as the durable pointer in a parallel field via gallery
      const exists = gal.some((x) => x.filePath === r.filePath)
      if (!exists) {
        gal.push({
          id: `auto-${role || 'primary'}-${Date.now()}`,
          filePath: r.filePath,
          dataUrl: '',
          role: role === 'face' ? 'face' : 'outfit',
          label: role || 'primary'
        })
        changed = true
      }
      // Primary stays as dataUrl in memory; partialize will strip only if path exists in gallery
      return url
    }
    return url
  }
  visualImageUrl = await persistPrimary(visualImageUrl, 'avatar')
  facePrimaryUrl = await persistPrimary(facePrimaryUrl, 'face')

  if (!changed && visualImageUrl === character.visualImageUrl && facePrimaryUrl === character.facePrimaryUrl) {
    return character
  }
  return { ...character, visualGallery: gal, visualImageUrl, facePrimaryUrl }
}

/**
 * Re-attach images found in wardrobe/ that are not in the gallery index.
 */
export async function recoverOrphanWardrobeFiles<T extends CharacterVisualSlice>(
  character: T
): Promise<{ character: T; added: number }> {
  let files: Array<{ name: string; path: string }> = []
  try {
    const r = await window.kawaii?.filesListWardrobe?.()
    if (r?.ok && r.items) files = r.items
  } catch {
    return { character, added: 0 }
  }
  if (!files.length) return { character, added: 0 }

  const gal = [...(character.visualGallery || [])]
  const known = new Set(
    gal.map((g) => String(g.filePath || '').toLowerCase()).filter(Boolean)
  )
  let added = 0
  for (const f of files.slice(0, 40)) {
    const p = String(f.path || '')
    if (!p || known.has(p.toLowerCase())) continue
    if (!/\.(png|jpe?g|webp)$/i.test(f.name)) continue
    const dataUrl = await loadDataUrlFromFilePath(p)
    gal.push({
      id: `orphan-${f.name.replace(/\W+/g, '').slice(0, 24)}-${added}`,
      filePath: p,
      dataUrl: dataUrl || '',
      label: f.name,
      role: 'outfit'
    })
    known.add(p.toLowerCase())
    added++
  }
  if (!added) return { character, added: 0 }
  return { character: { ...character, visualGallery: gal }, added }
}

export async function hydrateCharacterVisualFromDisk<T extends CharacterVisualSlice>(
  character: T
): Promise<{ character: T; hydrated: number }> {
  let hydrated = 0
  let next: T = { ...character, visualGallery: [...(character.visualGallery || [])] }

  // Recover orphans first
  try {
    const rec = await recoverOrphanWardrobeFiles(next)
    if (rec.added > 0) {
      next = rec.character
      hydrated += rec.added
    }
  } catch {
    /* */
  }

  const ensure = async (
    dataUrl: string | undefined,
    filePath: string | undefined
  ): Promise<{ dataUrl?: string; filePath?: string }> => {
    if (dataUrl && dataUrl.startsWith('data:image/') && dataUrl.length > 32) {
      return { dataUrl, filePath }
    }
    const pathCandidate =
      filePath ||
      (dataUrl && !dataUrl.startsWith('data:') && /[/\\]/.test(dataUrl) ? dataUrl : undefined)
    if (!pathCandidate) return { dataUrl, filePath }
    const loaded = await loadDataUrlFromFilePath(pathCandidate)
    if (loaded) {
      hydrated++
      return { dataUrl: loaded, filePath: pathCandidate }
    }
    return { dataUrl, filePath: pathCandidate }
  }

  const gal = next.visualGallery || []
  for (let i = 0; i < gal.length; i++) {
    const g = gal[i]
    const r = await ensure(g.dataUrl, g.filePath)
    gal[i] = { ...g, dataUrl: r.dataUrl || '', filePath: r.filePath || g.filePath }
  }
  next.visualGallery = gal

  {
    const pickFace =
      gal.find((g) => (g.role === 'face' || g.role === 'chat') && g.dataUrl) ||
      gal.find((g) => g.dataUrl)

    if (character.visualImageUrl && !character.visualImageUrl.startsWith('data:image/')) {
      const r = await ensure(undefined, character.visualImageUrl)
      if (r.dataUrl) next.visualImageUrl = r.dataUrl
    }
    if (character.facePrimaryUrl && !character.facePrimaryUrl.startsWith('data:image/')) {
      const r = await ensure(undefined, character.facePrimaryUrl)
      if (r.dataUrl) next.facePrimaryUrl = r.dataUrl
    }
    // Only restore primary from a known path/url the user already had — never invent from gallery[0]
    if (
      character.visualImageUrl &&
      !next.visualImageUrl?.startsWith('data:image/') &&
      pickFace?.dataUrl &&
      (pickFace.dataUrl === character.visualImageUrl ||
        (pickFace.filePath && character.visualImageUrl.includes(String(pickFace.filePath).slice(-24))))
    ) {
      next.visualImageUrl = pickFace.dataUrl
      hydrated++
    }
    if (
      character.facePrimaryUrl &&
      !next.facePrimaryUrl?.startsWith('data:image/') &&
      pickFace?.dataUrl
    ) {
      const faceHit =
        gal.find((g) => g.role === 'face' && g.dataUrl) ||
        (character.facePrimaryUrl === pickFace.dataUrl ? pickFace : null)
      if (faceHit?.dataUrl) next.facePrimaryUrl = faceHit.dataUrl
    }
  }

  // Restore chat primary from durable pointer (never invent gal[0])
  try {
    const remembered = recallChatPrimaryPath()
    if (remembered) {
      const r = await ensure(undefined, remembered)
      if (r.dataUrl) {
        next.visualImageUrl = r.dataUrl
        // Keep path in character for next partialize
        ;(next as { visualImageUrl?: string }).visualImageUrl = r.dataUrl
        // Also stash path on a non-persisted convention: re-write path after strip via remember
        rememberChatPrimaryPath(remembered)
        hydrated++
      } else if (!String(next.visualImageUrl || '').startsWith('data:image/')) {
        // Path-only until UI hydrates
        next.visualImageUrl = remembered as typeof next.visualImageUrl
      }
    }
  } catch {
    /* */
  }

  return { character: next, hydrated }
}

/**
 * Strip oversized dataURLs ONLY when filePath exists (image safe on disk).
 * Never delete the only copy.
 */
export function purgeLargeDataUrlsInCharacter<T extends CharacterVisualSlice>(character: T): T {
  const gal = (character.visualGallery || []).map((g) => {
    const du = g.dataUrl || ''
    if (du.length > WARDROBE_INLINE_MAX_CHARS && g.filePath) {
      return { ...g, dataUrl: '' }
    }
    return g
  })
  let visualImageUrl = character.visualImageUrl
  let facePrimaryUrl = character.facePrimaryUrl
  const stripHuge = (url?: string) => {
    if (!url || !url.startsWith('data:image/')) return url
    if (url.length <= WARDROBE_INLINE_MAX_CHARS) return url
    // Keep if no disk pointer in gallery for this primary
    const hasPath = gal.some((g) => g.filePath)
    return hasPath ? undefined : url
  }
  visualImageUrl = stripHuge(visualImageUrl)
  facePrimaryUrl = stripHuge(facePrimaryUrl)
  return { ...character, visualGallery: gal, visualImageUrl, facePrimaryUrl }
}

export function thinSettingsForStorage<T extends { character?: CharacterVisualSlice }>(
  settings: T
): T {
  if (!settings?.character) return settings
  return {
    ...settings,
    character: purgeLargeDataUrlsInCharacter(
      settings.character as CharacterVisualSlice
    ) as T['character']
  }
}
