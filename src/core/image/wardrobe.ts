/**
 * W2/W3 — Wardrobe model, safe migration from visualGallery, contextual ref pick.
 * Pure core (no Electron). Non-destructive: only fills missing role/tags/title.
 */

export type WardrobeRole = 'face' | 'half' | 'full' | 'scene' | 'outfit'

export type WardrobeItem = {
  id: string
  dataUrl: string
  /** Disk path when dataUrl was purged (I4) */
  filePath?: string
  /** Display title (maps from legacy label) */
  title: string
  tags: string[]
  role: WardrobeRole
  intimacy: 0 | 1 | 2 | 3
  /** Prefer as FaceID anchor when true */
  identityAnchor?: boolean
  source: 'user' | 'generated' | 'imported'
}

export type LegacyGalleryItem = {
  id?: string
  dataUrl?: string
  filePath?: string
  label?: string
  scene?: string
  tags?: string[]
  role?: string
  intimacy?: number
}

export type CharacterWardrobeSource = {
  visualImageUrl?: string
  facePrimaryUrl?: string
  visualGallery?: LegacyGalleryItem[]
  name?: string
}

function inferRole(text: string, explicit?: string): WardrobeRole {
  const e = (explicit || '').toLowerCase()
  if (e === 'face' || e === 'half' || e === 'full' || e === 'scene' || e === 'outfit') {
    return e
  }
  const t = text.toLowerCase()
  if (/face|rostro|portrait|cara|selfie|primer|avatar|framing:face/.test(t)) return 'face'
  if (/full|cuerpo|entero|wide|framing:full/.test(t)) return 'full'
  if (/half|medio|torso/.test(t)) return 'half'
  if (/playa|oficina|noche|fondo|escena|interior|exterior|scene:/.test(t)) return 'scene'
  if (/vestido|ropa|outfit|casual|formal|outfit:/.test(t)) return 'outfit'
  return 'outfit'
}

function inferTagsFromText(text: string): string[] {
  const t = text.toLowerCase()
  const tags: string[] = []
  const rules: Array<[RegExp, string]> = [
    [/\bcasual\b/, 'outfit:casual'],
    [/\bformal\b|oficina|office/, 'outfit:formal'],
    [/\bvestido\b|dress/, 'outfit:vestido'],
    [/\bplaya\b|beach/, 'scene:playa'],
    [/\bnoche\b|night/, 'scene:noche'],
    [/\binterior\b/, 'scene:interior'],
    [/\bexterior\b/, 'scene:exterior'],
    [/\boficina\b/, 'scene:oficina'],
    [/\bportrait\b|rostro|cara|face/, 'framing:face'],
    [/\bfull\b|cuerpo/, 'framing:full']
  ]
  for (const [re, tag] of rules) {
    if (re.test(t) && !tags.includes(tag)) tags.push(tag)
  }
  return tags.slice(0, 8)
}

/** Stable key for de-duplicating gallery rows (path wins over dataUrl). */
export function galleryItemDedupeKey(g: {
  id?: string
  dataUrl?: string
  filePath?: string
  label?: string
}): string {
  const fp = String(g.filePath || '')
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase()
  if (fp) return 'fp:' + fp
  const du = String(g.dataUrl || '').trim()
  if (du.startsWith('data:image/')) {
    return 'du:' + du.length + ':' + du.slice(0, 48) + ':' + du.slice(-24)
  }
  if (du.startsWith('kawaii-file:')) {
    return (
      'fp:' +
      du.slice('kawaii-file:'.length).replace(/\\/g, '/').toLowerCase()
    )
  }
  if (du.startsWith('file:')) {
    return 'fp:' + du.replace(/^file:\/\//i, '').replace(/\\/g, '/').toLowerCase()
  }
  if (/^[A-Za-z]:[\\/]/.test(du) || du.startsWith('/')) {
    return 'fp:' + du.replace(/\\/g, '/').toLowerCase()
  }
  const id = String(g.id || '').trim()
  if (id && id !== 'principal') return 'id:' + id
  return 'id:' + (g.label || id || 'x')
}

export function dedupeGalleryItems<
  T extends { id?: string; dataUrl?: string; filePath?: string; label?: string }
>(list: T[] | undefined | null): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const g of list || []) {
    const k = galleryItemDedupeKey(g)
    if (seen.has(k)) continue
    seen.add(k)
    const du = String(g.dataUrl || '')
    if (du.startsWith('kawaii-file:') || du.startsWith('file:')) {
      const path = du.startsWith('kawaii-file:')
        ? du.slice('kawaii-file:'.length)
        : du.replace(/^file:\/\//i, '')
      out.push({
        ...g,
        dataUrl: '',
        filePath: g.filePath || path
      })
      continue
    }
    out.push(g)
  }
  return out
}

