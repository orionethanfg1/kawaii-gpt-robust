
/**
 * Minimal memory of 👍 images — seed + prompts for later "like the one when I arrived".
 * localStorage only; no retraining.
 */
export type LikedImageMemory = {
  id: string
  at: number
  seed?: number
  prompt?: string
  finalPrompt?: string
  negative?: string
  faceId?: string
  title?: string
  characterName?: string
  width?: number
  height?: number
  note?: string
  /** Optional small data URL for FaceID secondary ref (may be omitted if huge) */
  dataUrl?: string
  filePath?: string
}

const KEY = 'kawaii-gpt-liked-images-v1'
const MAX = 40

function read(): LikedImageMemory[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function write(list: LikedImageMemory[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)))
  } catch {
    /* quota */
  }
}

export function recordLikedImage(entry: Omit<LikedImageMemory, 'id' | 'at'> & { id?: string }): boolean {
  const list = read()
  const full: LikedImageMemory = {
    id: entry.id || `like_img_${Date.now()}`,
    at: Date.now(),
    ...entry
  }
  list.push(full)
  write(list)
  return true
}

export function listLikedImages(limit = 20): LikedImageMemory[] {
  return read().slice(-Math.max(1, limit)).reverse()
}

/** Latest liked image with a usable data URL (for identity ref). */
export function getLatestLikedDataUrls(max = 2): string[] {
  const out: string[] = []
  for (const e of listLikedImages(15)) {
    if (e.dataUrl && e.dataUrl.startsWith('data:image/')) {
      out.push(e.dataUrl)
      if (out.length >= max) break
    }
  }
  return out
}

export function findLikedImageByHint(hint: string): LikedImageMemory | null {

  const h = (hint || '').toLowerCase()
  const list = read().slice().reverse()
  if (!list.length) return null
  if (/llegar|llegu[eé]|puerta|arrived|coming home/.test(h)) {
    const hit = list.find(
      (e) =>
        /llegar|door|doorway|arrived|interior|puerta/i.test(
          `${e.prompt || ''} ${e.finalPrompt || ''} ${e.title || ''} ${e.note || ''}`
        )
    )
    if (hit) return hit
  }
  return list[0] || null
}
