/**
 * Ensure chat document attachments exist on disk under userData/app-context (extractos; los originales van a user-uploads).
 * Older sessions only kept textContent in memory — library showed the name but the folder was empty.
 */

import { useChatStore } from '@shared/lib/stores/chatStore'

let lastRun = 0
const COOLDOWN_MS = 8_000

function safeFileName(name: string, fallback = 'adjunto.txt'): string {
  const base = (name || fallback).replace(/[\\/:*?"<>|]/g, '_').trim() || fallback
  return base.slice(0, 120)
}

/**
 * Persist missing attachment files and patch message.filePath in the store.
 * Safe to call often (cooldown). Returns number of files written this run.
 */
export async function persistMissingChatAttachments(): Promise<number> {
  const now = Date.now()
  if (now - lastRun < COOLDOWN_MS) return 0
  lastRun = now

  const save = window.kawaii?.filesSaveChatAttachment
  if (typeof save !== 'function') return 0

  const { conversations, updateMessage } = useChatStore.getState()
  let written = 0

  for (const c of conversations) {
    for (const m of c.messages || []) {
      const atts = m.attachments
      if (!atts?.length) continue
      let changed = false
      const next = []
      for (const a of atts) {
        if (!a) {
          next.push(a)
          continue
        }
        // Already on disk
        if (a.filePath && String(a.filePath).length > 4) {
          next.push(a)
          continue
        }
        const text = (a.textContent || '').trim()
        // Only backfill text/docs (we no longer have original binary for old office uploads)
        if (!text || text.length < 20) {
          next.push(a)
          continue
        }
        const origName = a.name || 'documento.txt'
        // Prefer .txt for extracted text so the folder has a real readable file
        const outName = /\.(txt|md|json|csv)$/i.test(origName)
          ? safeFileName(origName)
          : safeFileName(origName.replace(/\.[^.]+$/, '') + '.txt')
        try {
          const r = await save({ fileName: outName, text, kind: 'context' })
          if (r?.ok && r.filePath) {
            next.push({ ...a, filePath: r.filePath })
            changed = true
            written++
          } else {
            next.push(a)
          }
        } catch {
          next.push(a)
        }
      }
      if (changed) {
        updateMessage(c.id, m.id, { attachments: next as typeof atts })
      }
    }
  }
  return written
}
