/**
 * System QA report builder — target version driven (no hard-coded 0.9.0 gates).
 */

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip'
export type CheckPriority = 'P0' | 'P1' | 'P2'
export type CheckLayer =
  | 'app'
  | 'ux'
  | 'local'
  | 'cloud'
  | 'image'
  | 'music'
  | 'chat'
  | 'feedback'

export type ReportCheck = {
  id: string
  layer: CheckLayer
  priority: CheckPriority
  title: string
  status: CheckStatus
  detail?: string
  durationMs?: number
  fixHint?: string
}

export type SystemReport = {
  generatedAt: string
  appVersion: string
  targetVersion: string
  checks: ReportCheck[]
  summary: { pass: number; fail: number; warn: number; skip: number }
  readiness09: {
    score: number
    pct: number
    p0Fail: number
    p0Warn: number
    blocked: boolean
  }
  feedback?: {
    likes: number
    dislikes: number
    imageDislikes?: number
    textDislikes?: number
    recentDislikeNotes?: string[]
  }
  logs?: { musicTail?: string[] }
  environment?: Record<string, unknown>
  markdown: string
  json: string
}

function countBy(checks: ReportCheck[], status: CheckStatus): number {
  return checks.filter((c) => c.status === status).length
}

function buildMarkdown(report: Omit<SystemReport, 'markdown' | 'json'>): string {
  const t = report.targetVersion || '0.9.x'
  const lines: string[] = []
  lines.push(`# KawaiiGPT System Report → target ${t}`)
  lines.push('')
  lines.push(`- **Generated:** ${report.generatedAt}`)
  lines.push(`- **App version:** ${report.appVersion}`)
  lines.push(
    `- **Summary:** ✅ ${report.summary.pass} · ❌ ${report.summary.fail} · ⚠️ ${report.summary.warn} · ⏭️ ${report.summary.skip}`
  )
  lines.push(
    `- **${t} readiness:** ${report.readiness09.pct}% (${report.summary.pass}/${report.summary.pass + report.summary.fail + report.summary.warn}) · P0 fail=${report.readiness09.p0Fail} warn=${report.readiness09.p0Warn} · **${report.readiness09.blocked ? 'BLOCKED' : 'OK'}**`
  )
  lines.push('')
  if (report.readiness09.blocked) {
    lines.push(`## P0 blockers (must fix before ${t})`)
    for (const c of report.checks.filter((x) => x.priority === 'P0' && x.status === 'fail')) {
      lines.push(`- ${c.id}: ${c.title} → ${c.fixHint || c.detail || ''}`)
    }
    lines.push('')
  }
  lines.push('## Checks')
  lines.push('')
  lines.push('```')
  lines.push(
    '| Pri | Layer | Check | Status | Detail | Fix |'
  )
  lines.push('| --- | ----- | ----- | ------ | ------ | --- |')
  for (const c of report.checks) {
    const det = String(c.detail || '').replace(/\|/g, '/').slice(0, 120)
    const fix = String(c.fixHint || '').replace(/\|/g, '/').slice(0, 80)
    lines.push(
      `| ${c.priority} | ${c.layer} | ${c.title} | ${c.status.toUpperCase()} | ${det} | ${fix} |`
    )
  }
  lines.push('```')
  lines.push('')
  if (report.feedback) {
    lines.push('## Feedback (likes/dislikes)')
    lines.push(`- Likes: ${report.feedback.likes}`)
    lines.push(
      `- Dislikes: ${report.feedback.dislikes} (image=${report.feedback.imageDislikes ?? 0} text=${report.feedback.textDislikes ?? 0})`
    )
    lines.push('')
  }
  lines.push('## Environment')
  if (report.environment) {
    for (const [k, v] of Object.entries(report.environment)) {
      lines.push(`- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    }
  }
  lines.push('')
  lines.push('## For coding agents')
  lines.push(
    `Target ${t}. Fix P0 FAIL first. Do not regress PASS layers. Music ACE may be stopped on purpose (on-demand layers).`
  )
  return lines.join('\n')
}

export function finalizeReport(
  partial: Omit<SystemReport, 'summary' | 'readiness09' | 'markdown' | 'json'> & {
    summary?: SystemReport['summary']
    readiness09?: SystemReport['readiness09']
  }
): SystemReport {
  const checks = partial.checks || []
  const summary = {
    pass: countBy(checks, 'pass'),
    fail: countBy(checks, 'fail'),
    warn: countBy(checks, 'warn'),
    skip: countBy(checks, 'skip')
  }
  const p0 = checks.filter((c) => c.priority === 'P0')
  const p0Fail = p0.filter((c) => c.status === 'fail').length
  const p0Warn = p0.filter((c) => c.status === 'warn').length
  const scored = p0.filter((c) => c.status === 'pass' || c.status === 'fail' || c.status === 'warn')
  const p0Pass = p0.filter((c) => c.status === 'pass').length
  const denom = Math.max(1, scored.length)
  const pct = Math.round((p0Pass / denom) * 100)
  const readiness09 = {
    score: p0Pass / denom,
    pct,
    p0Fail,
    p0Warn,
    blocked: p0Fail > 0
  }
  const base = {
    ...partial,
    checks,
    summary,
    readiness09
  }
  const markdown = buildMarkdown(base)
  const json = JSON.stringify({ ...base, markdown: undefined }, null, 2)
  return { ...base, markdown, json }
}
