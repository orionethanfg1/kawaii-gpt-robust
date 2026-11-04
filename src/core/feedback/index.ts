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


/** Paths / keys where feedback and related diagnostics live (renderer + main). */
export function feedbackStorageLocations(): {
  localStorageKeys: string[]
  note: string
} {
  return {
    localStorageKeys: [STORAGE_KEY, ARCHIVE_KEY],
    note:
      'Feedback vive en localStorage del renderer. Logs de app y artefactos están bajo userData de Electron (ver informe completo).'
  }
}

/**
 * Full diagnostic text: likes/dislikes + where data lives.
 * `userDataPaths` comes from main process when available.
 */
export function buildFeedbackDiagnosticBundle(opts?: {
  limit?: number
  appVersion?: string
  userDataPaths?: Array<{ id: string; label: string; path: string }>
}): string {
  const md = buildFeedbackOnlyMarkdown({ limit: opts?.limit ?? 100, includeArchives: true })
  const locs = feedbackStorageLocations()
  const extra: string[] = [
    '',
    '## Ubicaciones de datos',
    '',
    '### localStorage (renderer)',
    ...locs.localStorageKeys.map((k) => `- \`${k}\``),
    '',
    locs.note,
    ''
  ]
  if (opts?.userDataPaths?.length) {
    extra.push('### Carpetas en disco (Electron userData y afines)', '')
    for (const p of opts.userDataPaths) {
      extra.push(`- **${p.label}** (\`${p.id}\`): \`${p.path}\``)
    }
    extra.push('')
  } else {
    extra.push(
      '### Carpetas en disco',
      '',
      '_Pide a la app «dónde están los logs» o abre Ajustes → Equipo para ver userData._',
      ''
    )
  }
  if (opts?.appVersion) {
    extra.unshift(`- **App:** ${opts.appVersion}`)
  }
  return md + '\n' + extra.join('\n')
}

/** Detect NL request for feedback / comments diagnostic report */
/** User asks what likes mean / how feedback works in the app */
export function looksLikeFeedbackExplainRequest(text: string): boolean {
  const t = (text || '').toLowerCase()
  return (
    /\b(qu[eé]\s+son\s+los\s+likes?|para\s+qu[eé]\s+(?:sirve|sirven)\s+los\s+(?:likes?|👍)|c[oó]mo\s+funcionan\s+los\s+likes?)\b/.test(
      t
    ) ||
    (/\b(likes?|dislikes?|👍|👎|feedback)\b/.test(t) &&
      /\b(qu[eé]\s+es|qu[eé]\s+significa|explic[ae]|c[oó]mo\s+funciona)\b/.test(t))
  )
}

export function looksLikeFeedbackReportRequest(text: string): boolean {
  const t = (text || '').toLowerCase()
  // Strong: likes/unlikes + summary verbs
  if (
    /\b(likes?\s+y\s+(?:dislikes?|unlikes?)|dislikes?\s+y\s+likes?|unlikes?)\b/.test(t) &&
    /\b(resumen|informe|reporte|lista|estad|exporta|descarga|muestra|dame|ver|genera)\b/.test(t)
  ) {
    return true
  }
  if (
    /\b(like|likes|dislike|dislikes|unlikes?|👍|👎)\b/.test(t) &&
    /\b(resumen|informe|reporte|lista|estad|exporta|exportar|descarga|muestra|dame|ver|genera)\b/.test(
      t
    )
  ) {
    return true
  }
  // Product language: "comentarios" often means 👍/👎 in this app
  if (
    /\bcomentarios\b/.test(t) &&
    /\b(resumen|informe|reporte|like|likes|dislike|feedback|👍|👎|valoraciones)\b/.test(t)
  ) {
    return true
  }
  if (
    /\b(informe|reporte|exporta|exportar|descarga|descargar)\b/.test(t) &&
    /\b(like|likes|dislike|dislikes|unlikes?|comentarios|feedback|👍|👎|valoraciones)\b/.test(t)
  ) {
    return true
  }
  return /\b(comentarios del chat|feedback de la app|resumen de (?:los )?likes)\b/.test(t)
}

export type ClearDataIntent =
  | 'exports_only'
  | 'feedback_archives'
  | 'feedback_active'
  | 'feedback_all'
  | 'none'

/**
 * Distinguish NL cleanup requests:
 * - exports_only: archivos en userData/diagnostics (informes ya exportados a disco)
 * - feedback_archives: lotes archivados en localStorage (no cuentan como "activos" en tests)
 * - feedback_active: likes/dislikes vivos del chat
 * - feedback_all: activos + archivos + exports en disco
 */
export function classifyClearDataIntent(text: string): ClearDataIntent {
  const t = (text || '').toLowerCase()
  const wantsClean =
    /\b(limpia|limpiar|borra|borrar|elimina|eliminar|purga|vac[ií]a)\b/.test(t) ||
    /\b(clear|delete|purge)\b/.test(t)
  if (!wantsClean) return 'none'

  const mentionsExport =
    /\b(exportados?|exports?|informes?(?:\s+exportados?)?|archivos?\s+de\s+diagn|diagnostics?\s+folder|carpeta\s+diagn)\b/.test(
      t
    )
  const mentionsArchive =
    /\b(archivados?|archives?|historial\s+de\s+feedback|lotes\s+archivados)\b/.test(t)
  const mentionsActive =
    /\b(likes?|dislikes?|comentarios\s+activos|feedback\s+activo|valoraciones\s+del\s+chat)\b/.test(
      t
    )
  const mentionsAll =
    /\b(todo\s+el\s+feedback|feedback\s+completo|todo\s+lo\s+exportado\s+y\s+guardado|limpiar\s+pruebas|para\s+los\s+tests?)\b/.test(
      t
    )

  if (mentionsAll) return 'feedback_all'
  if (mentionsExport && !mentionsActive && !mentionsArchive) return 'exports_only'
  if (mentionsArchive && !mentionsActive) return 'feedback_archives'
  if (mentionsActive && !mentionsExport) return 'feedback_active'
  if (mentionsExport && mentionsActive) return 'feedback_all'
  // "limpia los informes" alone → disk exports (already exported files)
  if (mentionsExport) return 'exports_only'
  // "limpia feedback" ambiguous → archives only (safe: keeps live 👍/👎, cleans test noise)
  if (/\bfeedback\b/.test(t) || /\bcomentarios\b/.test(t)) return 'feedback_archives'
  return 'none'
}

/** Clear only archived feedback batches (localStorage archives) */
export function clearFeedbackArchivesOnly(): number {
  const n = readArchives().length
  writeArchives([])
  return n
}

/** Snapshot mark: last export timestamp so tests can ignore pre-export data if needed */
const LAST_EXPORT_KEY = 'kawaii-gpt-feedback-last-export-v1'

export function markFeedbackExportedAt(ts = Date.now()): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LAST_EXPORT_KEY, String(ts))
  } catch {
    /* */
  }
}

export function getLastFeedbackExportAt(): number | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const v = localStorage.getItem(LAST_EXPORT_KEY)
    if (!v) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/**
 * After a disk export, archive current active entries so system tests that
 * "include archives" can still see history, but active stats start clean.
 * Returns archived count.
 */
export function archiveActiveAfterExport(note = 'export-to-disk'): number {
  const entries = readEntries()
  if (!entries.length) {
    markFeedbackExportedAt()
    return 0
  }
  archiveAndClearFeedback({ note, reason: 'exported-report' })
  markFeedbackExportedAt()
  return entries.length
}
