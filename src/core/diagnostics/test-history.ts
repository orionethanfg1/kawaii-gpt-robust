/**
 * Persist system test runs + detailed diff between two reports.
 */
import type { ReportCheck, SystemReport } from './system-report'

const KEY = 'kawaii_test_runs_v1'
const MAX_RUNS = 30

export type StoredTestRun = {
  id: string
  savedAt: number
  appVersion: string
  targetVersion: string
  readinessPct: number
  blocked: boolean
  summary: SystemReport['summary']
  /** Compact checks for diff (full markdown optional) */
  checks: Array<{
    id: string
    title: string
    layer: string
    status: ReportCheck['status']
    priority?: string
    detail?: string
    fixHint?: string
  }>
  feedback?: SystemReport['feedback']
  markdown?: string
}

export type CheckDelta = {
  id: string
  title: string
  priority?: string
  from?: ReportCheck['status']
  to?: ReportCheck['status']
  change: 'improved' | 'regressed' | 'unchanged' | 'added' | 'removed'
  detailFrom?: string
  detailTo?: string
  fixHint?: string
}

export type TestRunDiff = {
  olderId: string
  newerId: string
  olderAt: string
  newerAt: string
  olderVersion: string
  newerVersion: string
  readinessFrom: number
  readinessTo: number
  readinessDelta: number
  summaryFrom: SystemReport['summary']
  summaryTo: SystemReport['summary']
  improved: CheckDelta[]
  regressed: CheckDelta[]
  unchangedFail: CheckDelta[]
  added: CheckDelta[]
  removed: CheckDelta[]
  markdown: string
}

function readRuns(): StoredTestRun[] {
  try {
    if (typeof localStorage === 'undefined') return []
    return JSON.parse(localStorage.getItem(KEY) || '[]') as StoredTestRun[]
  } catch {
    return []
  }
}

function writeRuns(runs: StoredTestRun[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY, JSON.stringify(runs.slice(0, MAX_RUNS)))
  } catch {
    /* ignore */
  }
}

export function saveTestRun(report: SystemReport): StoredTestRun {
  const run: StoredTestRun = {
    id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    savedAt: Date.now(),
    appVersion: report.appVersion,
    targetVersion: report.targetVersion || '0.9.0',
    readinessPct: report.readiness09?.pct ?? 0,
    blocked: Boolean(report.readiness09?.blocked),
    summary: report.summary,
    checks: report.checks.map((c) => ({
      id: c.id,
      title: c.title,
      layer: c.layer,
      status: c.status,
      priority: c.priority,
      detail: c.detail,
      fixHint: c.fixHint
    })),
    feedback: report.feedback,
    markdown: report.markdown
  }
  const prev = readRuns()
  writeRuns([run, ...prev])
  return run
}

export function listTestRuns(limit = 15): StoredTestRun[] {
  return readRuns().slice(0, limit)
}

export function getTestRun(id: string): StoredTestRun | undefined {
  return readRuns().find((r) => r.id === id)
}

const rank: Record<string, number> = {
  pass: 3,
  warn: 2,
  skip: 1,
  fail: 0
}

