import { useCallback, useEffect, useState } from 'react'
import { Button } from '@shared/ui/Button'
import { RefreshCw, FolderOpen } from 'lucide-react'

type Weight = {
  filename: string
  path: string
  sizeBytes: number
  kind: string
  family: string
  likelySdxl: boolean
  location: string
}

function gb(n: number) {
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

export function LocalSdModelsPanel() {
  const [weights, setWeights] = useState<Weight[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [apiModels, setApiModels] = useState<string[]>([])

  const refresh = useCallback(async () => {
    setBusy(true)
    setErr('')
    try {
      const disk = await window.kawaii?.sdListWeights?.()
      setWeights(disk?.weights || [])
      if (disk && disk.ok === false) setErr(disk.error || 'Error disco')
      try {
        const api = await window.kawaii?.imageA1111Models?.()
        const list = (api as { models?: Array<{ title?: string; model_name?: string }> })?.models
        if (Array.isArray(list)) {
          setApiModels(
            list.map((m) => m.model_name || m.title || '').filter(Boolean)
          )
        }
      } catch {
        setApiModels([])
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const checkpoints = weights.filter((w) => w.kind === 'checkpoint')
  const loras = weights.filter((w) => w.kind === 'lora')

  return (
    <div className="rounded-2xl border border-kawaii-border bg-white/80 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-bold flex-1">Modelos locales (disco + Forge)</h4>
        <Button variant="ghost" className="text-[10px]" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw className={`w-3 h-3 mr-1 inline ${busy ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
        <Button
          variant="ghost"
          className="text-[10px]"
          onClick={() => void window.kawaii?.sdOpenWorkspace?.()}
        >
          <FolderOpen className="w-3 h-3 mr-1 inline" />
          Carpeta
        </Button>
      </div>
      <p className="text-[10px] text-kawaii-text-muted leading-relaxed">
        Se leen al instante desde <code>models/Stable-diffusion</code> y <code>Lora</code> (workspace y
        Forge). Un <strong>checkpoint</strong> es el modelo base; un <strong>LoRA</strong> es una capa
        (no sustituye al checkpoint). Combina p.ej. Realistic Vision + LoRA Realism en Forge.
      </p>
      {err ? <p className="text-[10px] text-red-600">{err}</p> : null}
      <div className="text-[10px] space-y-1 max-h-48 overflow-y-auto">
        <p className="font-semibold text-kawaii-pink-deep">Checkpoints ({checkpoints.length})</p>
        {checkpoints.length === 0 ? (
          <p className="text-kawaii-text-muted">Ninguno detectado en disco.</p>
        ) : (
          checkpoints.map((w) => (
            <div key={w.path} className="border-b border-kawaii-border/40 py-1">
              <div className="font-medium text-kawaii-text">{w.filename}</div>
              <div className="text-kawaii-text-muted">
                {w.family} · {gb(w.sizeBytes)} · {w.location}
                {w.likelySdxl ? ' · posible SDXL (más VRAM)' : ''}
                {apiModels.some((a) => a.toLowerCase().includes(w.filename.replace(/\.safetensors$/i, '').toLowerCase().slice(0, 12)))
                  ? ' · visto por API Forge'
                  : ''}
              </div>
            </div>
          ))
        )}
        <p className="font-semibold text-kawaii-pink-deep pt-1">LoRAs ({loras.length})</p>
        {loras.length === 0 ? (
          <p className="text-kawaii-text-muted">Ninguno (ideal: carpeta models/Lora).</p>
        ) : (
          loras.map((w) => (
            <div key={w.path} className="border-b border-kawaii-border/40 py-1">
              <div className="font-medium">{w.filename}</div>
              <div className="text-kawaii-text-muted">
                {w.family} · {gb(w.sizeBytes)} · {w.location}
              </div>
            </div>
          ))
        )}
        {apiModels.length > 0 ? (
          <p className="text-kawaii-text-muted pt-1">
            Forge API reporta {apiModels.length} modelo(s): {apiModels.slice(0, 6).join(', ')}
            {apiModels.length > 6 ? '…' : ''}
          </p>
        ) : (
          <p className="text-kawaii-text-muted pt-1">Forge API sin lista (¿WebUI apagado?).</p>
        )}
      </div>
    </div>
  )
}
