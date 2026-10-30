/**
 * W5 — Approve generated (or any) image into the character wardrobe.
 * Pure merge helpers; disk IO stays in renderer/main.
 */

import type { LegacyGalleryItem } from './wardrobe'
import { migrateGalleryItem } from './wardrobe'

export type ApproveToWardrobeInput = {
  dataUrl: string
  title?: string
  tags?: string[]
  role?: 'face' | 'half' | 'full' | 'scene' | 'outfit'
  intimacy?: 0 | 1 | 2 | 3
  source?: 'user' | 'generated' | 'imported'
  filePath?: string
}

export type CharacterVisualPatch = {
  visualGallery: LegacyGalleryItem[]
  visualImageUrl?: string
}

function uid() {
  return `av_gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Append image to gallery (max 12). Does not change chat primary unless setAsPrimary.
 */
export function approveImageToWardrobe(
  character: {
    visualImageUrl?: string
    visualGallery?: LegacyGalleryItem[]
  },
  input: ApproveToWardrobeInput,
  opts?: { setAsPrimary?: boolean; maxItems?: number }
): CharacterVisualPatch {
  const max = opts?.maxItems ?? 48
  const dataUrl = (input.dataUrl || '').trim()
  const filePath = (input.filePath || '').trim()
  // Allow filePath-only (thin settings after disk purge)
  if (!dataUrl.startsWith('data:image/') && !filePath) {
    return {
      visualGallery: [...(character.visualGallery || [])],
      visualImageUrl: character.visualImageUrl
    }
  }
  const title = (input.title || 'Look generado').trim().slice(0, 48)
  const item: LegacyGalleryItem = {
    id: uid(),
    dataUrl: dataUrl.startsWith('data:image/') ? dataUrl : '',
    filePath: filePath || input.filePath,
    label: title,
    scene: title,
    tags: input.tags?.length ? input.tags.slice(0, 12) : ['source:generated'],
    role: input.role || 'outfit',
    intimacy: input.intimacy ?? 0
  }
  // Normalize via migrate for consistency
  const norm = migrateGalleryItem(item, 0)
  const row: LegacyGalleryItem = norm
    ? {
        id: norm.id,
        dataUrl: norm.dataUrl,
        filePath: input.filePath || (item as { filePath?: string }).filePath,
        label: norm.title,
        scene: title,
        tags: [...new Set([...(norm.tags || []), ...(input.tags || []), 'source:generated'])].slice(
          0,
          12
        ),
        role: norm.role,
        intimacy: norm.intimacy
      }
    : item

  const prev = [...(character.visualGallery || [])]
  const baseName = (p: string) =>
    p.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || ''
  const fpKey = filePath ? baseName(filePath) : ''
  const duKey =
    dataUrl.startsWith('data:image/') && dataUrl.length > 64
      ? dataUrl.length + ':' + dataUrl.slice(0, 40) + ':' + dataUrl.slice(-24)
      : ''

  // Same image → update tags/role in place (no duplicate slot)
  const sameIdx = prev.findIndex((g) => {
    if (dataUrl && g.dataUrl && g.dataUrl === dataUrl) return true
    if (fpKey && g.filePath && baseName(String(g.filePath)) === fpKey) return true
    if (duKey && g.dataUrl && g.dataUrl.length > 64) {
      const k =
        g.dataUrl.length + ':' + g.dataUrl.slice(0, 40) + ':' + g.dataUrl.slice(-24)
      return k === duKey
    }
    return false
  })
  let next: typeof prev
  if (sameIdx >= 0) {
    const old = prev[sameIdx]
    next = [...prev]
    next[sameIdx] = {
      ...old,
      ...row,
      id: old.id || row.id,
      filePath: row.filePath || old.filePath,
      dataUrl: row.dataUrl || old.dataUrl,
      tags: [...new Set([...(old.tags || []), ...(row.tags || [])])].slice(0, 12)
    }
  } else {
    // Soft per-role caps (leave room for other kinds under global max)
    const role = String(row.role || 'outfit')
    const roleCap: Record<string, number> = {
      face: 10,
      outfit: 22,
      scene: 8,
      half: 8,
      full: 12
    }
    const cap = roleCap[role] ?? 16
    let without = prev.filter((g) => {
      if (dataUrl && g.dataUrl === dataUrl) return false
      if (fpKey && g.filePath && baseName(String(g.filePath)) === fpKey) return false
      return true
    })
    const sameRole = without.filter((g) => String(g.role || 'outfit') === role)
    if (sameRole.length >= cap) {
      // Drop oldest of that role
      const dropId = sameRole[0]?.id
      without = without.filter((g) => g.id !== dropId)
    }
    next = [...without, row].slice(-max)
  }

  return {
    visualGallery: next,
    visualImageUrl: opts?.setAsPrimary
      ? filePath || dataUrl || character.visualImageUrl
      : character.visualImageUrl
  }
}

/**
 * Set chat primary. Prefer disk filePath over data: URLs (survives localStorage quota).
 * `ref` may be data:image… or an absolute path under wardrobe/.
 */
export function setChatPrimaryFromWardrobe(
  character: {
    visualImageUrl?: string
    visualGallery?: LegacyGalleryItem[]
  },
  ref: string,
  opts?: { filePath?: string }
): CharacterVisualPatch {
  const path = (opts?.filePath || '').trim()
  const url = (ref || '').trim()
  if (!url && !path) {
    return {
      visualGallery: [...(character.visualGallery || [])],
      visualImageUrl: character.visualImageUrl
    }
  }
  // Durable primary = file path when available
  const primary = path || url
  const gal = [...(character.visualGallery || [])]
  // Mark matching gallery row / ensure path on the item that matches this ref
  const nextGal = gal.map((g) => {
    const sameData = url.startsWith('data:image/') && g.dataUrl === url
    const samePath = path && String(g.filePath || '').replace(/\\/g, '/').toLowerCase().endsWith(path.replace(/\\/g, '/').split('/').pop() || '___')
    if (sameData || samePath) {
      return { ...g, filePath: path || g.filePath, dataUrl: path ? '' : g.dataUrl }
    }
    return g
  })
  return {
    visualGallery: nextGal,
    visualImageUrl: primary
  }
}
