import { useCallback, useEffect, useState } from 'react'
import type { SystemReport } from '@core/diagnostics/system-report'
import {
  compareLatestTwo,
  compareTestRuns,
  getTestRun,
  listTestRuns,
  saveTestRun,
  type StoredTestRun,
  type TestRunDiff
} from '@core/diagnostics/test-history'
import {
  archiveAndClearFeedback,
  listFeedbackArchives,
  restoreFeedbackArchive,
  type FeedbackArchiveEntry,
  buildFeedbackOnlyMarkdown,
  feedbackStatsIncludingArchives
} from '@core/feedback'
import { runSystemTests } from './runSystemTests'
import { APP_VERSION } from '@shared/version'
import { notifyUser } from '@shared/lib/notify'

function storedToReport(run: StoredTestRun): SystemReport {
  return {
    generatedAt: new Date(run.savedAt).toISOString(),
    appVersion: run.appVersion,
    targetVersion: run.targetVersion || APP_VERSION,
    summary: run.summary,
    readiness09: {
      score: run.readinessPct / 100,
      max: 1,
      pct: run.readinessPct,
      p0Fail: run.blocked ? Math.max(1, run.summary.fail) : 0,
      p0Warn: 0,
      blocked: run.blocked,
      blockers: run.checks
        .filter((c) => c.status === 'fail' && c.priority === 'P0')
        .map((c) => `${c.id}: ${c.title}`)
    },
    checks: run.checks.map((c) => ({
      id: c.id,
      layer: (c.layer as SystemReport['checks'][0]['layer']) || 'app',
      title: c.title,
      status: c.status,
      detail: c.detail,
      priority: c.priority as SystemReport['checks'][0]['priority'],
      fixHint: c.fixHint
    })),
    feedback: run.feedback,
    markdown:
      run.markdown ||
      [
        `# Informe restaurado · v${run.appVersion}`,
        `Readiness: ${run.readinessPct}% · blocked=${run.blocked}`,
        ...run.checks.map(
          (c) => `- [${c.status}] ${c.layer}/${c.title}${c.detail ? ` — ${c.detail}` : ''}`
        )
      ].join('\n'),
    json: JSON.stringify(run, null, 2)
  }
}

