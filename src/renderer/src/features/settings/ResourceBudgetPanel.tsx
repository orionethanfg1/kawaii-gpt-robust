/**
 * Hito 2.3 — UI de presupuesto de recursos (RAM/VRAM estimado + capas).
 * Host-owned; actions: unload LLM, stop Forge, stop music.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  buildLedger,
  canAdmit,
  computeBudgetGB,
  freeEstimateGB,
  LAYER_DEFAULT_ESTIMATE_GB,
  type ResourceLedger
} from '@core/resources'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { Button } from '@shared/ui/Button'
import {
  withActivity,
  activitySuccess,
  activityError,
  activityInfo
} from '@shared/lib/stores/activityStore'
import { Cpu, HardDrive, RefreshCw, Loader2 } from 'lucide-react'

type LayerState = {
  forge: string
  forgeUrl: string | null
  music: boolean
  musicDetail: string
  ollamaLoaded: string[]
  unloadDetail: string | null
}

function barColor(pct: number): string {
  if (pct >= 90) return 'bg-rose-500'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-emerald-500'
}

export function ResourceBudgetPanel() {
  const settings = useSettingsStore((s) => s.settings)
  const [ledger, setLedger] = useState<ResourceLedger | null>(null)
  const [layers, setLayers] = useState<LayerState>({
    forge: '…',
    forgeUrl: null,
    music: false,
    musicDetail: '',
    ollamaLoaded: [],
    unloadDetail: null
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [admit, setAdmit] = useState<{ forge: string; music: string; llm: string } | null>(null)

  const refresh = useCallback(async () => {
    let ramGB = 16
    let vramGB: number | null = null
    let hasDiscreteGpu: boolean | null = null
    try {
      const p = await window.kawaii?.machineEnsureProfile?.()
      const prof = (
        p as {
          profile?: {
            totalMemoryGB?: number
            vramGB?: number | null
            hasDiscreteGpu?: boolean | null
          }
        }
      )?.profile
      if (typeof prof?.totalMemoryGB === 'number' && prof.totalMemoryGB > 0) {
        ramGB = prof.totalMemoryGB
      }
      if (typeof prof?.vramGB === 'number') vramGB = prof.vramGB
      if (typeof prof?.hasDiscreteGpu === 'boolean') hasDiscreteGpu = prof.hasDiscreteGpu
    } catch {
      /* defaults */
    }

    let forgeState = 'unknown'
    let forgeUrl: string | null = null
    try {
      const f = await window.kawaii?.forgeStatus?.()
      forgeState = (f as { state?: string })?.state || 'unknown'
      forgeUrl = (f as { baseUrl?: string })?.baseUrl || null
    } catch {
      forgeState = 'error'
    }

    let musicRunning = false
    let musicDetail = ''
    try {
      const ms = await window.kawaii?.musicStatus?.()
      musicRunning =
        Boolean((ms as { running?: boolean })?.running) ||
        String((ms as { state?: string })?.state || '') === 'running'
      musicDetail = String(
        (ms as { detail?: string; message?: string })?.detail ||
          (ms as { message?: string })?.message ||
          ''
      )
    } catch {
      /* ignore */
    }

    let ollamaLoaded: string[] = []
    try {
      const base = (settings.localBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')
      const res = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(3_000) })
      if (res.ok) {
        const json = (await res.json()) as { models?: Array<{ name?: string; model?: string }> }
        ollamaLoaded = (json.models || [])
          .map((m) => (m.name || m.model || '').trim())
          .filter(Boolean)
      }
    } catch {
      /* Ollama down */
    }

    const led = buildLedger({
      ramGB,
      vramGB,
      hasDiscreteGpu,
      forgeState,
      musicRunning,
      localModel: settings.localModel,
      // If Ollama reports resident models, bias used estimate upward
      extraUsedGB: ollamaLoaded.length
        ? Math.min(8, ollamaLoaded.length * 2)
        : 0
    })
    // Mark large LLM if any resident is large or settings say so
    if (ollamaLoaded.length && !led.largeLlmResident) {
      led.notes = [...(led.notes || []), `Ollama residente: ${ollamaLoaded.join(', ')}`]
    }

    setLedger(led)
    setLayers({
      forge: forgeState,
      forgeUrl,
      music: musicRunning,
      musicDetail,
      ollamaLoaded,
      unloadDetail: null
    })

    const forgeAdmit = canAdmit(led, {
      layer: 'forge',
      estimateGB: LAYER_DEFAULT_ESTIMATE_GB.forge
    })
    const musicAdmit = canAdmit(led, {
      layer: 'music',
      estimateGB: LAYER_DEFAULT_ESTIMATE_GB.music
    })
    const llmAdmit = canAdmit(led, {
      layer: 'llm',
      estimateGB: LAYER_DEFAULT_ESTIMATE_GB.llm
    })
    setAdmit({
      forge: forgeAdmit.ok ? `OK — ${forgeAdmit.reason}` : forgeAdmit.reason,
      music: musicAdmit.ok ? `OK — ${musicAdmit.reason}` : musicAdmit.reason,
      llm: llmAdmit.ok ? `OK — ${llmAdmit.reason}` : llmAdmit.reason
    })
  }, [settings.localBaseUrl, settings.localModel])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 12_000)
    return () => window.clearInterval(t)
  }, [refresh])

  const runAction = async (id: string, fn: () => Promise<void>) => {
    setBusy(id)
    setMsg(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!ledger) {
    return (
      <div className="rounded-kawaii border border-kawaii-border bg-white/70 p-3 text-xs text-kawaii-text-muted flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Calculando presupuesto de recursos…
      </div>
    )
  }

  const budget = computeBudgetGB(ledger)
  const free = freeEstimateGB(ledger)
  const usedPct = budget > 0 ? Math.min(100, (ledger.usedEstimateGB / budget) * 100) : 0

  return (
    <div className="rounded-kawaii border border-kawaii-border bg-white/70 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-sm text-kawaii-text flex items-center gap-1.5">
            <Cpu className="w-4 h-4" />
            Presupuesto de recursos
          </h3>
          <p className="text-[11px] text-kawaii-text-muted">
            Estimación host (no mide VRAM real al 100%). Sirve para decidir si cabe Forge / ACE /
            un LLM grande.
          </p>
        </div>
        <Button
          variant="ghost"
          className="text-[10px] shrink-0"
          disabled={busy !== null}
          onClick={() => void runAction('refresh', refresh)}
        >
          <RefreshCw className={`w-3 h-3 mr-1 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg border border-kawaii-border/80 bg-black/[0.03] px-2 py-1.5">
          <div className="flex items-center gap-1 text-kawaii-text-muted">
            <HardDrive className="w-3 h-3" /> RAM sistema
          </div>
          <p className="font-semibold text-kawaii-text">~{ledger.ramGB} GB</p>
        </div>
        <div className="rounded-lg border border-kawaii-border/80 bg-black/[0.03] px-2 py-1.5">
          <div className="text-kawaii-text-muted">VRAM / GPU</div>
          <p className="font-semibold text-kawaii-text">
            {ledger.vramGB != null ? `~${ledger.vramGB} GB` : '—'}
            {ledger.hasDiscreteGpu ? ' · dedicada' : ' · integrada/desconocida'}
          </p>
        </div>
      </div>

      <div>
        <div className="flex justify-between text-[10px] text-kawaii-text-muted mb-0.5">
          <span>
            Usado ~{ledger.usedEstimateGB.toFixed(1)} / presupuesto ~{budget.toFixed(1)} GB
          </span>
          <span>Libre ~{free.toFixed(1)} GB</span>
        </div>
        <div className="h-2 rounded-full bg-black/10 overflow-hidden">
          <div
            className={`h-full transition-all ${barColor(usedPct)}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
      </div>

      <ul className="text-[11px] space-y-1 text-kawaii-text">
        <li>
          <span className="text-kawaii-text-muted">Modelo chat:</span>{' '}
          <code className="text-[10px]">{settings.localModel || '(ninguno)'}</code>
          {ledger.largeLlmResident ? (
            <span className="ml-1 text-amber-800">· grande (pesa en el presupuesto)</span>
          ) : null}
        </li>
        <li>
          <span className="text-kawaii-text-muted">Forge:</span>{' '}
          <strong>{layers.forge}</strong>
          {layers.forgeUrl ? (
            <span className="text-kawaii-text-muted"> · {layers.forgeUrl}</span>
          ) : null}
        </li>
        <li>
          <span className="text-kawaii-text-muted">Música (ACE):</span>{' '}
          <strong>{layers.music ? 'en marcha' : 'detenida'}</strong>
          {layers.musicDetail ? (
            <span className="text-kawaii-text-muted"> · {layers.musicDetail.slice(0, 80)}</span>
          ) : null}
        </li>
        <li>
          <span className="text-kawaii-text-muted">Ollama en memoria:</span>{' '}
          {layers.ollamaLoaded.length ? (
            <span className="font-mono text-[10px]">{layers.ollamaLoaded.join(', ')}</span>
          ) : (
            <span className="text-kawaii-text-muted">ninguno / no reachable</span>
          )}
        </li>
      </ul>

      {admit && (
        <div className="text-[10px] space-y-0.5 text-kawaii-text-muted border-t border-kawaii-border/60 pt-2">
          <p>
            <strong className="text-kawaii-text">¿Cabe Forge?</strong> {admit.forge}
          </p>
          <p>
            <strong className="text-kawaii-text">¿Cabe música?</strong> {admit.music}
          </p>
          <p>
            <strong className="text-kawaii-text">¿Cabe otro LLM?</strong> {admit.llm}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          variant="ghost"
          className="text-[10px]"
          disabled={busy !== null}
          onClick={() =>
            void runAction('unload', async () => {
              const r = await window.kawaii?.unloadLocalModels?.({ minSizeGB: 4 })
              const detail =
                (r as { detail?: string })?.detail ||
                ((r as { unloaded?: string[] })?.unloaded?.length
                  ? `Liberados: ${(r as { unloaded: string[] }).unloaded.join(', ')}`
                  : 'Sin modelos grandes que liberar')
              setMsg(detail)
              setLayers((prev) => ({ ...prev, unloadDetail: detail }))
            })
          }
        >
          {busy === 'unload' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          Liberar LLM (Ollama)
        </Button>
        <Button
          variant="ghost"
          className="text-[10px]"
          disabled={busy !== null || !/running|starting/i.test(layers.forge)}
          onClick={() =>
            void runAction('stop-forge', async () => {
              await window.kawaii?.forgeStop?.()
              setMsg('Forge detenido')
            })
          }
        >
          Detener Forge
        </Button>
        <Button
          variant="ghost"
          className="text-[10px]"
          disabled={busy !== null || !layers.music}
          onClick={() =>
            void runAction('stop-music', async () => {
              await window.kawaii?.musicStop?.()
              setMsg('Música detenida')
            })
          }
        >
          Detener música
        </Button>
        <Button
          variant="ghost"
          className="text-[10px]"
          disabled={busy !== null || /running/i.test(layers.forge)}
          onClick={() =>
            void runAction('start-forge', async () => {
              await withActivity(
                'Forge',
                async (upd) => {
                  upd('Solicitando arranque…', 5)
                  let unsub: (() => void) | undefined
                  try {
                    unsub = window.kawaii?.onForgeBootProgress?.((p) => {
                      const pct =
                        typeof p.bootProgress === 'number'
                          ? Math.max(5, Math.min(95, Math.round(p.bootProgress)))
                          : p.state === 'running'
                            ? 100
                            : p.state === 'starting'
                              ? 35
                              : 15
                      const line =
                        (p.lastLogLine || p.message || p.state || '').slice(0, 120)
                      upd(line || 'Arrancando Forge…', pct)
                      if (p.state === 'running' && p.baseUrl) {
                        setLayers((prev) => ({
                          ...prev,
                          forge: 'running',
                          forgeUrl: p.baseUrl || prev.forgeUrl
                        }))
                      }
                    })
                  } catch {
                    /* no progress channel */
                  }
                  try {
                    const st = await window.kawaii?.forgeStart?.()
                    const note =
                      st && typeof st === 'object'
                        ? String(
                            (st as { unloadNote?: string; message?: string }).unloadNote ||
                              (st as { message?: string }).message ||
                              ''
                          )
                        : ''
                    // Poll until running / error / timeout (~3 min)
                    const deadline = Date.now() + 180_000
                    let last = st as { state?: string; message?: string; baseUrl?: string } | null
                    while (Date.now() < deadline) {
                      await new Promise((r) => setTimeout(r, 2000))
                      try {
                        last = (await window.kawaii?.forgeStatus?.()) as typeof last
                      } catch {
                        continue
                      }
                      const state = String(last?.state || '')
                      if (state === 'running') {
                        setMsg(
                          note ||
                            last?.message ||
                            'Forge listo' +
                              (last?.baseUrl ? ' · ' + last.baseUrl : '')
                        )
                        setLayers((prev) => ({
                          ...prev,
                          forge: 'running',
                          forgeUrl: last?.baseUrl || prev.forgeUrl
                        }))
                        upd(
                          last?.message || 'Forge en marcha',
                          100
                        )
                        return last
                      }
                      if (state === 'error' || state === 'stopped') {
                        throw new Error(
                          last?.message || note || 'Forge no arrancó (' + state + ')'
                        )
                      }
                      upd(
                        (last?.message || 'Esperando API de Forge…').slice(0, 120),
                        50
                      )
                    }
                    throw new Error(
                      'Timeout esperando Forge. Revisa la consola Forge más abajo.'
                    )
                  } finally {
                    try {
                      unsub?.()
                    } catch {
                      /* */
                    }
                  }
                },
                { successMessage: 'Forge listo' }
              )
            })
          }
        >
          Arrancar Forge
        </Button>
      </div>

      {msg && <p className="text-[11px] text-kawaii-text">{msg}</p>}
      {ledger.notes?.length ? (
        <p className="text-[10px] text-kawaii-text-muted">Notas: {ledger.notes.join(' · ')}</p>
      ) : null}
    </div>
  )
}
