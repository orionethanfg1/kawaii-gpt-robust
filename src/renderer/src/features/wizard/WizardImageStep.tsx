import { useState } from 'react'
import { AlertCircle, Check, Cloud, Image as ImageIcon, Loader2, Server, Sparkles } from 'lucide-react'
import type { HardwareProfile } from '@core/models/recommendations'
import { recommendGenerativeStack } from '@core/models/generative-catalog'
import { Button } from '@shared/ui/Button'
import { SdWorkspacePanel } from '@features/image/components/SdWorkspacePanel'
import { ModeCard, NavRow } from './WizardShared'

type ImageMode = 'cloud' | 'smart' | 'local'

interface Props {
  hw: HardwareProfile | null
  imageRecSummary: string
  imageWanted: boolean
  setImageWanted: (wanted: boolean) => void
  imageMode: ImageMode
  setImageMode: (mode: ImageMode) => void
  a1111Url: string
  setA1111Url: (url: string) => void
  onPullModel: (model: string) => void
  onOpenLink: (url: string) => void
  onCheckpointSelected: (checkpoint: string) => void
  onBack: () => void
  onNext: () => void
}

export function WizardImageStep({
  hw,
  imageRecSummary,
  imageWanted,
  setImageWanted,
  imageMode,
  setImageMode,
  a1111Url,
  setA1111Url,
  onPullModel,
  onOpenLink,
  onCheckpointSelected,
  onBack,
  onNext
}: Props) {
  const [probe, setProbe] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle')
  const [detail, setDetail] = useState<string | null>(null)

  const probeForge = async () => {
    setProbe('loading')
    setDetail(null)
    try {
      const health = await window.kawaii.imageA1111Health?.(a1111Url)
      if (!health?.ok) {
        setProbe('fail')
        setDetail(health?.error || 'No responde')
        return
      }

      setProbe('ok')
      const models = await window.kawaii.imageA1111Models?.(a1111Url)
      const modelCount = models?.models?.length ?? health.modelsCount ?? 0
      setDetail(
        `Conectado · ${modelCount} checkpoint(s)${
          models?.current ? ` · actual: ${models.current}` : ''
        }`
      )
      const checkpoint = models?.current || models?.models?.[0]?.title
      if (checkpoint) onCheckpointSelected(checkpoint)
    } catch (error) {
      setProbe('fail')
      setDetail(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="card-kawaii space-y-4 animate-in">
      <div className="flex items-center gap-2">
        <ImageIcon className="w-6 h-6 text-kawaii-pink-deep" />
        <h2 className="text-xl font-bold text-kawaii-text">Imágenes (opcional)</h2>
      </div>
      <p className="text-sm text-kawaii-text-muted leading-relaxed">
        Puedes generar imágenes desde el chat sin tocar el flujo de texto. Si no las
        necesitas ahora, déjalo desactivado y actívalo después en Ajustes.
      </p>
      <div className="rounded-kawaii border border-kawaii-border bg-kawaii-pink-soft/30 px-3 py-2 text-xs text-kawaii-text">
        <span className="font-semibold">Tu equipo: </span>
        {imageRecSummary}
        {hw?.gpuName ? (
          <span className="block text-kawaii-text-muted mt-0.5 truncate">
            GPU: {hw.gpuName}
            {hw.vramGB != null ? ` · ~${hw.vramGB} GB VRAM` : ''}
          </span>
        ) : null}
      </div>

      {hw && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-kawaii-text">Qué puede instalar / usar</p>
          {recommendGenerativeStack({
            totalMemoryGB: hw.totalMemoryGB,
            vramGB: hw.vramGB ?? null,
            hasDiscreteGpu: hw.hasDiscreteGpu ?? null
          }).map((recommendation) => (
            <div
              key={recommendation.id}
              className="rounded-kawaii border border-kawaii-border bg-white p-2 text-xs"
            >
              <p className="font-semibold text-kawaii-text">{recommendation.title}</p>
              <p className="text-kawaii-text-muted mt-0.5">{recommendation.summary}</p>
              <ul className="list-disc ml-4 mt-1 text-kawaii-text-muted space-y-0.5">
                {recommendation.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
              {recommendation.learnMoreUrl && (
                <button
                  type="button"
                  className="text-kawaii-pink-deep font-semibold mt-1 hover:underline"
                  onClick={() => onOpenLink(recommendation.learnMoreUrl!)}
                >
                  Abrir guía / descarga →
                </button>
              )}
              {recommendation.ollamaPull && (
                <button
                  type="button"
                  className="block text-kawaii-pink-deep font-semibold mt-1 hover:underline"
                  onClick={() => onPullModel(recommendation.ollamaPull!)}
                >
                  Descargar en segundo plano: {recommendation.ollamaPull}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <label className="flex items-start gap-3 rounded-kawaii border-2 p-3 cursor-pointer transition border-kawaii-border bg-white hover:border-kawaii-pink">
        <input
          type="checkbox"
          className="mt-1"
          checked={imageWanted}
          onChange={(event) => setImageWanted(event.target.checked)}
        />
        <span>
          <span className="font-semibold text-sm text-kawaii-text block">
            Activar generación de imágenes
          </span>
          <span className="text-xs text-kawaii-text-muted">
            Botón en el chat y comando <code>/image …</code>
          </span>
        </span>
      </label>

      {imageWanted && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-kawaii-text">¿Cómo generar?</p>
          <ModeCard
            active={imageMode === 'cloud'}
            icon={<Cloud className="w-5 h-5" />}
            title="Cloud gratis (Pollinations)"
            desc="Sin instalar nada ni API key. Ideal para empezar."
            onClick={() => setImageMode('cloud')}
          />
          <ModeCard
            active={imageMode === 'smart'}
            icon={<Sparkles className="w-5 h-5" />}
            title="Smart (local → cloud)"
            desc="Usa Forge/A1111 si está en marcha; si no, Pollinations."
            onClick={() => setImageMode('smart')}
          />
          <ModeCard
            active={imageMode === 'local'}
            icon={<Server className="w-5 h-5" />}
            title="Solo local (Forge / A1111)"
            desc="Requiere WebUI con --api y un checkpoint SD. Mejor con GPU."
            onClick={() => setImageMode('local')}
          />
          {(imageMode === 'local' || imageMode === 'smart') && (
            <div className="space-y-2 rounded-kawaii border border-kawaii-border p-3 bg-white">
              <SdWorkspacePanel compact />
              <label className="text-xs font-semibold text-kawaii-text">
                URL de Forge / Automatic1111
              </label>
              <input
                className="input-kawaii text-sm w-full"
                value={a1111Url}
                onChange={(event) => setA1111Url(event.target.value)}
                placeholder="http://127.0.0.1:7860"
              />
              <p className="text-[10px] text-kawaii-text-muted">
                Arranca el WebUI con <code>--api</code>. Checkpoints en la carpeta models
                del WebUI (SD 1.5 si poca VRAM; SDXL si 8 GB o mas).
              </p>
              <Button
                variant="ghost"
                className="text-xs"
                disabled={probe === 'loading'}
                onClick={() => void probeForge()}
              >
                {probe === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Probar WebUI
              </Button>
              {probe === 'ok' && (
                <p className="text-xs text-green-700 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> {detail}
                </p>
              )}
              {probe === 'fail' && (
                <p className="text-xs text-amber-800 flex items-start gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {detail || 'WebUI no disponible'} — puedes seguir; Smart usará cloud si hace falta.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      <NavRow onBack={onBack} onNext={onNext} nextLabel="Continuar" />
    </div>
  )
}