export function SystemTesterPanel() {
  const [fbOnly, setFbOnly] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<SystemReport | null>(null)
  const [includeGen, setIncludeGen] = useState(false) // default off: faster; user can enable
  const [archiveFb, setArchiveFb] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [runs, setRuns] = useState<StoredTestRun[]>([])
  const [diff, setDiff] = useState<TestRunDiff | null>(null)
  const [fbArch, setFbArch] = useState<FeedbackArchiveEntry[]>([])
  const [compareOlder, setCompareOlder] = useState('')
  const [compareNewer, setCompareNewer] = useState('')
  const [logOpen, setLogOpen] = useState(true)

  const refreshMeta = useCallback(() => {
    const list = listTestRuns(12)
    setRuns(list)
    setFbArch(listFeedbackArchives(10))
    setDiff(compareLatestTwo())
    return list
  }, [])

  // Hydrate last report so logs stay visible after reopen
  useEffect(() => {
    const list = refreshMeta()
    if (list[0] && !report) {
      setReport(storedToReport(list[0]))
      if (list.length >= 2) {
        setCompareOlder(list[1].id)
        setCompareNewer(list[0].id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMeta])

  const run = async () => {
    setBusy(true)
    setErr(null)
    setLogOpen(true)
    try {
      // Read likes/dislikes FIRST — archiving before the run always showed 0
      const r = await runSystemTests({ includeMusicGenerate: includeGen })
      setReport(r)
      saveTestRun(r)
      if (archiveFb) {
        archiveAndClearFeedback({
          note: `Tras test ${new Date().toLocaleString()} · v${APP_VERSION}`
        })
      }
      const list = refreshMeta()
      const d = compareLatestTwo()
      setDiff(d)
      if (d) {
        setCompareOlder(d.olderId)
        setCompareNewer(d.newerId)
      } else if (list[0]) {
        setCompareNewer(list[0].id)
      }
      const pct = r.readiness09?.pct ?? 0
      const blocked = r.readiness09?.blocked
      const detail =
        `✅${r.summary.pass} · ❌${r.summary.fail} · ⚠️${r.summary.warn} · readiness ${pct}%` +
        (blocked ? ' · BLOQUEADO' : '')
      void notifyUser(
        blocked || r.summary.fail > 0 ? 'Tests terminados (con fallos)' : 'Tests terminados',
        detail,
        { kind: blocked || r.summary.fail > 0 ? 'error' : 'success', sticky: true, os: true }
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErr(msg)
      void notifyUser('Tests fallaron al ejecutar', msg, { kind: 'error', sticky: true })
    } finally {
      setBusy(false)
    }
  }

  const doCompare = () => {
    const a = getTestRun(compareOlder)
    const b = getTestRun(compareNewer)
    if (!a || !b) {
      setErr('Elige dos corridas válidas para comparar')
      return
    }
    const [older, newer] = a.savedAt <= b.savedAt ? [a, b] : [b, a]
    setDiff(compareTestRuns(older, newer))
    setLogOpen(true)
  }

  const loadRun = (id: string) => {
    const run = getTestRun(id)
    if (!run) return
    setReport(storedToReport(run))
    setLogOpen(true)
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="rounded-2xl border border-kawaii-border bg-white/90 p-5 space-y-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-kawaii-text">{`Tester de sistema → ${APP_VERSION}`}</h3>
          <p className="text-[11px] text-kawaii-text-muted mt-0.5 leading-relaxed">
            Los informes se guardan en este dispositivo. El último se restaura al abrir Ajustes. La
            generación de música es opcional (puede tardar varios minutos la 1ª vez).
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          className="text-xs px-3 py-1.5 rounded-full bg-kawaii-pink-deep text-white disabled:opacity-50"
        >
          {busy ? 'Ejecutando…' : 'Ejecutar tests'}
        </button>
      </div>

      {busy ? (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Tests en curso… deja esta ventana abierta. Si incluiste música, el polling de ACE puede
          durar varios minutos (mira Capas → consola ACE).
        </p>
      ) : null}

      <label className="flex items-center gap-2 text-[11px] text-kawaii-text-muted">
        <input
          type="checkbox"
          checked={includeGen}
          onChange={(e) => setIncludeGen(e.target.checked)}
        />
        Incluir generación de música (lento; desmarcado = tests más rápidos)
      </label>
      <label className="flex items-center gap-2 text-[11px] text-kawaii-text-muted">
        <input
          type="checkbox"
          checked={archiveFb}
          onChange={(e) => setArchiveFb(e.target.checked)}
        />
        Después del test: archivar likes/dislikes activos (opcional; desmarcado = se conservan para el informe)
      </label>

      <div className="rounded-xl border border-kawaii-border/80 bg-kawaii-pink-soft/20 p-3 space-y-2">
        <p className="text-[11px] font-semibold text-kawaii-text">Solo likes / dislikes</p>
        <p className="text-[10px] text-kawaii-text-muted leading-relaxed">
          Exporta el aprendizaje del chat sin ejecutar todos los tests. Incluye activos y archivados.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="text-[11px] px-2.5 py-1 rounded-full bg-kawaii-purple-soft text-kawaii-text border border-kawaii-border"
            onClick={() => {
              const md = buildFeedbackOnlyMarkdown({ includeArchives: true })
              setFbOnly(md)
              void copy(md)
            }}
          >
            Generar e informe 👍👎
          </button>
          <button
            type="button"
            className="text-[11px] px-2.5 py-1 rounded-full border border-kawaii-border disabled:opacity-40"
            disabled={!fbOnly}
            onClick={() => fbOnly && void copy(fbOnly)}
          >
            Copiar informe feedback
          </button>
        </div>
        {(() => {
          const st = feedbackStatsIncludingArchives()
          return (
            <p className="text-[11px] text-kawaii-text">
              Resumen: <span className="font-semibold text-emerald-700">{st.likes} likes</span>
              {' · '}
              <span className="font-semibold text-rose-700">{st.dislikes} dislikes</span>
              {' '}(img {st.imageDislikes} · texto {st.textDislikes}) · activos {st.activeCount} · archivados {st.archivedEntries}
            </p>
          )
        })()}
        {fbOnly ? (
          <pre className="text-[10px] max-h-40 overflow-auto whitespace-pre-wrap bg-white/80 rounded-lg p-2 border border-kawaii-border/60">
            {fbOnly}
          </pre>
        ) : null}
      </div>


      {err ? (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
          {err}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className="text-[11px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-kawaii-pink-soft/40 disabled:opacity-40"
          disabled={!report}
          onClick={() => report && void copy(report.markdown)}
        >
          Copiar Markdown
        </button>
        <button
          type="button"
          className="text-[11px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-kawaii-pink-soft/40 disabled:opacity-40"
          disabled={!report}
          onClick={() => report && void copy(report.json)}
        >
          Copiar JSON
        </button>
        <button
          type="button"
          className="text-[11px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-kawaii-pink-soft/40 disabled:opacity-40"
          disabled={!diff}
          onClick={() => diff && void copy(diff.markdown)}
        >
          Copiar comparación
        </button>
        <button
          type="button"
          className="text-[11px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-kawaii-pink-soft/40"
          onClick={() => setLogOpen((v) => !v)}
        >
          {logOpen ? 'Ocultar detalle' : 'Mostrar detalle / logs'}
        </button>
      </div>

      {(runs?.length ?? 0) >= 2 ? (
        <div className="rounded-xl border border-kawaii-border/70 bg-kawaii-pink-soft/20 p-3 space-y-2">
          <p className="text-[11px] font-semibold">Comparar corridas</p>
          <div className="flex flex-wrap gap-2 items-center text-[11px]">
            <label className="flex items-center gap-1">
              Anterior
              <select
                className="input-kawaii text-[11px] py-1"
                value={compareOlder}
                onChange={(e) => setCompareOlder(e.target.value)}
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.savedAt).toLocaleString()} · v{r.appVersion} · {r.readinessPct}%
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              Posterior
              <select
                className="input-kawaii text-[11px] py-1"
                value={compareNewer}
                onChange={(e) => setCompareNewer(e.target.value)}
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.savedAt).toLocaleString()} · v{r.appVersion} · {r.readinessPct}%
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="text-[11px] px-2 py-1 rounded-lg bg-white border border-kawaii-border"
              onClick={doCompare}
            >
              Diff detallado
            </button>
          </div>
        </div>
      ) : null}

      {diff ? (
        <div className="space-y-1 border border-emerald-200/80 rounded-xl p-3 bg-emerald-50/40">
          <p className="text-[11px] font-semibold text-emerald-900">
            Δ readiness {diff.readinessDelta >= 0 ? '+' : ''}
            {diff.readinessDelta} pts · v{diff.olderVersion} → v{diff.newerVersion}
          </p>
          <p className="text-[10px] text-kawaii-text-muted">
            ↑{diff.improved?.length ?? 0} · ↓{diff.regressed?.length ?? 0} · ↺{diff.unchangedFail?.length ?? 0} FAIL
            iguales
          </p>
          {logOpen ? (
            <pre className="max-h-40 overflow-auto text-[9px] bg-white/80 p-2 rounded-lg whitespace-pre-wrap select-text">
              {diff.markdown}
            </pre>
          ) : null}
        </div>
      ) : null}

      {report ? (
        <div className="space-y-2 border-t border-kawaii-border/60 pt-3">
          <p className="text-[11px] font-semibold text-kawaii-text">
            Informe · {report.generatedAt} · v{report.appVersion}
          </p>
          <p className="text-[12px]">
            ✅ {report.summary.pass} · ❌ {report.summary.fail} · ⚠️ {report.summary.warn} · ⏭️{' '}
            {report.summary.skip}
          </p>
          {report.readiness09 ? (
            <p
              className={
                'text-[12px] font-semibold ' +
                (report.readiness09.blocked ? 'text-red-700' : 'text-emerald-800')
              }
            >
              {`${APP_VERSION} readiness: ${report.readiness09.pct}%`}
              {report.readiness09.blocked
                ? ` · BLOQUEADO (${report.readiness09.p0Fail} P0)`
                : ' · sin bloqueo P0'}
            </p>
          ) : null}

          {logOpen ? (
            <>
              <div className="max-h-56 overflow-y-auto text-[10px] font-mono bg-black/[0.04] rounded-xl p-3 space-y-1 leading-relaxed">
                {report.checks.map((c) => (
                  <div key={c.id}>
                    <span
                      className={
                        c.status === 'pass'
                          ? 'text-emerald-700 font-semibold'
                          : c.status === 'fail'
                            ? 'text-red-700 font-semibold'
                            : c.status === 'warn'
                              ? 'text-amber-700 font-semibold'
                              : 'text-kawaii-text-muted'
                      }
                    >
                      [{c.status}]
                    </span>{' '}
                    {c.priority ? `${c.priority} ` : ''}
                    {c.layer}/{c.title}
                    {c.detail ? ` — ${c.detail.slice(0, 140)}` : ''}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-kawaii-text-muted">Markdown completo (copiable):</p>
              <pre className="max-h-80 overflow-auto text-[10px] leading-relaxed bg-[#1a1a1e] text-zinc-300 p-4 rounded-xl select-text whitespace-pre-wrap">
                {report.markdown}
              </pre>
              {report.logs?.musicTail && (report.logs.musicTail?.length ?? 0) > 0 ? (
                <>
                  <p className="text-[10px] text-kawaii-text-muted">Cola log música:</p>
                  <pre className="max-h-32 overflow-auto text-[9px] bg-black text-green-300 p-2 rounded-xl">
                    {report.logs.musicTail.join('\n')}
                  </pre>
                </>
              ) : null}
            </>
          ) : (
            <p className="text-[11px] text-kawaii-text-muted">
              Detalle oculto — pulsa «Mostrar detalle / logs».
            </p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-kawaii-text-muted border border-dashed border-kawaii-border rounded-xl p-3">
          Todavía no hay informe en memoria. Pulsa <strong>Ejecutar tests</strong> o elige una
          corrida del historial.
        </p>
      )}

      {(runs?.length ?? 0) > 0 ? (
        <div className="border-t border-kawaii-border/50 pt-2 space-y-1">
          <p className="text-[11px] font-semibold">Historial (clic = ver informe)</p>
          <ul className="text-[10px] space-y-0.5 max-h-32 overflow-y-auto">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full flex justify-between gap-2 text-left hover:bg-kawaii-pink-soft/40 rounded px-1 py-0.5"
                  onClick={() => loadRun(r.id)}
                >
                  <span>
                    {new Date(r.savedAt).toLocaleString()} · v{r.appVersion}
                  </span>
                  <span className={r.blocked ? 'text-red-700' : 'text-emerald-700'}>
                    {r.readinessPct}% · ❌{r.summary.fail}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(fbArch?.length ?? 0) > 0 ? (
        <div className="border-t border-kawaii-border/50 pt-2 space-y-1">
          <p className="text-[11px] font-semibold">Archivo de likes/dislikes</p>
          <ul className="text-[10px] space-y-1 max-h-28 overflow-y-auto">
            {fbArch.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-black/5 px-2 py-1"
              >
                <span>
                  {(a.note || a.id || 'archivo').slice(0, 48)} ·{' '}
                  {(a.entries?.length ?? 0)} ítems
                </span>
                <button
                  type="button"
                  className="text-kawaii-pink-deep underline"
                  onClick={() => {
                    restoreFeedbackArchive(a.id)
                    refreshMeta()
                  }}
                >
                  Restaurar
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
