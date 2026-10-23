/**
 * User thumbs up/down → short developer reports (local, no secrets).
 * Active list + recoverable archive (tests can snapshot & clear active).
 */

export type FeedbackVote = 'up' | 'down'

export type FeedbackReport = {
  id: string
  at: number
  vote: FeedbackVote
  report: string
  /** Optional free-text from user explaining the vote */
  comment?: string
  context: {
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
}

export type FeedbackArchiveEntry = {
  id: string
  at: number
  label: string
  reason: 'test-run' | 'manual' | 'restore-point'
  appVersion?: string
  reports: FeedbackReport[]
}

const MAX = 200
const MAX_ARCHIVES = 40
const KEY = 'kawaii_feedback_v1'
const KEY_ARCH = 'kawaii_feedback_archive_v1'
const memory: FeedbackReport[] = []

function uid(prefix = 'fb'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function readLs<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeLs(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota */
  }
}

export function buildFeedbackReport(
  vote: FeedbackVote,
  ctx: FeedbackReport['context'],
  comment?: string
): FeedbackReport {
  const bits: string[] = []
  bits.push(vote === 'up' ? '👍 Me gusta' : '👎 No me gusta')
  const note = (comment || '').trim()
  if (note) bits.push(`comentario="${note.slice(0, 240)}"`)
  if (ctx.isImage) {
    bits.push('tipo=imagen')
    if (ctx.imagePrompt) bits.push(`prompt="${ctx.imagePrompt.slice(0, 120)}"`)
  } else {
    bits.push('tipo=texto')
  }
  if (ctx.model) bits.push(`model=${ctx.model}`)
  if (ctx.provider) bits.push(`provider=${ctx.provider}`)
  if (ctx.route) bits.push(`route=${ctx.route}`)
  if (ctx.characterName) bits.push(`char=${ctx.characterName}`)
  if (ctx.contentPreview) bits.push(`preview="${ctx.contentPreview.slice(0, 80)}"`)
  if (vote === 'down' && ctx.isImage) {
    bits.push('hint=revisar_prompt_sd|checkpoint|cfg|identidad')
  }
  if (vote === 'down' && !ctx.isImage) {
    bits.push('hint=revisar_routing|contexto|personalidad')
  }
  return {
    id: uid(),
    at: Date.now(),
    vote,
    report: bits.join(' · '),
    comment: note || undefined,
    context: ctx
  }
}

export function recordFeedback(report: FeedbackReport): void {
  memory.unshift(report)
  if (memory.length > MAX) memory.length = MAX
  const prev = readLs<FeedbackReport[]>(KEY, [])
  writeLs(KEY, [report, ...prev].slice(0, MAX))
}

export function listFeedbackReports(limit = 50): FeedbackReport[] {
  const prev = readLs<FeedbackReport[]>(KEY, [])
  if (prev.length) return prev.slice(0, limit)
  return memory.slice(0, limit)
}

/** Snapshot active feedback into archive, then clear active (for clean test baseline). */
export function archiveAndClearFeedback(opts?: {
  label?: string
  reason?: FeedbackArchiveEntry['reason']
  appVersion?: string
}): FeedbackArchiveEntry | null {
  const reports = listFeedbackReports(MAX)
  if (!reports.length) {
    clearActiveFeedback()
    return null
  }
  const entry: FeedbackArchiveEntry = {
    id: uid('fbarch'),
    at: Date.now(),
    label: opts?.label || `Feedback · ${new Date().toISOString()}`,
    reason: opts?.reason || 'manual',
    appVersion: opts?.appVersion,
    reports
  }
  const arch = readLs<FeedbackArchiveEntry[]>(KEY_ARCH, [])
  writeLs(KEY_ARCH, [entry, ...arch].slice(0, MAX_ARCHIVES))
  clearActiveFeedback()
  return entry
}

export function clearActiveFeedback(): void {
  memory.length = 0
  writeLs(KEY, [])
}

export function listFeedbackArchives(limit = 20): FeedbackArchiveEntry[] {
  return readLs<FeedbackArchiveEntry[]>(KEY_ARCH, []).slice(0, limit)
}

/** Restore an archive snapshot into active (prepends; does not delete archive). */
export function restoreFeedbackArchive(archiveId: string): number {
  const arch = listFeedbackArchives(MAX_ARCHIVES)
  const hit = arch.find((a) => a.id === archiveId)
  if (!hit) return 0
  const prev = listFeedbackReports(MAX)
  const merged = [...hit.reports, ...prev].slice(0, MAX)
  memory.length = 0
  memory.push(...merged)
  writeLs(KEY, merged)
  return hit.reports.length
}

export function feedbackSummary(): string {
  const all = listFeedbackReports(100)
  const up = all.filter((r) => r.vote === 'up').length
  const down = all.filter((r) => r.vote === 'down').length
  const imgDown = all.filter((r) => r.vote === 'down' && r.context.isImage).length
  return `feedback: 👍${up} 👎${down} (img👎${imgDown})`
}
