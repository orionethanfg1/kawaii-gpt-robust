/** Shared types for the attachment library panel (not chat sidebar). */

export type LibraryKind = 'img' | 'doc' | 'file' | 'gen'

export type LibrarySource = 'user' | 'assistant' | 'generated' | 'disk'

export type LibraryItem = {
  id: string
  name: string
  convId?: string
  convTitle?: string
  kind: LibraryKind
  source: LibrarySource
  filePath?: string
  dataUrl?: string
  role?: string
  size?: number
  /** Epoch ms if known */
  updatedAt?: number
}

export type LibraryFilter = 'all' | 'images' | 'docs' | 'generated' | 'disk'

export type DiskLibraryRow = {
  name: string
  path: string
  kind: string
  size: number
  isImage: boolean
}