/** Normalize one legacy gallery row into WardrobeItem (idempotent). */
export function migrateGalleryItem(
  g: LegacyGalleryItem,
  index = 0
): WardrobeItem | null {
  let dataUrl = (g.dataUrl || '').trim()
  let filePath = (g.filePath || '').trim()
  // Never put kawaii-file:/file: into dataUrl — CSP blocks <img src>
  if (dataUrl.startsWith('kawaii-file:')) {
    filePath = filePath || dataUrl.slice('kawaii-file:'.length)
    dataUrl = ''
  } else if (dataUrl.startsWith('file:')) {
    filePath = filePath || dataUrl.replace(/^file:\/\//i, '')
    dataUrl = ''
  }
  if (!dataUrl.startsWith('data:image/') && !filePath) return null
  const title = (g.label || g.scene || `Imagen ${index + 1}`).trim().slice(0, 48)
  const blob = `${title} ${(g.tags || []).join(' ')} ${g.role || ''}`
  const role = inferRole(blob, g.role)
  const tags = [
    ...new Set([...(g.tags || []), ...inferTagsFromText(blob)])
  ].slice(0, 12)
  const intimacyRaw = g.intimacy
  const intimacy = (
    intimacyRaw === 1 || intimacyRaw === 2 || intimacyRaw === 3 ? intimacyRaw : 0
  ) as 0 | 1 | 2 | 3
  return {
    id: g.id || `av_mig_${index}`,
    dataUrl: dataUrl.startsWith('data:image/') ? dataUrl : '',
    title,
    tags,
    role,
    intimacy,
    identityAnchor: role === 'face' || /framing:face|portrait|rostro/.test(blob.toLowerCase()),
    source: 'user',
    filePath: filePath || undefined
  }
}

/**
 * Ensure every gallery item has role/tags/title filled.
 * Returns gallery rows compatible with CharacterProfile.visualGallery.
 */
export function enrichVisualGallery(
  gallery: LegacyGalleryItem[] | undefined | null,
  primaryUrl?: string
): LegacyGalleryItem[] {
  let list = dedupeGalleryItems([...(gallery || [])])
  const primaryNorm = String(primaryUrl || '')
    .replace(/\\/g, '/')
    .toLowerCase()
  const hasPrimary = list.some((g) => {
    if (g.id === 'principal') return true
    if (primaryUrl && g.dataUrl === primaryUrl) return true
    const fp = String(g.filePath || '')
      .replace(/\\/g, '/')
      .toLowerCase()
    if (fp && primaryNorm && (primaryNorm.endsWith(fp.split('/').pop() || '') || primaryNorm.includes(fp)))
      return true
    return false
  })
  // Do not inject principal as a permanent gallery row when it is only a path —
  // UI synthesizes the star chip for display.
  if (primaryUrl && primaryUrl.startsWith('data:image/') && !hasPrimary) {
    list = [
      {
        id: 'principal',
        dataUrl: primaryUrl,
        label: 'Principal',
        scene: 'principal',
        role: 'face',
        tags: ['framing:face']
      },
      ...list
    ]
  }
  const mapped = list
    .map((g, i) => {
      const w = migrateGalleryItem(g, i)
      if (!w) return null
      return {
        id: w.id,
        dataUrl: w.dataUrl,
        filePath: w.filePath || g.filePath,
        label: w.title,
        scene: g.scene,
        tags: w.tags,
        role: w.role,
        intimacy: w.intimacy
      } as LegacyGalleryItem
    })
    .filter(Boolean) as LegacyGalleryItem[]
  return dedupeGalleryItems(mapped)
}

/** True if any item still lacks role or tags (needs migrate). */
export function galleryNeedsEnrichment(
  gallery: LegacyGalleryItem[] | undefined | null
): boolean {
  const list = gallery || []
  if (!list.length) return false
  return list.some(
    (g) =>
      g.dataUrl &&
      (!g.role || !Array.isArray(g.tags) || (g.tags.length === 0 && !(g.label || g.scene)))
  )
}

export type PickWardrobeResult = {
  faceUrl?: string
  styleUrls: string[]
  /** Ordered unique data URLs: face first, then style */
  referenceUrls: string[]
  labels: string[]
  reason: string
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9áéíóúñü:]+/i)
    .filter((w) => w.length >= 3)
}

