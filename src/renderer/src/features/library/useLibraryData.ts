import { useCallback, useEffect, useMemo, useState } from 'react'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { persistMissingChatAttachments } from '@features/chat/services/persistChatAttachments'
import { collectAttachmentLibrary, filterLibraryItems } from './collectAttachmentLibrary'
import type { DiskLibraryRow, LibraryFilter, LibraryItem } from './libraryTypes'

export function useLibraryData(open: boolean) {
  const conversations = useChatStore((s) => s.conversations)
  const [disk, setDisk] = useState<DiskLibraryRow[]>([])
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [query, setQuery] = useState('')
  const [loadingDisk, setLoadingDisk] = useState(false)

  const chatItems: LibraryItem[] = useMemo(
    () => collectAttachmentLibrary(conversations, 150),
    [conversations]
  )

  const refreshDisk = useCallback(async () => {
    setLoadingDisk(true)
    try {
      const res = await window.kawaii?.filesListLibrary?.()
      const rows = (res?.items || res?.files || []) as Array<Record<string, unknown>>
      setDisk(
        rows.map((r) => ({
          name: String(r.name || r.fileName || 'archivo'),
          path: String(r.path || r.filePath || ''),
          kind: String(r.kind || r.type || 'file'),
          size: Number(r.size || 0),
          isImage: Boolean(
            r.isImage ||
              String(r.kind || '').includes('image') ||
              /\.(png|jpe?g|webp|gif)$/i.test(String(r.name || r.path || ''))
          )
        })).filter((d) => d.path)
      )
    } catch {
      setDisk([])
    } finally {
      setLoadingDisk(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void persistMissingChatAttachments().catch(() => null)
    void refreshDisk()
  }, [open, refreshDisk])

  const filteredChat = useMemo(
    () => filterLibraryItems(chatItems, filter, query),
    [chatItems, filter, query]
  )

  const filteredDisk = useMemo(() => {
    if (filter === 'images' || filter === 'docs' || filter === 'generated') {
      if (filter === 'generated') return []
      if (filter === 'images') {
        return disk.filter(
          (d) =>
            d.isImage &&
            (!query.trim() ||
              d.name.toLowerCase().includes(query.trim().toLowerCase()) ||
              d.path.toLowerCase().includes(query.trim().toLowerCase()))
        )
      }
      return disk.filter(
        (d) =>
          !d.isImage &&
          (!query.trim() ||
            d.name.toLowerCase().includes(query.trim().toLowerCase()) ||
            d.path.toLowerCase().includes(query.trim().toLowerCase()))
      )
    }
    if (filter === 'disk' || filter === 'all') {
      const q = query.trim().toLowerCase()
      return disk.filter(
        (d) => !q || d.name.toLowerCase().includes(q) || d.path.toLowerCase().includes(q)
      )
    }
    return []
  }, [disk, filter, query])

  return {
    chatItems,
    filteredChat,
    disk,
    filteredDisk,
    filter,
    setFilter,
    query,
    setQuery,
    loadingDisk,
    refreshDisk,
    counts: {
      all: chatItems.length + disk.length,
      images: chatItems.filter((i) => i.kind === 'img' || i.kind === 'gen').length,
      docs: chatItems.filter((i) => i.kind === 'doc').length,
      generated: chatItems.filter((i) => i.source === 'generated' || i.kind === 'gen').length,
      disk: disk.length
    }
  }
}
