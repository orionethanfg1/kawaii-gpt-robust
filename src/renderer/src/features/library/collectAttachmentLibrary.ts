import type { LibraryItem } from './libraryTypes'

type Msg = {
  role?: string
  attachments?: Array<{
    id?: string
    name?: string
    mimeType?: string
    dataUrl?: string
    filePath?: string
    textContent?: string
  }>
  meta?: {
    imageFilePath?: string
    musicPath?: string
  }
}

type Conv = {
  id: string
  title?: string
  messages?: Msg[]
}

function classify(
  a: NonNullable<Msg['attachments']>[number]
): LibraryItem['kind'] {
  const mime = String(a.mimeType || '')
  const name = String(a.name || '')
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name)) return 'img'
  if (
    mime.includes('pdf') ||
    mime.includes('text') ||
    mime.includes('document') ||
    /\.(pdf|docx?|txt|md|json|csv)$/i.test(name) ||
    Boolean(a.textContent)
  ) {
    return 'doc'
  }
  return 'file'
}

/**
 * Collect attachments + generated assets from conversations (newest chats first, capped).
 * Pure: no React, no IPC.
 */
export function collectAttachmentLibrary(
  conversations: Conv[],
  max = 120
): LibraryItem[] {
  const items: LibraryItem[] = []
  const seen = new Set<string>()
  const push = (it: LibraryItem) => {
    const k = `${it.filePath || it.dataUrl?.slice(0, 48) || it.name}::${it.convId || ''}`
    if (seen.has(k)) return
    seen.add(k)
    items.push(it)
  }

  for (const c of [...conversations].reverse()) {
    const msgs = c.messages || []
    for (let mi = msgs.length - 1; mi >= 0; mi--) {
      const m = msgs[mi]
      const role = m.role || 'user'
      for (const a of m.attachments || []) {
        if (!a) continue
        const kind = classify(a)
        push({
          id: a.id || `${c.id}-${mi}-${a.name || 'att'}`,
          name: a.name || (kind === 'img' ? 'imagen' : kind === 'doc' ? 'documento' : 'archivo'),
          convId: c.id,
          convTitle: c.title || 'Chat',
          kind: kind === 'img' && role === 'assistant' ? 'gen' : kind,
          source:
            role === 'user' ? 'user' : role === 'assistant' ? 'generated' : 'assistant',
          filePath: a.filePath,
          dataUrl: a.dataUrl,
          role
        })
      }
      const metaPath = m.meta?.imageFilePath
      if (metaPath && typeof metaPath === 'string') {
        const base = metaPath.split(/[/\\]/).pop() || 'imagen-generada'
        push({
          id: `meta-${c.id}-${metaPath}`,
          name: base,
          convId: c.id,
          convTitle: c.title || 'Chat',
          kind: 'gen',
          source: 'generated',
          filePath: metaPath,
          role: m.role || 'assistant'
        })
      }
      const musicPath = m.meta?.musicPath
      if (musicPath && typeof musicPath === 'string') {
        const base = musicPath.split(/[/\\]/).pop() || 'audio'
        push({
          id: `music-${c.id}-${musicPath}`,
          name: base,
          convId: c.id,
          convTitle: c.title || 'Chat',
          kind: 'file',
          source: 'generated',
          filePath: musicPath,
          role: m.role || 'assistant'
        })
      }
    }
  }
  return items.slice(0, max)
}

export function filterLibraryItems(
  items: LibraryItem[],
  filter: import('./libraryTypes').LibraryFilter,
  query: string
): LibraryItem[] {
  const q = query.trim().toLowerCase()
  return items.filter((it) => {
    if (filter === 'images' && it.kind !== 'img' && it.kind !== 'gen') return false
    if (filter === 'docs' && it.kind !== 'doc') return false
    if (filter === 'generated' && it.source !== 'generated' && it.kind !== 'gen') return false
    if (filter === 'disk') return false
    if (!q) return true
    return (
      it.name.toLowerCase().includes(q) ||
      String(it.convTitle || '').toLowerCase().includes(q) ||
      String(it.filePath || '').toLowerCase().includes(q)
    )
  })
}