function scoreStyleMatch(item: WardrobeItem, toks: string[], framing?: string): number {
  let s = 0
  const blob = `${item.title} ${item.tags.join(' ')} ${item.role}`.toLowerCase()
  for (const t of toks) {
    if (t.length >= 4 && blob.includes(t)) s += 2
    if (item.tags.some((tag) => tag.toLowerCase().includes(t))) s += 3
  }
  const f = (framing || '').toLowerCase()
  if (f === 'full' || f === 'wide') {
    if (item.role === 'full' || item.role === 'outfit') s += 2
    if (item.role === 'face') s -= 1
  } else if (f === 'close' || f === 'portrait') {
    if (item.role === 'face') s += 2
  }
  if (item.role === 'scene' || item.role === 'outfit') s += 1
  return s
}

/**
 * Pick FaceID face anchor + optional style/outfit gallery refs from wardrobe tags.
 * Falls back to primary URL if gallery empty.
 */
export function pickWardrobeRefs(opts: {
  character?: CharacterWardrobeSource | null
  promptHint?: string
  framing?: string
  maxStyleRefs?: number
  maxIntimacy?: number
}): PickWardrobeResult {
  const maxStyle = Math.max(0, Math.min(3, opts.maxStyleRefs ?? 2))
  const maxInt = opts.maxIntimacy ?? 3
  const char = opts.character
  if (!char) {
    return { styleUrls: [], referenceUrls: [], labels: [], reason: 'no_character' }
  }

  const enriched = enrichVisualGallery(char.visualGallery, char.visualImageUrl)
  const items: WardrobeItem[] = []
  for (let i = 0; i < enriched.length; i++) {
    const w = migrateGalleryItem(enriched[i], i)
    if (w) items.push(w)
  }

  const facePrimary = (char.facePrimaryUrl || '').trim()
  const primary = (char.visualImageUrl || '').trim()
  const faceCandidates = items
    .filter((it) => it.intimacy <= maxInt)
    .filter(
      (it) =>
        it.identityAnchor ||
        it.role === 'face' ||
        it.tags.some((t) => /framing:face|portrait/.test(t))
    )
  let faceUrl =
    (facePrimary.startsWith('data:image/') ? facePrimary : undefined) ||
    faceCandidates.find((it) => it.dataUrl === facePrimary)?.dataUrl ||
    faceCandidates.find((it) => it.dataUrl === primary)?.dataUrl ||
    faceCandidates[0]?.dataUrl ||
    (primary.startsWith('data:image/') ? primary : undefined) ||
    items.find((it) => it.role === 'face')?.dataUrl ||
    items[0]?.dataUrl

  const toks = tokens(opts.promptHint || '')
  const stylePool = items.filter(
    (it) =>
      it.intimacy <= maxInt &&
      it.dataUrl !== faceUrl &&
      (it.role === 'outfit' ||
        it.role === 'scene' ||
        it.role === 'full' ||
        it.role === 'half' ||
        it.tags.some((t) => /outfit:|scene:/.test(t)))
  )
  const ranked = stylePool
    .map((it) => ({ it, s: scoreStyleMatch(it, toks, opts.framing) }))
    .sort((a, b) => b.s - a.s)

  const styleUrls: string[] = []
  const labels: string[] = []
  if (faceUrl) {
    const faceItem = items.find((it) => it.dataUrl === faceUrl)
    labels.push(faceItem ? `cara: ${faceItem.title}` : 'avatar principal')
  }
  for (const { it, s } of ranked) {
    if (styleUrls.length >= maxStyle) break
    // Prefer positive match when user asked for outfit/scene; else take top diversity
    if (toks.length && s <= 0 && ranked.some((r) => r.s > 0)) continue
    styleUrls.push(it.dataUrl)
    labels.push(`${it.role}: ${it.title}`)
  }

  // If no style match but gallery has other views, take 1 non-face for variation
  if (!styleUrls.length && maxStyle > 0) {
    const other = items.find(
      (it) => it.dataUrl !== faceUrl && it.role !== 'face' && it.intimacy <= maxInt
    )
    if (other) {
      styleUrls.push(other.dataUrl)
      labels.push(`${other.role}: ${other.title}`)
    }
  }

  const referenceUrls: string[] = []
  const seen = new Set<string>()
  for (const u of [faceUrl, ...styleUrls]) {
    if (!u || seen.has(u)) continue
    seen.add(u)
    referenceUrls.push(u)
  }

  const reason = styleUrls.length
    ? `wardrobe face+${styleUrls.length} style (tags/prompt)`
    : faceUrl
      ? 'wardrobe face only'
      : 'empty'

  return { faceUrl, styleUrls, referenceUrls, labels, reason }
}