export function compareTestRuns(older: StoredTestRun, newer: StoredTestRun): TestRunDiff {
  const mapOld = new Map(older.checks.map((c) => [c.id, c]))
  const mapNew = new Map(newer.checks.map((c) => [c.id, c]))
  const ids = new Set([...mapOld.keys(), ...mapNew.keys()])

  const improved: CheckDelta[] = []
  const regressed: CheckDelta[] = []
  const unchangedFail: CheckDelta[] = []
  const added: CheckDelta[] = []
  const removed: CheckDelta[] = []

  for (const id of ids) {
    const a = mapOld.get(id)
    const b = mapNew.get(id)
    if (a && !b) {
      removed.push({
        id,
        title: a.title,
        priority: a.priority,
        from: a.status,
        change: 'removed',
        detailFrom: a.detail,
        fixHint: a.fixHint
      })
      continue
    }
    if (!a && b) {
      added.push({
        id,
        title: b.title,
        priority: b.priority,
        to: b.status,
        change: 'added',
        detailTo: b.detail,
        fixHint: b.fixHint
      })
      continue
    }
    if (!a || !b) continue
    const ra = rank[a.status] ?? 0
    const rb = rank[b.status] ?? 0
    const base: CheckDelta = {
      id,
      title: b.title || a.title,
      priority: b.priority || a.priority,
      from: a.status,
      to: b.status,
      detailFrom: a.detail,
      detailTo: b.detail,
      fixHint: b.fixHint || a.fixHint,
      change: 'unchanged'
    }
    if (rb > ra) {
      improved.push({ ...base, change: 'improved' })
    } else if (rb < ra) {
      regressed.push({ ...base, change: 'regressed' })
    } else if (a.status === 'fail' && b.status === 'fail') {
      // same fail — highlight if detail changed (new error surface)
      const sameDetail = (a.detail || '') === (b.detail || '')
      unchangedFail.push({
        ...base,
        change: 'unchanged',
        detailTo: sameDetail
          ? b.detail
          : `ANTES: ${a.detail || '—'} → AHORA: ${b.detail || '—'}`
      })
    }
  }

  const sortPri = (x: CheckDelta, y: CheckDelta) => {
    const p = (s?: string) => (s === 'P0' ? 0 : s === 'P1' ? 1 : 2)
    return p(x.priority) - p(y.priority)
  }
  improved.sort(sortPri)
  regressed.sort(sortPri)
  unchangedFail.sort(sortPri)

  const readinessFrom = older.readinessPct
  const readinessTo = newer.readinessPct
  const lines: string[] = []
  lines.push(`# Comparación de tests`)
  lines.push(``)
  lines.push(`- **Anterior:** ${new Date(older.savedAt).toISOString()} · v${older.appVersion} · ${readinessFrom}%`)
  lines.push(`- **Actual:** ${new Date(newer.savedAt).toISOString()} · v${newer.appVersion} · ${readinessTo}%`)
  lines.push(
    `- **Δ readiness:** ${readinessTo - readinessFrom >= 0 ? '+' : ''}${readinessTo - readinessFrom} pts`
  )
  lines.push(
    `- **Resumen anterior:** ✅${older.summary.pass} ❌${older.summary.fail} ⚠️${older.summary.warn}`
  )
  lines.push(
    `- **Resumen actual:** ✅${newer.summary.pass} ❌${newer.summary.fail} ⚠️${newer.summary.warn}`
  )
  lines.push(``)

  const section = (title: string, items: CheckDelta[], empty: string) => {
    lines.push(`## ${title}`)
    if (!items.length) {
      lines.push(empty)
      lines.push(``)
      return
    }
    for (const it of items) {
      lines.push(
        `- **[${it.priority || 'info'}] ${it.id}** ${it.title}: \`${it.from || '—'} → ${it.to || '—'}\``
      )
      if (it.detailFrom || it.detailTo) {
        lines.push(`  - detalle: ${it.detailTo || it.detailFrom || ''}`)
      }
      if (it.fixHint && (it.change === 'regressed' || it.change === 'unchanged')) {
        lines.push(`  - fix: ${it.fixHint}`)
      }
    }
    lines.push(``)
  }

  section('Mejoras', improved, '_Ninguna_')
  section('Regresiones (no repetir el mismo arreglo a ciegas)', regressed, '_Ninguna_')
  section(
    'Siguen en FAIL (mismo id — evita redundancia; mira si cambió el detalle)',
    unchangedFail,
    '_Ningún fail persistente_'
  )
  section('Checks nuevos', added, '_Ninguno_')
  section('Checks eliminados', removed, '_Ninguno_')

  lines.push(`## Lectura rápida`)
  if (regressed.length) {
    lines.push(`Prioriza regresiones P0 antes que fails antiguos.`)
  } else if (unchangedFail.length) {
    lines.push(
      `No hay regresiones nuevas; los FAIL persistentes son el foco (mismo id). Si el detalle cambió, el síntoma evolucionó.`
    )
  } else if (improved.length) {
    lines.push(`Avance limpio: solo mejoras o estable en verde.`)
  } else {
    lines.push(`Sin cambios de estado entre corridas.`)
  }

  return {
    olderId: older.id,
    newerId: newer.id,
    olderAt: new Date(older.savedAt).toISOString(),
    newerAt: new Date(newer.savedAt).toISOString(),
    olderVersion: older.appVersion,
    newerVersion: newer.appVersion,
    readinessFrom,
    readinessTo,
    readinessDelta: readinessTo - readinessFrom,
    summaryFrom: older.summary,
    summaryTo: newer.summary,
    improved,
    regressed,
    unchangedFail,
    added,
    removed,
    markdown: lines.join('\n')
  }
}

export function compareLatestTwo(): TestRunDiff | null {
  const runs = listTestRuns(2)
  if (runs.length < 2) return null
  // list is newest-first
  return compareTestRuns(runs[1], runs[0])
}
