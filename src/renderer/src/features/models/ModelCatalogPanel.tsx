/**
 * Browse / search local + remote models.
 * Installed list comes from live discovery (Ollama + LM Studio + disk), not a hardcoded table.
 * Remote search: Ollama library + Hugging Face GGUF.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  recommendLocalModels,
  searchRemoteModels,
  scoreModelFit,
  recommendBestInstalled,
  type ModelRecommendation,
  type RemoteModelHit
} from '@core/models'
import { discoverLocalModelsFull, unifiedPullModel, bridgesFromWindow } from '@core/providers'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useDownloadStore } from './downloadStore'
import { Button } from '@shared/ui/Button'
import {
  filterCatalogRows,
  mergeCatalogSources,
  type InstallFilter
} from './model-catalog-helpers'

type Hw = { totalMemoryGB: number; cpuCores: number; architecture: string }
type ListRow = {
  key: string
  pullName: string
  label: string
  source: string
  sizeHint?: string
  reason?: string
  installed: boolean
  risk?: string
  infoUrl?: string
  canPull: boolean
  capLabels?: string[]
  paramLabel?: string
  fitScore?: number
  fitReason?: string
}

export function ModelCatalogPanel() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const upsert = useDownloadStore((s) => s.upsert)
  const [query, setQuery] = useState('')
  const [installFilter, setInstallFilter] = useState<InstallFilter>('all')
  const [includeUncensored, setIncludeUncensored] = useState(false)
  const [hw, setHw] = useState<Hw>({ totalMemoryGB: 16, cpuCores: 8, architecture: 'x64' })
  const [installed, setInstalled] = useState<Array<{ id: string; source: string }>>([])
  const [remote, setRemote] = useState<RemoteModelHit[]>([])
  const [remoteMsg, setRemoteMsg] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [pulling, setPulling] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [runtimeLabel, setRuntimeLabel] = useState('')

  const refreshInstalled = useCallback(async () => {
    try {
      const snap = await discoverLocalModelsFull({
        ollamaBaseUrl: settings.localBaseUrl,
        openAIBaseUrl: (settings.localOpenAIBaseUrl || '').trim() || undefined,
        ramGB: hw.totalMemoryGB
      })
      setInstalled(
        (snap.models || []).map((m) => ({
          id: m.id || m.name,
          source: m.source
        }))
      )
      const parts = [
        snap.ollama ? 'Ollama' : null,
        snap.openAI ? snap.openAI.label : null,
        snap.diskCount ? `disco×${snap.diskCount}` : null
      ].filter(Boolean)
      setRuntimeLabel(parts.join(' + ') || 'Sin runtime local')
      if (snap.openAI?.baseUrl && !(settings.localOpenAIBaseUrl || '').trim()) {
        update({ localOpenAIBaseUrl: snap.openAI.baseUrl })
      }
    } catch {
      setInstalled([])
      setRuntimeLabel('Detección fallida')
    }
  }, [settings.localBaseUrl, settings.localOpenAIBaseUrl, hw.totalMemoryGB, update])

  useEffect(() => {
    void (async () => {
      try {
        const p =
          (await window.kawaii?.getHardwareProfile?.()) ||
          (await window.kawaii?.machineEnsureProfile?.())
        const mem =
          (p as { totalMemoryGB?: number; memoryGB?: number; ramGB?: number }) || {}
        const gb = mem.totalMemoryGB ?? mem.memoryGB ?? mem.ramGB
        if (typeof gb === 'number' && gb > 0) {
          setHw({
            totalMemoryGB: gb,
            cpuCores: (p as { cpuCores?: number }).cpuCores || 8,
            architecture: (p as { architecture?: string }).architecture || 'x64'
          })
        }
      } catch {
        /* ignore */
      }
    })()
  }, [])

  useEffect(() => {
    void refreshInstalled()
  }, [refreshInstalled])

  // Live remote search (debounced)
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setRemote([])
      setRemoteMsg(null)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      setSearching(true)
      void searchRemoteModels(q, { limit: 20 }).then((r) => {
        if (cancelled) return
        setRemote(r.results)
        setRemoteMsg(
          r.ok
            ? r.sources.length
              ? `Búsqueda: ${r.sources.join(' + ')} (${r.results.length})`
              : 'Sin resultados remotos'
            : r.error || 'Búsqueda remota no disponible'
        )
        setSearching(false)
      })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  const installedIds = useMemo(
    () => installed.map((x) => x.id.toLowerCase()),
    [installed]
  )

  const isInstalledName = useCallback(
    (name: string) => {
      const n = name.toLowerCase()
      return installedIds.some(
        (i) => i === n || i.startsWith(n) || n.startsWith(i) || i.includes(n) || n.includes(i)
      )
    },
    [installedIds]
  )

  const recs = useMemo(
    () => recommendLocalModels(hw, installed.map((x) => x.id)),
    [hw, installed]
  )

  const rows: ListRow[] = useMemo(() => {
    const out: ListRow[] = []
    const seen = new Set<string>()

    // 1) Always show installed first (from live discovery)
    for (const m of installed) {
      const key = m.id.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (query.trim()) {
        const hay = m.id.toLowerCase()
        if (!hay.includes(query.trim().toLowerCase())) continue
      }
      out.push({
        key: `inst-${m.id}`,
        pullName: m.id,
        label: m.id,
        source: m.source,
        installed: true,
        canPull: false,
        reason: 'Instalado en este equipo'
      })
    }

    // 2) Remote search hits
    for (const r of remote) {
      const key = r.pullName.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (!includeUncensored && /abliterat|uncensor|unfiltered/i.test(r.pullName + r.label)) {
        continue
      }
      const inst = isInstalledName(r.pullName) || isInstalledName(r.label)
      out.push({
        key: r.id,
        pullName: r.pullName,
        label: r.label,
        source: r.source,
        sizeHint: r.sizeHint,
        installed: inst,
        canPull: r.source === 'ollama-library' || r.source === 'huggingface-gguf',
        infoUrl: r.infoUrl,
        reason: r.downloads ? `~${r.downloads.toLocaleString()} descargas` : undefined
      })
    }

    // 3) Offline seed suggestions only when no query (hardware hints) — not the full list
    if (!query.trim() && remote.length === 0) {
      const seed: ModelRecommendation[] = [recs.primary, ...recs.alternatives].filter(Boolean)
      for (const m of seed) {
        if (!includeUncensored && m.risk === 'uncensored') continue
        const key = m.pullName.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          key: m.id,
          pullName: m.pullName,
          label: m.label,
          source: m.source,
          sizeHint: m.sizeHint,
          reason: m.reason,
          installed: isInstalledName(m.pullName),
          canPull: true,
          risk: m.risk,
          infoUrl: m.infoUrl
        })
      }
    }

    return out.filter((row) => {
      if (installFilter === 'installed') return row.installed
      if (installFilter === 'not-installed') return !row.installed
      return true
    })
  }, [installed, remote, query, includeUncensored, installFilter, recs, isInstalledName])

  const rowsWithCaps: ListRow[] = useMemo(() => {
    return rows.map((row) => {
      const fit = scoreModelFit(row.pullName, {
        ramGB: hw.totalMemoryGB,
        prefer: 'balanced'
      })
      return {
        ...row,
        capLabels: fit.labels,
        paramLabel: fit.paramLabel,
        fitScore: fit.fitScore,
        fitReason: fit.fitReason,
        reason: row.reason || fit.fitReason
      }
    }).sort((a, b) => {
      // Best fit first among installed, then by fit score
      if (a.installed !== b.installed) return a.installed ? -1 : 1
      return (b.fitScore || 0) - (a.fitScore || 0)
    })
  }, [rows, hw.totalMemoryGB])

  const bestPick = useMemo(
    () =>
      recommendBestInstalled(
        installed.map((x) => x.id),
        { ramGB: hw.totalMemoryGB, prefer: 'balanced' }
      ),
    [installed, hw.totalMemoryGB]
  )

  const pull = async (pullName: string, label: string) => {
    if (/abliterat|uncensor/i.test(pullName) && !includeUncensored) {
      const ok = window.confirm(
        'Este nombre parece uncensored/abliterated. ¿Descargar de todos modos?\n\n' + pullName
      )
      if (!ok) return
    }
    setPulling(pullName)
    setMsg(`Adquiriendo ${label}…`)
    upsert({
      model: pullName,
      status: 'Descargando…',
      progress: 0,
      state: 'running',
      kind: 'ollama'
    })
    try {
      const r = await unifiedPullModel({
        model: pullName,
        ollamaBaseUrl: settings.localBaseUrl,
        openAIBaseUrl: (settings.localOpenAIBaseUrl || '').trim() || undefined,
        tryStartOllama: true,
        bridges: bridgesFromWindow()
      })
      if (r.acquired && r.ok) {
        setMsg(r.summary)
        if (r.activeModel) update({ localModel: r.activeModel, localModelPinned: true })
        else update({ localModel: r.ollamaRef || pullName, localModelPinned: true })
        upsert({
          model: pullName,
          status: 'Completado / en curso',
          progress: 100,
          state: 'done',
          kind: 'ollama'
        })
        await refreshInstalled()
      } else if (r.ok && !r.acquired) {
        // LM Studio guidance path
        setMsg(r.summary + (r.nextStep ? ' · ' + r.nextStep : ''))
        upsert({
          model: pullName,
          status: 'Guía LM Studio / manual',
          progress: 0,
          state: 'done',
          kind: 'ollama'
        })
      } else {
        setMsg(r.summary)
        upsert({
          model: pullName,
          status: 'Error / ver mensaje',
          progress: 0,
          state: 'error',
          kind: 'ollama',
          error: r.summary
        })
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setPulling(null)
    }
  }

  const useModel = (id: string) => {
    update({ localModel: id, localModelPinned: true })
    setMsg(`Modelo fijo: ${id} (Auto lo respeta hasta que pulses Auto)`)
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs font-semibold text-kawaii-text">Modelos locales</p>
        <p className="text-[11px] text-kawaii-text-muted">
          Runtime: {runtimeLabel || '…'} · PC: {recs.profileSummary}
        </p>
        <p className="text-[11px] text-kawaii-text-muted">
          Instalados detectados: <strong>{installed.length}</strong>
          {recs.primary ? (
            <>
              {' '}
              · sugerido: <strong>{recs.primary.label}</strong>
            </>
          ) : null}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="input-kawaii text-xs flex-1 min-w-[140px]"
          placeholder="Buscar en Ollama / Hugging Face (qwen, llama…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="input-kawaii text-xs w-auto"
          value={installFilter}
          onChange={(e) => setInstallFilter(e.target.value as InstallFilter)}
        >
          <option value="all">Todos</option>
          <option value="installed">Solo instalados</option>
          <option value="not-installed">Solo no instalados</option>
        </select>
        <Button
          variant="ghost"
          className="text-[10px]"
          onClick={() => void refreshInstalled()}
        >
          Actualizar
        </Button>
        <label className="flex items-center gap-1.5 text-[11px] text-amber-800">
          <input
            type="checkbox"
            checked={includeUncensored}
            onChange={(e) => setIncludeUncensored(e.target.checked)}
          />
          Incluir uncensored
        </label>
      </div>

      {bestPick && (
        <p className="text-[11px] text-emerald-800 bg-emerald-50/80 border border-emerald-100 rounded-lg px-2 py-1">
          Mejor para tu equipo ({hw.totalMemoryGB} GB RAM):{' '}
          <strong>{bestPick.id}</strong>
          {bestPick.info.labels.length
            ? ` · ${bestPick.info.labels.join(', ')}`
            : ''}{' '}
          · fit {bestPick.info.fitScore} — {bestPick.info.fitReason}
          <button
            type="button"
            className="ml-2 underline text-[10px]"
            onClick={() => useModel(bestPick.id)}
          >
            Usar
          </button>
        </p>
      )}
      {searching && (
        <p className="text-[10px] text-kawaii-text-muted">Buscando modelos remotos…</p>
      )}
      {remoteMsg && !searching && (
        <p className="text-[10px] text-kawaii-text-muted">{remoteMsg}</p>
      )}

      <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
        {rowsWithCaps.length === 0 && (
          <p className="text-xs text-kawaii-text-muted">
            {query.trim().length >= 2
              ? 'Sin resultados. Prueba otro término o revisa la red.'
              : installFilter === 'installed'
                ? 'No hay modelos instalados detectados. Abre Ollama o LM Studio Server, o descarga uno.'
                : 'Escribe al menos 2 letras para buscar, o instala un modelo local.'}
          </p>
        )}
        {rowsWithCaps.map((m) => (
          <div
            key={m.key}
            className="border border-kawaii-border rounded-xl px-3 py-2 bg-white/70 flex flex-col gap-1"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">
                  {m.label}{' '}
                  {m.paramLabel && (
                    <span className="text-[10px] text-violet-700 font-normal">· {m.paramLabel}</span>
                  )}
                  {m.installed && (
                    <span className="text-[10px] text-emerald-700 font-normal">· instalado</span>
                  )}
                  {m.risk === 'uncensored' && (
                    <span className="text-[10px] text-amber-700 font-normal"> · uncensored</span>
                  )}
                </p>
                {(m.capLabels?.length || m.fitScore != null) && (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {m.capLabels?.map((c) => (
                      <span
                        key={c}
                        className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-100"
                      >
                        {c}
                      </span>
                    ))}
                    {m.fitScore != null && (
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                          m.fitScore >= 70
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
                            : m.fitScore >= 45
                              ? 'bg-amber-50 text-amber-900 border-amber-100'
                              : 'bg-rose-50 text-rose-800 border-rose-100'
                        }`}
                        title={m.fitReason || ''}
                      >
                        Fit {m.fitScore}
                      </span>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-kawaii-text-muted">
                  {m.sizeHint ? `${m.sizeHint} · ` : ''}
                  {m.source}
                  {settings.localModel === m.pullName ? ' · activo' : ''}
                </p>
                {m.reason && (
                  <p className="text-[10px] text-kawaii-text-muted">{m.reason}</p>
                )}
                <code className="text-[9px] text-kawaii-text-muted break-all">{m.pullName}</code>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                {m.installed ? (
                  <Button
                    variant="ghost"
                    className="text-[10px]"
                    onClick={() => useModel(m.pullName)}
                  >
                    Usar
                  </Button>
                ) : m.canPull ? (
                  <Button
                    variant="ghost"
                    className="text-[10px]"
                    disabled={pulling === m.pullName}
                    onClick={() => void pull(m.pullName, m.label)}
                  >
                    {pulling === m.pullName ? '…' : 'Descargar'}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    className="text-[10px]"
                    onClick={() => useModel(m.pullName)}
                  >
                    Elegir
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {msg && <p className="text-[11px] text-kawaii-text-muted">{msg}</p>}
      <p className="text-[10px] text-kawaii-text-muted">
        La lista de instalados sale de Ollama, LM Studio y carpetas en disco. La búsqueda remota
        consulta Ollama Library y Hugging Face (GGUF). Descarga vía Ollama cuando está disponible;
        modelos solo en LM Studio se eligen con «Usar» si ya están cargados en el servidor.
      </p>
    </div>
  )
}
