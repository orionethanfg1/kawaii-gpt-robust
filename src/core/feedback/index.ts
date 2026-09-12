/**
 * User feedback (👍/👎) for chat messages — persisted in localStorage.
 * Used by MessageBubble and System Tester reports.
 */

export type FeedbackVote = 'up' | 'down'

export type FeedbackContext = {
  messageId?: string
  role?: string
  contentPreview?: string
  isImage?: boolean
  imagePrompt?: string
  model?: string
  provider?: string
  route?: string
  characterName?: string
}

export type FeedbackEntry = {
  id: string
  vote: FeedbackVote
  at: number
  report: string
  comment?: string
  context?: FeedbackContext
}

export type FeedbackArchiveEntry = {
  id: string
  archivedAt: number
  note?: string
  entries: FeedbackEntry[]
}

const STORAGE_KEY = 'kawaii-gpt-feedback-v1'
const ARCHIVE_KEY = 'kawaii-gpt-feedback-archives-v1'
const MAX_ENTRIES = 500
const MAX_ARCHIVES = 30

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function readEntries(): FeedbackEntry[] {
  if (typeof localStorage === 'undefined') return []
  const list = safeParse<FeedbackEntry[]>(localStorage.getItem(STORAGE_KEY), [])
  return Array.isArray(list) ? list : []
}

function writeEntries(list: FeedbackEntry[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_ENTRIES)))
  } catch {
    /* quota */
  }
}

function readArchives(): FeedbackArchiveEntry[] {
  if (typeof localStorage === 'undefined') return []
  const list = safeParse<FeedbackArchiveEntry[]>(localStorage.getItem(ARCHIVE_KEY), [])
  return Array.isArray(list) ? list : []
}

function writeArchives(list: FeedbackArchiveEntry[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list.slice(-MAX_ARCHIVES)))
  } catch {
    /* quota */
  }
}

export function buildFeedbackReport(
  vote: FeedbackVote,
  ctx: FeedbackContext,
  comment?: string
): FeedbackEntry {
  const bits = [
    vote === 'up' ? 'LIKE' : 'DISLIKE',
    ctx.isImage ? 'image' : 'text',
    ctx.model ? `model=${ctx.model}` : '',
    ctx.provider ? `provider=${ctx.provider}` : '',
    ctx.route ? `route=${ctx.route}` : '',
    ctx.characterName ? `char=${ctx.characterName}` : '',
    ctx.contentPreview ? `preview="${String(ctx.contentPreview).slice(0, 80)}"` : ''
  ].filter(Boolean)
  return {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    vote,
    at: Date.now(),
    report: bits.join(' · '),
    comment: comment?.trim() || undefined,
    context: { ...ctx }
  }
}

export function recordFeedback(entry: FeedbackEntry): boolean {
  const list = readEntries()
  // Avoid exact duplicate same messageId+vote within 2s
  const dup = list.find(
    (e) =>
      e.context?.messageId &&
      e.context.messageId === entry.context?.messageId &&
      e.vote === entry.vote &&
      Math.abs(e.at - entry.at) < 2000
  )
  if (dup) return false
  list.push(entry)
  writeEntries(list)
  // Verify write
  const check = readEntries()
  return check.some((e) => e.id === entry.id)
}

export function listFeedbackReports(limit = 100): FeedbackEntry[] {
  const list = readEntries()
  return list.slice(-Math.max(1, limit)).reverse()
}

export function clearFeedbackReports(): void {
  writeEntries([])
}

export function archiveAndClearFeedback(opts?: {
  note?: string
  label?: string
  reason?: string
  appVersion?: string
}): FeedbackArchiveEntry {
  const entries = readEntries()
  const arch: FeedbackArchiveEntry = {
    id: `arch_${Date.now()}`,
    archivedAt: Date.now(),
    note: opts?.note || opts?.label || opts?.reason,
    entries: [...entries]
  }
  const archives = readArchives()
  archives.push(arch)
  writeArchives(archives)
  writeEntries([])
  return arch
}

export function listFeedbackArchives(limit = 10): FeedbackArchiveEntry[] {
  return readArchives().slice(-Math.max(1, limit)).reverse()
}

