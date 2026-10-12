import { AlertCircle, Cpu, Download, Loader2, Play } from 'lucide-react'
import type { HardwareProfile, ModelRecommendation } from '@core/models/recommendations'
import { Button } from '@shared/ui/Button'
import { NavRow } from './WizardShared'

type RuntimePath = 'auto' | 'ollama' | 'lmstudio'
type PullJob = { progress?: number; status: string }

interface RecommendationCardProps {
  model: ModelRecommendation
  primary: boolean
  installed: boolean
  job?: PullJob
  deleting: boolean
  canPull: boolean
  onSelect: () => void
  onDelete: () => void
  onCancel: () => void
  onPull: () => void
}

function RecommendationCard({
  model,
  primary,
  installed,
  job,
  deleting,
  canPull,
  onSelect,
  onDelete,
  onCancel,
  onPull
}: RecommendationCardProps) {
  const isPulling = Boolean(job)

  return (
    <div
      className={`rounded-kawaii border p-3 text-left ${
        primary ? 'border-kawaii-pink-deep bg-kawaii-pink-soft/40' : 'border-kawaii-border bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-sm text-kawaii-text">
            {model.label}{' '}
            {primary && (
              <span className="text-[10px] text-kawaii-pink-deep font-semibold">Recomendado</span>
            )}
          </p>
          <p className="text-[11px] text-kawaii-text-muted">
            {model.sizeHint} · min ~{model.minRamGB} GB RAM
          </p>
          <p className="text-[11px] text-kawaii-text-muted mt-0.5">{model.reason}</p>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {installed ? (
            <>
              <Button variant="ghost" className="text-xs" onClick={onSelect}>
                Usar
              </Button>
              <Button
                variant="ghost"
                className="text-xs text-red-600 hover:bg-red-50"
                disabled={deleting}
                onClick={onDelete}
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Eliminar
              </Button>
            </>
          ) : isPulling ? (
            <Button variant="ghost" className="text-xs text-amber-700" onClick={onCancel}>
              Pausar
            </Button>
          ) : (
            <Button className="text-xs" disabled={!canPull} onClick={onPull}>
              <Download className="w-3.5 h-3.5" />
              Descargar
            </Button>
          )}
        </div>
      </div>
      {isPulling && (
        <div className="mt-2">
          <div className="h-1.5 rounded-full bg-kawaii-border overflow-hidden">
            <div
              className="h-full bg-kawaii-pink-deep transition-all"
              style={{ width: `${job?.progress ?? 5}%` }}
            />
          </div>
          <p className="text-[10px] text-kawaii-text-muted mt-1">
            {job?.status}
            {job?.progress != null ? ` · ${job.progress}%` : ''}
            {' · '}puedes seguir el asistente mientras descarga
          </p>
        </div>
      )}
    </div>
  )
}

interface Props {
  hw: HardwareProfile | null
  recommendation: ReturnType<typeof import('@core/models/recommendations').recommendLocalModels> | null
  runtimePath: RuntimePath
  setRuntimePath: (path: RuntimePath) => void
  ollamaReachable: boolean
  hasLocalModel: boolean
  localUrl: string
  setLocalUrl: (url: string) => void
  ollamaOk: boolean | null
  setOllamaOk: (value: boolean | null) => void
  ollamaChecking: boolean
  checkOllama: () => Promise<void>
  startingOllama: boolean
  startOllama: () => Promise<void>
  lmStudioOk: boolean | null
  lmStudioNote: string | null
  diskModelCount: number
  discoveredModels: string[]
  localModel: string
  setLocalModel: (model: string) => void
  modelSources: Record<string, string>
  ollamaError: string | null
  pullJobs: Record<string, PullJob>
  deleting: string | null
  canProceed: boolean
  onDeleteModel: (model: string) => Promise<void>
  onPullModel: (model: string) => Promise<void>
  onCancelPull: (model: string) => void
  onOpenLink: (url: string) => void
  onBack: () => void
  onNext: () => void
}

export function WizardLocalStep({
  hw,
  recommendation,
  runtimePath,
  setRuntimePath,
  ollamaReachable,
  hasLocalModel,
  localUrl,
  setLocalUrl,
  ollamaOk,
  setOllamaOk,
  ollamaChecking,
  checkOllama,
  startingOllama,
  startOllama,
  lmStudioOk,
  lmStudioNote,
  diskModelCount,
  discoveredModels,
  localModel,
  setLocalModel,
  modelSources,
  ollamaError,
  pullJobs,
  deleting,
  canProceed,
  onDeleteModel,
  onPullModel,
  onCancelPull,
  onOpenLink,
  onBack,
  onNext
}: Props) {
  const activePullCount = Object.keys(pullJobs).length
  const installed = new Set(discoveredModels.map((name) => name.toLowerCase().split(':')[0]))
  const pendingModels = recommendation
    ? [recommendation.primary, ...recommendation.alternatives].filter((model) => {
        const key = (model.pullName || model.id || '').toLowerCase().split(':')[0]
        return key && ![...installed].some((name) => name.includes(key) || key.includes(name))
      })
    : []

  return (
    <div className="max-w-xl mx-auto space-y-4 py-4">
      <div className="text-center">
        <h2 className="text-2xl font-extrabold text-kawaii-text">Modelos locales</h2>
        <p className="text-xs text-kawaii-text-muted mt-1">
          Elige cómo quieres trabajar en local. Puedes cambiarlo después en Ajustes.
        </p>
        {hw && (
          <p className="text-xs text-kawaii-text-muted mt-1 flex items-center justify-center gap-1">
            <Cpu className="w-3.5 h-3.5" />
            {recommendation?.profileSummary ?? `${hw.totalMemoryGB} GB RAM`}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {(
          [
            {
              id: 'auto' as const,
              title: 'Automático',
              body: 'Usa Ollama y/o LM Studio según lo que esté en marcha.'
            },
            {
              id: 'ollama' as const,
              title: 'Solo Ollama',
              body: 'Pull de modelos y chat por Ollama. Ideal si ya lo usas.'
            },
            {
              id: 'lmstudio' as const,
              title: 'Solo LM Studio',
              body: 'Servidor local de LM Studio (puerto detectado solo). Sin depender de Ollama.'
            }
          ] as const
        ).map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setRuntimePath(option.id)}
            className={
              'text-left rounded-kawaii border px-3 py-2 transition-colors ' +
              (runtimePath === option.id
                ? 'border-kawaii-pink-deep bg-kawaii-pink-soft/50 ring-1 ring-kawaii-pink-deep/30'
                : 'border-kawaii-border bg-white hover:border-kawaii-pink-deep/40')
            }
          >
            <p className="text-xs font-bold text-kawaii-text">{option.title}</p>
            <p className="text-[10px] text-kawaii-text-muted mt-0.5 leading-snug">{option.body}</p>
          </button>
        ))}
      </div>
      {runtimePath === 'ollama' && (
        <p className="text-[11px] text-kawaii-text-muted bg-kawaii-blue-soft/40 border border-kawaii-border rounded-kawaii px-3 py-2">
          <strong>Solo Ollama:</strong> inicia el servicio, descarga un modelo sugerido y
          continúa. LM Studio puede seguir instalado; la app no lo usará salvo que cambies el modo.
        </p>
      )}
      {runtimePath === 'lmstudio' && (
        <p className="text-[11px] text-kawaii-text-muted bg-kawaii-blue-soft/40 border border-kawaii-border rounded-kawaii px-3 py-2">
          <strong>Solo LM Studio:</strong> abre la app → Developer → <em>Start Server</em>.
          Detectamos el puerto solos (no tiene que ser 1234). Carga un modelo en el servidor
          para que aparezca en la lista.
        </p>
      )}
      {runtimePath === 'auto' && (
        <p className="text-[11px] text-kawaii-text-muted bg-kawaii-blue-soft/40 border border-kawaii-border rounded-kawaii px-3 py-2">
          <strong>Automático:</strong> si hay Ollama y LM Studio, priorizamos según el modelo
          elegido. Ambos son backends válidos; la app no depende de una sola marca.
        </p>
      )}

      {ollamaReachable && hasLocalModel && runtimePath !== 'lmstudio' && (
        <div className="rounded-kawaii border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          ✓ Ollama responde y hay modelos instalados. Puedes continuar o cambiar el modelo.
        </div>
      )}

      <div className={'space-y-2 ' + (runtimePath === 'lmstudio' ? 'opacity-60' : '')}>
        <label className="block text-sm font-semibold">URL de Ollama</label>
        <input
          className="input-kawaii"
          value={localUrl}
          onChange={(event) => {
            setLocalUrl(event.target.value)
            setOllamaOk(null)
          }}
          onBlur={() => void checkOllama()}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            className="text-xs"
            onClick={() => void checkOllama()}
            disabled={ollamaChecking}
          >
            {ollamaChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Probar conexión
          </Button>
          {ollamaOk === false && (
            <Button className="text-xs" onClick={() => void startOllama()} disabled={startingOllama}>
              {startingOllama ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Iniciar Ollama
            </Button>
          )}
          <button
            type="button"
            className="text-xs text-kawaii-pink-deep underline"
            onClick={() => onOpenLink('https://ollama.com/download')}
          >
            Descargar Ollama
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[11px]">
        <span
          className={`px-2 py-1 rounded-lg border ${
            ollamaOk
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-kawaii-border bg-white text-kawaii-text-muted'
          }`}
        >
          Ollama: {ollamaOk === true ? 'OK' : ollamaOk === false ? 'no conectado' : '…'}
        </span>
        <span
          className={`px-2 py-1 rounded-lg border ${
            lmStudioOk
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-kawaii-border bg-white text-kawaii-text-muted'
          }`}
        >
          LM Studio: {lmStudioOk === true ? 'OK' : lmStudioOk === false ? 'no detectado' : '…'}
        </span>
        {diskModelCount > 0 && (
          <span className="px-2 py-1 rounded-lg border border-kawaii-border bg-white text-kawaii-text-muted">
            Disco: {diskModelCount} archivo(s)
          </span>
        )}
        {discoveredModels.length > 0 && (
          <span className="px-2 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800">
            {discoveredModels.length} modelo(s) listos
          </span>
        )}
      </div>
      {lmStudioNote && (
        <p
          className={
            'text-[11px] px-3 py-2 rounded-kawaii border ' +
            (lmStudioOk
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900')
          }
        >
          {lmStudioNote}
        </p>
      )}
      {ollamaError && ollamaOk !== true && runtimePath !== 'lmstudio' && (
        <p className="text-sm text-amber-800 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-kawaii px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {ollamaError}
            {lmStudioOk || discoveredModels.length
              ? ' Puedes usar LM Studio u otros modelos ya detectados.'
              : ''}
          </span>
        </p>
      )}

      {recommendation && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-kawaii-text">
            Sugeridos para tu PC
            <span className="font-normal text-kawaii-text-muted"> (solo si aún no los tienes)</span>
          </p>
          {!pendingModels.length ? (
            <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              Ya tienes modelos instalados acordes a tu hardware. Elige uno abajo como activo.
            </p>
          ) : (
            pendingModels.slice(0, 3).map((model, index) => (
              <RecommendationCard
                key={model.pullName || model.id || index}
                model={model}
                primary={index === 0}
                installed={discoveredModels.some(
                  (name) => name === model.pullName || name.startsWith(model.pullName)
                )}
                job={pullJobs[model.pullName]}
                deleting={deleting === model.pullName}
                canPull={ollamaOk === true}
                onSelect={() => setLocalModel(model.pullName)}
                onDelete={() => void onDeleteModel(model.pullName)}
                onCancel={() => onCancelPull(model.pullName)}
                onPull={() => void onPullModel(model.pullName)}
              />
            ))
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-semibold mb-1">Modelo local activo</label>
        {discoveredModels.length > 0 ? (
          <select
            className="input-kawaii"
            value={localModel}
            onChange={(event) => setLocalModel(event.target.value)}
          >
            {discoveredModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="input-kawaii"
            placeholder={recommendation?.primary.pullName || 'llama3.2:3b'}
            value={localModel}
            onChange={(event) => setLocalModel(event.target.value)}
          />
        )}
      </div>

      {discoveredModels.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-semibold text-kawaii-text">Modelos instalados</p>
          <ul className="max-h-28 overflow-y-auto space-y-1">
            {discoveredModels.map((name) => (
              <li
                key={name}
                className="flex items-center justify-between gap-2 text-xs bg-white border border-kawaii-border rounded-lg px-2 py-1.5"
              >
                <button
                  type="button"
                  className={`truncate text-left flex-1 hover:text-kawaii-pink-deep ${
                    localModel === name ? 'font-bold text-kawaii-pink-deep' : ''
                  }`}
                  onClick={() => setLocalModel(name)}
                >
                  {name}
                  {modelSources[name] ? (
                    <span className="ml-1 text-[9px] text-kawaii-text-muted">
                      ({modelSources[name]})
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="text-red-600 hover:underline shrink-0 disabled:opacity-50"
                  disabled={deleting === name || Boolean(pullJobs[name])}
                  onClick={() => void onDeleteModel(name)}
                >
                  {deleting === name ? '…' : 'Eliminar'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {activePullCount > 0 && (
        <p className="text-[11px] text-kawaii-text-muted bg-kawaii-blue-soft/50 border border-kawaii-border rounded-kawaii px-3 py-2">
          {activePullCount} descarga(s) en segundo plano. Puedes pulsar <strong>Siguiente</strong> y
          seguir configurando; al terminar el modelo aparecerá en la lista. Usa <strong>Pausar</strong>{' '}
          para cancelar (Ollama suele reanudar al volver a descargar).
        </p>
      )}

      <NavRow
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!canProceed}
        nextLabel={
          activePullCount > 0
            ? 'Seguir (descarga en curso)'
            : ollamaOk === true && discoveredModels.length === 0
              ? 'Continuar sin modelo'
              : 'Siguiente'
        }
      />
    </div>
  )
}
