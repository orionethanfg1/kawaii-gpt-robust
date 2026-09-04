import { useCallback, useEffect, useState } from 'react'
import { Brain, Trash2, RefreshCw } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import {
  brainSummary,
  clearMiniBrain,
  getTopPatterns,
  type LearnedPattern,
  type RemedyId
} from '@core/diagnostics/mini-brain'
import {
  listModelMemory,
  clearModelMemory,
  type ModelMemoryEntry
} from '@core/models/model-memory'
import { useRecoveryStore } from '@shared/lib/stores/recoveryStore'

const REMEDY_LABELS: Record<RemedyId, string> = {
  switch_safe_model: 'Cambiar a modelo free seguro',
  skip_provider: 'Saltar / rotar proveedor',
  check_api_key: 'Revisar API key',
  prefer_local: 'Preferir Ollama local',
  prefer_cloud: 'Preferir cloud',
  reduce_context: 'Reducir contexto',
  retry_later: 'Reintentar más tarde',
  open_settings: 'Abrir ajustes',
  none: 'Sin remedio automático'
}

/**
 * Panel: lo que la app ha aprendido de errores + memoria de modelos + recovery.
 */
export function AppMemoryPanel() {
  const [patterns, setPatterns] = useState<LearnedPattern[]>([])
  const [models, setModels] = useState<ModelMemoryEntry[]>([])
  const [summary, setSummary] = useState(brainSummary())
  const checkpoint = useRecoveryStore((s) => s.checkpoint)
  const clearRecovery = useRecoveryStore((s) => s.clear)

  const refresh = useCallback(() => {
    setPatterns(getTopPatterns(12))
    setModels(listModelMemory().slice(0, 12))
    setSummary(brainSummary())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const clearAll = () => {
    if (
      !confirm(
        '¿Borrar todo el aprendizaje (patrones de error, modelos evitados y checkpoint de recuperación)?'
      )
    ) {
      return
    }
    clearMiniBrain()
    clearModelMemory()
    clearRecovery()
    refresh()
  }

  return (
    <div className="border border-kawaii-border rounded-kawaii p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-sm flex items-center gap-1.5 text-kawaii-text">
          <Brain className="w-4 h-4 text-kawaii-pink-deep" />
          Memoria de la app
        </h3>
        <div className="flex gap-1">
          <Button variant="ghost" className="text-xs px-2" onClick={refresh} title="Actualizar">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            className="text-xs px-2 text-red-600"
            onClick={clearAll}
            title="Limpiar aprendizaje"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-kawaii-text-muted leading-relaxed">
        Aprendizaje pasivo: cuando algo falla (modelo no free, rate limit, key, etc.), la app lo
        recuerda y la próxima vez intenta corregirlo sola. No es una red neuronal; es una memoria
        ligera en este dispositivo.
      </p>

      <div className="rounded-lg bg-kawaii-pink-soft/40 px-2 py-1.5 text-[11px]">
        <span className="font-semibold">{summary.patternCount}</span> patrones de error ·{' '}
        <span className="font-semibold">{models.length}</span> modelos en lista de precaución
        {checkpoint.dirty ? (
          <span className="text-amber-800"> · recovery pendiente</span>
        ) : (
          <span className="text-kawaii-text-muted"> · sin recovery pendiente</span>
        )}
      </div>

      {/* Patterns */}
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-kawaii-text">Errores más frecuentes</p>
        {patterns.length === 0 ? (
          <p className="text-[11px] text-kawaii-text-muted">
            Aún no hay historial. Se irá llenando conforme uses el chat.
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-40 overflow-y-auto">
            {patterns.map((p) => (
              <li
                key={p.key}
                className="text-[11px] rounded-lg border border-kawaii-border bg-white/80 px-2 py-1.5"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-kawaii-text truncate">
                    {p.code}
                    {p.provider ? ` · ${p.provider}` : ''}
                  </span>
                  <span className="shrink-0 text-kawaii-text-muted">×{p.count}</span>
                </div>
                <p className="text-kawaii-text-muted mt-0.5">
                  Remedio: {REMEDY_LABELS[p.remedy] ?? p.remedy}
                  {p.remedySuccesses > 0 ? ` · funcionó ${p.remedySuccesses}×` : ''}
                </p>
                {p.lastMessage && (
                  <p className="text-[10px] text-kawaii-text-muted truncate mt-0.5" title={p.lastMessage}>
                    {p.lastMessage}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Model memory */}
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-kawaii-text">Modelos evitados / vigilados</p>
        {models.length === 0 ? (
          <p className="text-[11px] text-kawaii-text-muted">Ninguno por ahora.</p>
        ) : (
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {models.map((m) => (
              <li
                key={`${m.providerId}::${m.modelId}`}
                className="text-[11px] flex justify-between gap-2 border border-kawaii-border rounded-lg px-2 py-1 bg-white/80"
              >
                <span className="truncate">
                  <span className="font-medium">{m.providerId}</span> / {m.modelId}
                </span>
                <span className="shrink-0 text-kawaii-text-muted">
                  {m.kind} ×{m.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recovery snapshot */}
      {checkpoint.dirty && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] space-y-0.5">
          <p className="font-semibold text-amber-900">Checkpoint de recovery</p>
          {checkpoint.pendingUserPreview && (
            <p className="text-kawaii-text-muted truncate">
              Mensaje: {checkpoint.pendingUserPreview}
            </p>
          )}
          {checkpoint.ollamaPullModel && (
            <p className="text-kawaii-text-muted">
              Descarga: {checkpoint.ollamaPullModel}
              {checkpoint.ollamaPullProgress != null
                ? ` (${Math.round(checkpoint.ollamaPullProgress)}%)`
                : ''}
            </p>
          )}
          {checkpoint.lastRemedy && (
            <p className="text-amber-800">Último remedio: {checkpoint.lastRemedy}</p>
          )}
          <Button
            variant="ghost"
            className="text-[11px] mt-1"
            onClick={() => {
              clearRecovery()
              refresh()
            }}
          >
            Limpiar solo recovery
          </Button>
        </div>
      )}
    </div>
  )
}