export function restoreFeedbackArchive(id: string): boolean {
  const archives = readArchives()
  const found = archives.find((a) => a.id === id)
  if (!found) return false
  const current = readEntries()
  const merged = [...current, ...found.entries]
  writeEntries(merged)
  return true
}

export function feedbackStats(): {
  likes: number
  dislikes: number
  imageDislikes: number
  textDislikes: number
} {
  const list = readEntries()
  const likes = list.filter((e) => e.vote === 'up').length
  const dis = list.filter((e) => e.vote === 'down')
  return {
    likes,
    dislikes: dis.length,
    imageDislikes: dis.filter((e) => e.context?.isImage).length,
    textDislikes: dis.filter((e) => !e.context?.isImage).length
  }
}

/** Active + archived (tests used to archive-before-run and report always 0) */
export function feedbackStatsIncludingArchives(): {
  likes: number
  dislikes: number
  imageDislikes: number
  textDislikes: number
  activeCount: number
  archivedBatches: number
  archivedEntries: number
} {
  const active = readEntries()
  const archives = readArchives()
  const archived = archives.flatMap((a) => a.entries || [])
  const all = [...active, ...archived]
  const likes = all.filter((e) => e.vote === 'up').length
  const dis = all.filter((e) => e.vote === 'down')
  return {
    likes,
    dislikes: dis.length,
    imageDislikes: dis.filter((e) => e.context?.isImage).length,
    textDislikes: dis.filter((e) => !e.context?.isImage).length,
    activeCount: active.length,
    archivedBatches: archives.length,
    archivedEntries: archived.length
  }
}

export function listAllFeedbackEntries(limit = 200): FeedbackEntry[] {
  const active = readEntries()
  const archived = readArchives().flatMap((a) => a.entries || [])
  return [...active, ...archived]
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(1, limit))
}

/** Standalone likes/dislikes report — no need to run full system tests */
export function buildFeedbackOnlyMarkdown(opts?: { limit?: number; includeArchives?: boolean }): string {
  const limit = opts?.limit ?? 80
  const includeArchives = opts?.includeArchives !== false
  const stats = includeArchives ? feedbackStatsIncludingArchives() : {
    ...feedbackStats(),
    activeCount: readEntries().length,
    archivedBatches: readArchives().length,
    archivedEntries: readArchives().flatMap((a) => a.entries || []).length
  }
  const entries = includeArchives
    ? listAllFeedbackEntries(limit)
    : listFeedbackReports(limit)

  const lines: string[] = [
    '# Informe de likes / dislikes (solo feedback)',
    '',
    `- **Generado:** ${new Date().toISOString()}`,
    `- **Likes:** ${stats.likes}`,
    `- **Dislikes:** ${stats.dislikes} (imagen=${(stats as { imageDislikes?: number }).imageDislikes ?? 0} · texto=${(stats as { textDislikes?: number }).textDislikes ?? 0})`,
    `- **Activos:** ${(stats as { activeCount?: number }).activeCount ?? readEntries().length}`,
    `- **Archivados:** ${(stats as { archivedEntries?: number }).archivedEntries ?? 0} en ${(stats as { archivedBatches?: number }).archivedBatches ?? 0} lote(s)`,
    '',
    '## Entradas recientes',
    ''
  ]

  if (!entries.length) {
    lines.push('_Sin feedback aún. Usa 👍 / 👎 en los mensajes del chat._')
  } else {
    for (const e of entries) {
      const when = new Date(e.at).toLocaleString()
      const kind = e.context?.isImage ? 'imagen' : 'texto'
      const vote = e.vote === 'up' ? '👍 LIKE' : '👎 DISLIKE'
      const model = e.context?.model || '—'
      const preview = (e.context?.contentPreview || e.report || '').slice(0, 120)
      const comment = e.comment ? ` · nota: ${e.comment}` : ''
      lines.push(
        `- **${vote}** · ${kind} · ${when} · model=${model}${comment}`,
        `  - ${preview || '(sin preview)'}`,
        ''
      )
    }
  }

  lines.push('', '## Cómo usar este informe')
  lines.push('- Pásalo a Grok / otra IA de código para priorizar fixes de imagen vs texto.')
  lines.push('- Los dislikes de imagen suelen apuntar a identidad visual, checkpoint o prompt.')
  lines.push('- Los likes ayudan a no regresar lo que ya funciona.')
  return lines.join('\n')
}
