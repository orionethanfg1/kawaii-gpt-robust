import { AlertCircle, Check, ExternalLink, Loader2 } from 'lucide-react'
import type { modelsForProvider } from '@core/models/free-cloud-catalog'
import { Button } from '@shared/ui/Button'
import { NavRow } from './WizardShared'
import type { CloudProvider } from './cloudProviders'

type CloudModel = ReturnType<typeof modelsForProvider>[number]

interface Props {
  providers: CloudProvider[]
  selectedProvider: CloudProvider
  selectedProviderId: string
  setSelectedProviderId: (id: string) => void
  hasOpenRouterKey: boolean
  hasAnyCloudKey: boolean
  cloudProvidersReady: string[]
  openLink: (url: string) => void
  apiKey: string
  setApiKey: (key: string) => void
  keyTesting: boolean
  keyTestResult: 'ok' | 'fail' | null
  keyTestDetail: string | null
  setKeyTestResult: (result: 'ok' | 'fail' | null) => void
  setKeyTestDetail: (detail: string | null) => void
  testCloudKey: () => Promise<void>
  freeDiscovering: boolean
  freeDiscoverMsg: string | null
  liveFreeModels: Array<{ id: string; name: string }>
  selectedCloudModel: string
  setSelectedCloudModel: (model: string) => void
  cloudModels: CloudModel[]
  canProceed: boolean
  onBack: () => void
  onNext: () => void
}

export function WizardCloudStep({
  providers,
  selectedProvider,
  selectedProviderId,
  setSelectedProviderId,
  hasOpenRouterKey,
  hasAnyCloudKey,
  cloudProvidersReady,
  openLink,
  apiKey,
  setApiKey,
  keyTesting,
  keyTestResult,
  keyTestDetail,
  setKeyTestResult,
  setKeyTestDetail,
  testCloudKey,
  freeDiscovering,
  freeDiscoverMsg,
  liveFreeModels,
  selectedCloudModel,
  setSelectedCloudModel,
  cloudModels,
  canProceed,
  onBack,
  onNext
}: Props) {
  return (
    <div className="space-y-4 py-4">
      <div className="text-center">
        <h2 className="text-2xl font-extrabold text-kawaii-text">Cloud + modelos free</h2>
        <p className="text-kawaii-text-muted text-sm mt-1 max-w-md mx-auto">
          Elige proveedor, verifica la key y el modelo free. El router Smart usará este
          endpoint cuando haga falta.
        </p>
      </div>

      {(hasOpenRouterKey || hasAnyCloudKey) && (
        <div className="rounded-kawaii border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          ✓ API key ya guardada
          {cloudProvidersReady.length > 0 ? ` (${cloudProvidersReady.join(', ')})` : ''}. Puedes
          continuar sin volver a pegarla; solo rellénala si quieres cambiarla.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => {
              setSelectedProviderId(provider.id)
              setKeyTestResult(null)
              setKeyTestDetail(null)
            }}
            className={`text-left rounded-kawaii border-2 p-3 transition ${
              selectedProviderId === provider.id
                ? 'border-kawaii-pink-deep bg-kawaii-pink-soft/50 shadow-kawaii'
                : 'border-kawaii-border bg-white hover:border-kawaii-pink'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{provider.emoji}</span>
              <span className="font-bold text-sm">{provider.name}</span>
              {selectedProviderId === provider.id && (
                <Check className="w-3.5 h-3.5 text-kawaii-pink-deep ml-auto" />
              )}
            </div>
            <p className="text-[10px] font-semibold text-kawaii-pink-deep">{provider.badge}</p>
            <p className="text-[11px] text-kawaii-text-muted mt-1">{provider.description}</p>
          </button>
        ))}
      </div>

      <div className="max-w-lg mx-auto space-y-2">
        <button
          type="button"
          onClick={() => openLink(selectedProvider.keyUrl)}
          className="flex items-center gap-1 text-sm text-kawaii-pink-deep hover:underline"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Crear / copiar API key en {selectedProvider.name}
        </button>
        <input
          className="input-kawaii"
          type="password"
          autoComplete="off"
          placeholder="Pega tu API key…"
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value)
            setKeyTestResult(null)
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            className="text-xs"
            disabled={apiKey.trim().length < 8 || keyTesting}
            onClick={() => void testCloudKey()}
          >
            {keyTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Verificar conexión
          </Button>
          {keyTestResult === 'ok' && (
            <span className="text-xs text-green-700 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> {keyTestDetail}
            </span>
          )}
          {keyTestResult === 'fail' && (
            <span className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> {keyTestDetail}
            </span>
          )}
        </div>

        {selectedProviderId === 'openrouter' && (
          <div className="rounded-kawaii border border-kawaii-border bg-white p-2 space-y-1">
            <p className="text-[11px] font-semibold text-kawaii-text">
              Modelos free en vivo (OpenRouter)
            </p>
            <p className="text-[10px] text-kawaii-text-muted">
              {freeDiscovering ? 'Consultando catálogo…' : freeDiscoverMsg || 'Lista de respaldo si no hay red'}
            </p>
            <p className="text-[10px] text-kawaii-text-muted">
              Recomendado: <code>openrouter/free</code> — evita slugs free que dejan de existir.
              El asistente lo selecciona solo cuando puede.
            </p>
            {liveFreeModels.length > 0 && (
              <select
                className="input-kawaii text-xs w-full"
                value={selectedCloudModel}
                onChange={(event) => setSelectedCloudModel(event.target.value)}
              >
                {liveFreeModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.id})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {cloudModels.length > 0 && (
          <div>
            <label className="block text-sm font-semibold mb-1">Modelo cloud</label>
            <select
              className="input-kawaii"
              value={selectedCloudModel}
              onChange={(event) => setSelectedCloudModel(event.target.value)}
            >
              {cloudModels.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.free ? '🆓 ' : '💳 '}
                  {model.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-kawaii-text-muted mt-1">
              {cloudModels.find((model) => model.modelId === selectedCloudModel)?.notes}
            </p>
          </div>
        )}

        <div className="text-[11px] text-kawaii-text-muted bg-white/70 border border-kawaii-border rounded-kawaii p-2">
          <strong className="text-kawaii-text">Router interno:</strong> en modo Smart, los
          prompts cortos van a local; noticias/web y prompts largos a este cloud. Si el
          proveedor falla, el circuit breaker evita reintentos inútiles.
        </div>
      </div>

      <NavRow
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!canProceed}
        nextLabel="Siguiente"
      />
    </div>
  )
}
