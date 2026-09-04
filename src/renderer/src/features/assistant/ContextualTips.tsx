import { useEffect, useState } from 'react'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useDownloadStore } from '@features/models/downloadStore'
import { X } from 'lucide-react'

/**
 * Non-blocking tips while using the app (not only onboarding).
 */
export function ContextualTips() {
  const enabled = useSettingsStore((s) => s.settings.assistantTipsEnabled !== false)
  const jobs = useDownloadStore((s) => s.jobs)
  const [tip, setTip] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setTip(null)
      return
    }
    const active = Object.values(jobs).filter(
      (j) => j.state === 'running' || j.state === 'paused'
    )
    let next: string | null = null
    if (active.some((j) => j.kind === 'sd' || j.model.startsWith('SD:'))) {
      next =
        'Descarga SD: puedes pausar; el progreso queda en disco. Si dice «Ya instalado», no hace falta bajarlo otra vez.'
    } else if (active.some((j) => j.kind === 'ollama')) {
      next =
        'Mientras Ollama descarga un modelo, el chat cloud sigue disponible. Evita saturar la red si falla el proveedor.'
    } else if (active.some((j) => j.state === 'paused')) {
      next = 'Hay descargas en pausa. Pulsa Continuar en la barra inferior para recovery.'
    }
    if (next && next !== dismissed) setTip(next)
    else if (!next) setTip(null)
  }, [jobs, enabled, dismissed])

  if (!tip) return null

  return (
    <div className="mx-3 mb-1 px-3 py-1.5 rounded-lg border border-kawaii-border bg-white/90 text-[11px] text-kawaii-text flex items-start gap-2 shadow-sm">
      <span className="flex-1">💡 {tip}</span>
      <button
        type="button"
        className="text-kawaii-text-muted shrink-0"
        onClick={() => {
          setDismissed(tip)
          setTip(null)
        }}
        aria-label="Cerrar tip"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
