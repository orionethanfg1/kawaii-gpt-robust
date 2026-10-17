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
  const max = opts?.maxItems ?? 12
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
  // Dedupe by exact dataUrl
  const without = prev.filter((g) => g.dataUrl !== dataUrl)
  const next = [...without, row].slice(-max)

  return {
    visualGallery: next,
    visualImageUrl: opts?.setAsPrimary ? dataUrl : character.visualImageUrl
  }
}

export function setChatPrimaryFromWardrobe(
  character: {
    visualImageUrl?: string
    visualGallery?: LegacyGalleryItem[]
  },
  dataUrl: string
): CharacterVisualPatch {
  const url = (dataUrl || '').trim()
  if (!url) {
    return {
      visualGallery: [...(character.visualGallery || [])],
      visualImageUrl: character.visualImageUrl
    }
  }
  return {
    visualGallery: [...(character.visualGallery || [])],
    visualImageUrl: url
  }
}
