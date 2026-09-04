import { useCallback, useEffect, useState } from 'react'
import { useDownloadStore } from './downloadStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { Loader2, CheckCircle2, AlertCircle, Pause, Download } from 'lucide-react'

type Installed = { id: string; filename: string; sizeBytes: number }
type Recovery = {
  id: string
  label: string
  status: string
  pct: number
  error?: string
}

/**
 * Live inventory: installed / downloading / failed SD (+ download bar jobs).
 * Polls main process so UI matches disk even if a job died.
 */
export function ModelsStatusPanel({ compact }: { compact?: boolean }) {
  const ui = useSettingsStore((s) => s.settings.uiComplexity || 'smart')
  const jobs = useDownloadStore((s) => s.jobs)
  const upsert = useDownloadStore((s) => s.upsert)
  const [installed, setInstalled] = useState<Installed[]>([])
  const [recovery, setRecovery] = useState<Recovery[]>([])
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const [inst, rec] = await Promise.all([
        window.kawaii?.sdListInstalled?.(),
        window.kawaii?.sdListRecovery?.()
      ])
      if (inst?.ok && inst.models) {
        setInstalled(
          inst.models.map((m) => ({
            id: m.id,
            filename: m.filename,
            sizeBytes: m.sizeBytes
          }))
        )
      }
      if (rec?.ok && rec.jobs) {
        setRecovery(rec.jobs)
        const installedSet = new Set(
          (inst?.models || []).map((m: { id: string }) => m.id)
        )
        for (const j of rec.jobs) {
          const model = `SD:${j.id}`
          if (installedSet.has(j.id)) {
            useDownloadStore.getState().remove(model)
            continue
          }
          const prev = useDownloadStore.getState().jobs[model]
          if (prev?.state === 'running') continue
          if (prev === undefined && (j.status === 'failed' || j.status === 'cancelled')) {
            // Don't re-resurrect discarded failures into the bar
            continue
          }
          const state =
            j.status === 'failed' || j.status === 'cancelled'
              ? 'error'
              : j.status === 'downloading'
                ? 'paused' // require explicit Continuar; avoid fake running
                : 'paused'
          upsert({
            model,
            status:
              state === 'error'
                ? j.error || `Falló · ${Math.round(j.pct)}%`
                : `En disco · ${j.status} · ${Math.round(j.pct)}%`,
            progress: j.pct,
            state,
            kind: 'sd',
            error: j.error
          })
        }
      }
      try {
        const base =
          useSettingsStore.getState().settings.localBaseUrl || 'http://localhost:11434'
        const r = await fetch(`${base.replace(/\/$/, '')}/api/tags`, {
          signal: AbortSignal.timeout(2500)
        })
        if (r.ok) {
          const data = (await r.json()) as { models?: Array<{ name: string }> }
          setOllamaModels((data.models || []).map((m) => m.name))
        }
      } catch {
        /* ollama offline ok */
      }
    } finally {
      setBusy(false)
    }
  }, [upsert])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => {
      setTick((t) => t + 1)
      void refresh()
    }, 4000)
    return () => window.clearInterval(id)
  }, [refresh])

  const dlActive = Object.values(jobs).filter(
    (j) => j.state === 'running' || j.state === 'paused' || j.state === 'error'
  )
  const installedIds = new Set(installed.map((i) => i.id))

  if (compact) {
    const nInst = installed.length
    const nRun = dlActive.filter((j) => j.state === 'running').length
    const nFail = dlActive.filter((j) => j.state === 'error').length
    return (
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-kawaii-text-muted px-1">
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <CheckCircle2 className="w-3 h-3" /> {nInst} SD instalado{nInst === 1 ? '' : 's'}
        </span>
        {nRun > 0 && (
          <span className="inline-flex items-center gap-1 text-kawaii-pink-deep">
            <Loader2 className="w-3 h-3 animate-spin" /> {nRun} descargando
          </span>
        )}
        {nFail > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <AlertCircle className="w-3 h-3" /> {nFail} con error
          </span>
        )}
        {ollamaModels.length > 0 && (
          <span className="text-kawaii-text-muted">· Ollama: {ollamaModels.length}</span>
        )}
        <button
          type="button"
          className="text-kawaii-pink-deep hover:underline ml-auto"
          onClick={() => void refresh()}
        >
          {busy ? '…' : 'Actualizar'}
        </button>
        <span className="opacity-50">#{tick}</span>
      </div>
    )
  }

  return (
    <div className="rounded-kawaii border border-kawaii-border bg-white/90 p-2 space-y-2 text-[11px]">
      <div className="flex items-center gap-2">
        <p className="font-semibold text-kawaii-text">Estado de modelos (en vivo)</p>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-kawaii-border text-kawaii-text-muted">
          UI {ui === 'advanced' ? 'Avanzado' : 'Smart'}
        </span>
        <button
          type="button"
          className="text-kawaii-pink-deep hover:underline ml-auto text-[10px]"
          onClick={() => void refresh()}
        >
          {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/80 p-2 space-y-1">
          <p className="font-semibold text-emerald-800 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Instalados
          </p>
          {installed.length === 0 ? (
            <p className="text-emerald-900/70">Ningún checkpoint SD en disco aún</p>
          ) : (
            installed.map((m) => (
              <p key={`inst-${m.id}`} className="text-emerald-900 truncate">
                ✓ {m.id}{' '}
                <span className="opacity-70">({(m.sizeBytes / 1e9).toFixed(1)} GB)</span>
              </p>
            ))
          )}
          {ollamaModels.length > 0 && (
            <p className="text-emerald-900/80 pt-1 border-t border-emerald-100 mt-1">
              Ollama: {ollamaModels.slice(0, 4).join(', ')}
              {ollamaModels.length > 4 ? ` +${ollamaModels.length - 4}` : ''}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-pink-100 bg-kawaii-pink-soft/40 p-2 space-y-1">
          <p className="font-semibold text-kawaii-pink-deep flex items-center gap-1">
            <Download className="w-3.5 h-3.5" /> En curso / pausa
          </p>
          {dlActive.filter((j) => j.state !== 'error').length === 0 ? (
            <p className="text-kawaii-text-muted">Sin descargas activas</p>
          ) : (
            dlActive
              .filter((j) => j.state !== 'error')
              .map((j) => (
                <div key={`run-${j.model}`} className="space-y-0.5">
                  <p className="truncate font-medium">
                    {j.state === 'paused' ? (
                      <Pause className="w-3 h-3 inline mr-0.5 text-amber-600" />
                    ) : (
                      <Loader2 className="w-3 h-3 inline mr-0.5 animate-spin" />
                    )}
                    {j.model}
                  </p>
                  <p className="text-[10px] text-kawaii-text-muted truncate">
                    {j.status}
                    {j.progress != null ? ` · ${Math.round(j.progress)}%` : ''}
                  </p>
                  {j.progress != null && (
                    <div className="h-1 rounded-full bg-kawaii-border overflow-hidden">
                      <div
                        className="h-full bg-kawaii-pink-deep"
                        style={{ width: `${Math.min(100, j.progress)}%` }}
                      />
                    </div>
                  )}
                </div>
              ))
          )}
          {recovery
            .filter((r) => !installedIds.has(r.id) && r.status === 'downloading')
            .map((r) => (
              <p key={`rec-${r.id}`} className="text-[10px] text-kawaii-text-muted">
                Disco: {r.label} · {Math.round(r.pct)}%
              </p>
            ))}
        </div>

        <div className="rounded-lg border border-amber-100 bg-amber-50/80 p-2 space-y-1">
          <p className="font-semibold text-amber-900 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" /> Fallidos / incompletos
          </p>
          {dlActive.filter((j) => j.state === 'error').length === 0 &&
          recovery.filter((r) => r.status === 'failed' || r.status === 'paused').length ===
            0 ? (
            <p className="text-amber-900/70">Ninguno</p>
          ) : (
            <>
              {dlActive
                .filter((j) => j.state === 'error')
                .map((j) => (
                  <p key={`err-${j.model}`} className="text-amber-900 truncate" title={j.error}>
                    ✕ {j.model}: {j.error || j.status}
                  </p>
                ))}
              {recovery
                .filter((r) => r.status === 'failed' || r.status === 'paused')
                .map((r) => (
                  <p key={`rf-${r.id}`} className="text-amber-900 truncate">
                    {r.label} · {r.status} · {Math.round(r.pct)}%
                  </p>
                ))}
            </>
          )}
          <p className="text-[10px] text-amber-800/80 pt-1">
            Usa <strong>Continuar</strong> en la barra inferior para recovery.
          </p>
        </div>
      </div>
    </div>
  )
}
