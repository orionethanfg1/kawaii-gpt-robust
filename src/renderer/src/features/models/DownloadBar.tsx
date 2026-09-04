import { useEffect, useMemo, useRef } from 'react'
import { Loader2, Pause, Play, X, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { useDownloadStore } from './downloadStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

/**
 * Single compact download strip — does not steal the whole chat area.
 * Reconciles with disk: installed → remove; 404 permanent → mark error + dismiss option.
 */
export function DownloadBar() {
  const jobsMap = useDownloadStore((s) => s.jobs)
  const remove = useDownloadStore((s) => s.remove)
  const dismiss = useDownloadStore((s) => s.dismiss)
  const clearErrors = useDownloadStore((s) => s.clearErrors)
  const markPaused = useDownloadStore((s) => s.markPaused)
  const upsert = useDownloadStore((s) => s.upsert)
  const collapsed = useDownloadStore((s) => s.barCollapsed)
  const setBarCollapsed = useDownloadStore((s) => s.setBarCollapsed)
  const localUrl = useSettingsStore((s) => s.settings.localBaseUrl)
  const stuckRef = useRef<Record<string, { pct: number; since: number }>>({})

  const active = useMemo(() => {
    const list = Object.values(jobsMap)
      .filter(
        (j) =>
          !j.dismissed &&
          (j.state === 'running' || j.state === 'paused' || j.state === 'error')
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const seen = new Set<string>()
    return list.filter((j) => {
      if (seen.has(j.model)) return false
      seen.add(j.model)
      return true
    })
  }, [jobsMap])

  // Restore Ollama pull recovery jobs
  useEffect(() => {
    void (async () => {
      try {
        const r = await window.kawaii?.ollamaListPullJobs?.()
        if (!r?.ok || !r.jobs) return
        for (const j of r.jobs) {
          if (j.status === 'done') continue
          upsert({
            model: j.model,
            status:
              j.status === 'error'
                ? (j.error || 'Error · Continuar reanuda')
                : `Recovery · ${j.status}`,
            progress: j.progress || 0,
            state: j.status === 'error' ? 'error' : j.status === 'running' ? 'running' : 'paused',
            kind: 'ollama'
          })
        }
      } catch {
        /* ignore */
      }
    })()
  }, [upsert])

  // Reconcile with real disk every 8s
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const inst = await window.kawaii?.sdListInstalled?.()
        if (cancelled || !inst?.ok) return
        const ids = new Set((inst.models || []).map((m) => m.id))
        for (const j of Object.values(useDownloadStore.getState().jobs)) {
          if (j.kind !== 'sd' && !j.model.startsWith('SD:')) continue
          const id = j.model.replace(/^SD:/, '')
          if (ids.has(id)) {
            // Fully installed → clear bar entry
            useDownloadStore.getState().remove(j.model)
          }
        }
        // Recovery: if no disk job and error is 404, keep dismissable
        const rec = await window.kawaii?.sdListRecovery?.()
        if (rec?.ok) {
          const recIds = new Set((rec.jobs || []).map((x) => x.id))
          for (const j of Object.values(useDownloadStore.getState().jobs)) {
            if (j.kind !== 'sd' && !j.model.startsWith('SD:')) continue
            const id = j.model.replace(/^SD:/, '')
            if (j.state === 'error' && !recIds.has(id) && !ids.has(id)) {
              // Ghost error (no partial on disk) — safe to auto-dismiss after age
              if (Date.now() - j.updatedAt > 60_000) {
                useDownloadStore.getState().dismiss(j.model)
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 8000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  // Detect stuck progress (same % > 3 min while "running")
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now()
      for (const j of Object.values(useDownloadStore.getState().jobs)) {
        if (j.state !== 'running' || j.progress == null) continue
        const prev = stuckRef.current[j.model]
        if (!prev || Math.abs(prev.pct - j.progress) > 0.5) {
          stuckRef.current[j.model] = { pct: j.progress, since: now }
          continue
        }
        if (now - prev.since > 180_000) {
          useDownloadStore.getState().upsert({
            model: j.model,
            state: 'error',
            status: 'Atascado sin progreso',
            error:
              'Sin avance ~3 min. Revisa red o pulsa Reiniciar (borra parcial y vuelve a bajar).',
            progress: j.progress
          })
        }
      }
    }, 30_000)
    return () => window.clearInterval(id)
  }, [])

  if (active.length === 0) return null

  const nRun = active.filter((j) => j.state === 'running').length
  const nErr = active.filter((j) => j.state === 'error').length
  const nPause = active.filter((j) => j.state === 'paused').length

  const pause = async (model: string) => {
    const job = jobsMap[model]
    if (job?.kind === 'sd' || model.startsWith('SD:')) {
      await window.kawaii?.sdPauseDownload?.()
      markPaused(model)
      return
    }
    if (job?.kind === 'forge' || model.toLowerCase().includes('forge')) {
      await window.kawaii?.forgePauseInstall?.()
      markPaused(model)
      return
    }
    await window.kawaii?.ollamaPullCancel?.(model)
    markPaused(model)
  }

  const resume = async (model: string) => {
    const job = jobsMap[model]
    if (job?.kind === 'sd' || model.startsWith('SD:')) {
      const id = model.replace(/^SD:/, '')
      upsert({ model, state: 'running', status: 'Reanudando SD…', dismissed: false })
      void window.kawaii?.sdDownloadCheckpoint?.(id).then((r) => {
        if (r && 'ok' in r && r.ok) {
          upsert({ model, state: 'done', progress: 100, status: 'Completado' })
          window.setTimeout(() => remove(model), 3000)
        } else {
          upsert({
            model,
            state: 'error',
            error: (r && 'error' in r && r.error) || 'Error',
            status: 'Error al reanudar'
          })
        }
      })
      return
    }
    if (job?.kind === 'forge' || model.startsWith('Forge:')) {
      upsert({ model, state: 'running', status: 'Reanudando Forge…', dismissed: false })
      void window.kawaii?.forgeInstall?.().then((r) => {
        if (r && (r as { ok?: boolean }).ok) {
          upsert({ model, state: 'done', progress: 100, status: 'Forge listo' })
          window.setTimeout(() => remove(model), 4000)
        } else {
          upsert({
            model,
            state: 'error',
            status: 'Error Forge',
            error: (r as { error?: string })?.error || 'falló'
          })
        }
      })
      return
    }
    upsert({ model, state: 'running', status: 'Reanudando…', progress: undefined })
    void window.kawaii?.ollamaPull?.(model, localUrl).then((result) => {
      if (!result) return
      if (result.cancelled) {
        markPaused(model)
        return
      }
      if (result.ok) {
        upsert({ model, state: 'done', status: 'Listo', progress: 100 })
        setTimeout(() => remove(model), 3000)
      } else {
        upsert({
          model,
          state: 'error',
          status: 'Error',
          error: result.error
        })
      }
    })
  }

  /** Remove from UI + clear partial on disk (SD) */
  const discard = async (model: string) => {
    const job = jobsMap[model]
    if (job?.kind === 'sd' || model.startsWith('SD:')) {
      const id = model.replace(/^SD:/, '')
      await window.kawaii?.sdDiscardJob?.(id)
    }
    dismiss(model)
  }

  const restart = async (model: string) => {
    const job = jobsMap[model]
    if (job?.kind === 'sd' || model.startsWith('SD:')) {
      const id = model.replace(/^SD:/, '')
      await window.kawaii?.sdDiscardJob?.(id)
      upsert({
        model,
        state: 'running',
        status: 'Reiniciando descarga…',
        progress: 0,
        error: undefined,
        dismissed: false
      })
      void window.kawaii?.sdDownloadCheckpoint?.(id).then((r) => {
        if (r && 'ok' in r && r.ok) {
          upsert({ model, state: 'done', progress: 100, status: 'Completado' })
          window.setTimeout(() => remove(model), 3000)
        } else {
          upsert({
            model,
            state: 'error',
            error: (r && 'error' in r && r.error) || 'Error',
            status: 'Falló al reiniciar'
          })
        }
      })
      return
    }
    void resume(model)
  }

  return (
    <div className="border-t border-kawaii-border bg-kawaii-pink-soft/50 px-2 py-1 shrink-0 max-h-[28vh] overflow-y-auto">
      <div className="flex items-center gap-2 text-[10px] text-kawaii-text-muted">
        <button
          type="button"
          className="flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-kawaii-text"
          onClick={() => setBarCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          Descargas
        </button>
        <span>
          {nRun > 0 && `${nRun} activa${nRun > 1 ? 's' : ''}`}
          {nPause > 0 && ` · ${nPause} pausa`}
          {nErr > 0 && ` · ${nErr} error`}
        </span>
        {nErr > 0 && (
          <button
            type="button"
            className="text-amber-800 hover:underline ml-1"
            onClick={() => clearErrors()}
            title="Quitar errores de la barra (no borra archivos a menos que uses Descartar)"
          >
            Limpiar errores
          </button>
        )}
        <button
          type="button"
          className="ml-auto text-kawaii-text-muted hover:text-kawaii-text"
          onClick={() => setBarCollapsed(!collapsed)}
        >
          {collapsed ? 'Expandir' : 'Minimizar'}
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-1 mt-1">
          {active.map((j) => (
            <div
              key={`dl-${j.kind || 'job'}-${j.model}`}
              className="flex items-center gap-1.5 text-xs bg-white/90 rounded-lg border border-kawaii-border px-2 py-1"
            >
              {j.state === 'running' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-kawaii-pink-deep shrink-0" />
              ) : (
                <Pause className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-kawaii-text truncate text-[11px]">
                  {j.model}
                  <span
                    className={`ml-1 text-[9px] px-1 rounded ${
                      j.state === 'running'
                        ? 'bg-pink-100 text-kawaii-pink-deep'
                        : j.state === 'error'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {j.state === 'running'
                      ? 'descargando'
                      : j.state === 'error'
                        ? 'falló'
                        : 'pausado'}
                  </span>
                </p>
                <p className="text-[10px] text-kawaii-text-muted truncate">
                  {j.error || j.status}
                  {j.progress != null ? ` · ${Math.round(j.progress)}%` : ''}
                </p>
                {j.progress != null && j.state === 'running' && (
                  <div className="h-1 mt-0.5 rounded-full bg-kawaii-border overflow-hidden">
                    <div
                      className="h-full bg-kawaii-pink-deep transition-all"
                      style={{ width: `${Math.min(100, j.progress)}%` }}
                    />
                  </div>
                )}
              </div>
              {j.state === 'running' ? (
                <button
                  type="button"
                  className="text-[10px] font-semibold text-kawaii-pink-deep hover:underline shrink-0"
                  onClick={() => void pause(j.model)}
                >
                  Pausar
                </button>
              ) : (
                <button
                  type="button"
                  className="text-[10px] font-semibold text-green-700 hover:underline shrink-0 flex items-center gap-0.5"
                  onClick={() => void resume(j.model)}
                >
                  <Play className="w-3 h-3" />
                  Continuar
                </button>
              )}
              {(j.state === 'error' || j.state === 'paused') && (
                <button
                  type="button"
                  className="text-[10px] text-amber-800 hover:underline shrink-0"
                  onClick={() => void restart(j.model)}
                  title="Borra el parcial y descarga de nuevo"
                >
                  Reiniciar
                </button>
              )}
              <button
                type="button"
                className="p-0.5 text-kawaii-text-muted hover:text-red-600 shrink-0"
                title="Descartar de la barra (y borrar parcial SD si existe)"
                onClick={() => void discard(j.model)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="p-0.5 text-kawaii-text-muted hover:text-kawaii-text shrink-0"
                title="Ocultar"
                onClick={() => dismiss(j.model)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
