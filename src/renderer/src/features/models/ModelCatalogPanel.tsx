/**
 * Browse / search / pull multiple local models (Ollama official, community, HF GGUF).
 */
import { useEffect, useMemo, useState } from 'react'
import {
  LOCAL_MODEL_CATALOG,
  filterCatalog,
  recommendLocalModels,
  type ModelRecommendation
} from '@core/models/recommendations'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useDownloadStore } from './downloadStore'
import { Button } from '@shared/ui/Button'

type Hw = { totalMemoryGB: number; cpuCores: number; architecture: string }

export function ModelCatalogPanel() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const upsert = useDownloadStore((s) => s.upsert)
  const [query, setQuery] = useState('')
  const [includeUncensored, setIncludeUncensored] = useState(false)
  const [source, setSource] = useState<'all' | 'ollama-official' | 'ollama-community' | 'hf-gguf'>(
    'all'
  )
  const [hw, setHw] = useState<Hw>({ totalMemoryGB: 16, cpuCores: 8, architecture: 'x64' })
  const [installed, setInstalled] = useState<string[]>([])
  const [pulling, setPulling] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

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
      try {
        const base = (settings.localBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
        const res = await fetch(`${base}/api/tags`)
        if (res.ok) {
          const data = (await res.json()) as { models?: Array<{ name?: string }> }
          const names = (data.models || []).map((m) => m.name || '').filter(Boolean)
          setInstalled(names)
        }
      } catch {
        /* ignore */
      }
    })()
  }, [settings.localBaseUrl])

  const recs = useMemo(() => recommendLocalModels(hw, installed), [hw, installed])

  const list = useMemo(
    () =>
      filterCatalog({
        profile: hw,
        query,
        includeUncensored,
        source,
        onlyCompatible: true
      }),
    [hw, query, includeUncensored, source]
  )

  const pull = async (m: ModelRecommendation) => {
    if (m.risk === 'uncensored') {
      const ok = window.confirm(
        (m.riskWarning || 'Modelo uncensored / abliterated.') +
          '\n\n¿Descargar de todos modos?\n\n' +
          m.pullName
      )
      if (!ok) return
    }
    setPulling(m.pullName)
    setMsg(`Descargando ${m.label}…`)
    upsert({
      model: m.pullName,
      status: 'Descargando…',
      progress: 0,
      state: 'running',
      kind: 'ollama'
    })
    try {
      const r = await window.kawaii?.ollamaPull?.(m.pullName, settings.localBaseUrl)
      if (r && (r as { ok?: boolean }).ok === false) {
        setMsg((r as { error?: string }).error || 'Error al descargar')
        upsert({
          model: m.pullName,
          status: 'Error',
          progress: 0,
          state: 'error',
          kind: 'ollama',
          error: (r as { error?: string }).error
        })
      } else {
        setMsg(`Listo: ${m.label}`)
        update({ localModel: m.pullName })
        upsert({
          model: m.pullName,
          status: 'Completado',
          progress: 100,
          state: 'done',
          kind: 'ollama'
        })
        setInstalled((prev) =>
          prev.includes(m.pullName) ? prev : [...prev, m.pullName]
        )
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setPulling(null)
    }
  }

  const isInstalled = (m: ModelRecommendation) =>
    installed.some(
      (n) => n === m.pullName || n.startsWith(m.pullName) || m.pullName.includes(n)
    )

  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs font-semibold text-kawaii-text">Catálogo de modelos locales</p>
        <p className="text-[11px] text-kawaii-text-muted">
          Sugeridos para tu PC: {recs.profileSummary}. Primario:{' '}
          <strong>{recs.primary.label}</strong>
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="input-kawaii text-xs flex-1 min-w-[140px]"
          placeholder="Buscar (qwen, llama, coder…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="input-kawaii text-xs w-auto"
          value={source}
          onChange={(e) => setSource(e.target.value as typeof source)}
        >
          <option value="all">Todas las fuentes</option>
          <option value="ollama-official">Ollama oficial</option>
          <option value="ollama-community">Comunidad Ollama</option>
          <option value="hf-gguf">Hugging Face GGUF</option>
        </select>
        <label className="flex items-center gap-1.5 text-[11px] text-amber-800">
          <input
            type="checkbox"
            checked={includeUncensored}
            onChange={(e) => setIncludeUncensored(e.target.checked)}
          />
          Incluir abliterados / uncensored
        </label>
      </div>

      {includeUncensored && (
        <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
          Los modelos abliterados reducen filtros de seguridad. Solo para usuarios adultos que
          entienden el riesgo. No se recomiendan como predeterminado.
        </p>
      )}

      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
        {list.length === 0 && (
          <p className="text-xs text-kawaii-text-muted">
            Ningún modelo compatible con el filtro. Prueba quitar búsqueda o incluir más RAM.
          </p>
        )}
        {list.map((m) => {
          const installedOk = isInstalled(m)
          const suggested = recs.primary.id === m.id || recs.alternatives.some((a) => a.id === m.id)
          return (
            <div
              key={m.id}
              className="border border-kawaii-border rounded-xl px-3 py-2 bg-white/70 flex flex-col gap-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold">
                    {m.label}{' '}
                    {suggested && (
                      <span className="text-[10px] text-kawaii-pink-deep font-normal">
                        · sugerido
                      </span>
                    )}
                    {m.risk === 'uncensored' && (
                      <span className="text-[10px] text-amber-700 font-normal"> · uncensored</span>
                    )}
                  </p>
                  <p className="text-[10px] text-kawaii-text-muted">
                    {m.sizeHint} · min ~{m.minRamGB} GB · {m.source}
                  </p>
                  <p className="text-[10px] text-kawaii-text-muted">{m.reason}</p>
                  <code className="text-[9px] text-kawaii-text-muted break-all">{m.pullName}</code>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {installedOk ? (
                    <Button
                      variant="ghost"
                      className="text-[10px]"
                      onClick={() => update({ localModel: m.pullName })}
                    >
                      Usar
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      className="text-[10px]"
                      disabled={pulling === m.pullName}
                      onClick={() => void pull(m)}
                    >
                      {pulling === m.pullName ? '…' : 'Descargar'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {msg && <p className="text-[11px] text-kawaii-text-muted">{msg}</p>}
      <p className="text-[10px] text-kawaii-text-muted">
        Catálogo: {LOCAL_MODEL_CATALOG.length} entradas. Las descargas usan Ollama (
        <code>ollama pull</code> / <code>hf.co/…</code>).
      </p>
    </div>
  )
}
