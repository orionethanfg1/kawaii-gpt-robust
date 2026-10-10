import { PluginsPanel } from './PluginsPanel'
import { useUiChromeStore } from '@shared/lib/stores/uiChromeStore'
import { useConversationInitiative } from '../hooks/useConversationInitiative'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageLightbox } from '@shared/ui/ImageLightbox'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useChat } from '../hooks/useChat'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { MessageBubble } from './MessageBubble'
import { ChatInput } from './ChatInput'
import { OnboardingChips, ensureOnboardingBoot } from './OnboardingChips'
import { RouteLiveIndicator } from './RouteLiveIndicator'
import { SetupChecklist } from './SetupChecklist'
import { Image as ImageIcon, Sparkles } from 'lucide-react'
import { ImageGenPanel } from '@features/image/components/ImageGenPanel'
import { ActivitiesBar } from '@features/activities/ActivitiesBar'

interface Props {
  onOpenSettings?: () => void
  onOpenWizard?: () => void
}

function formatSummaryAge(ts?: number, now = Date.now()): string | null {
  if (!ts) return null
  const sec = Math.max(0, Math.floor((now - ts) / 1000))
  if (sec < 45) return 'hace unos segundos'
  if (sec < 90) return 'hace 1 min'
  if (sec < 3600) return `hace ${Math.floor(sec / 60)} min`
  if (sec < 7200) return 'hace 1 h'
  if (sec < 86400) return `hace ${Math.floor(sec / 3600)} h`
  return `hace ${Math.floor(sec / 86400)} d`
}

export function ChatView({ onOpenSettings, onOpenWizard }: Props) {
  const pluginsOpen = useUiChromeStore((s) => s.pluginsOpen)
  const setPluginsOpen = useUiChromeStore((s) => s.setPluginsOpen)

  useConversationInitiative(true)
  useEffect(() => {
    try {
      ensureOnboardingBoot()
    } catch {
      /* */
    }
  }, [])

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const { activeId, conversations, create } = useChatStore()
  const {
    isLoading,
    error,
    clearError,
    sendMessage,
    resendMessage,
    deleteMessage,
    stopStreaming,
    liveStatus
  } = useChat()
  const character = useSettingsStore((s) => s.settings.character)
  const showRoute = useSettingsStore((s) => s.settings.showRouteInfo)
  const dismissChecklist = useSettingsStore((s) => s.settings.dismissSetupChecklist)
  const imageGenEnabled = useSettingsStore((s) => s.settings.imageGenEnabled !== false)
  const [imageOpen, setImageOpen] = useState(false)
  const [imagePrefill, setImagePrefill] = useState('')
  const [imageBridge, setImageBridge] = useState<{
    negativePrompt?: string
    width?: number
    height?: number
    seed?: number
    alreadyBridged?: boolean
  }>({})

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{
          prompt?: string
          negativePrompt?: string
          width?: number
          height?: number
          seed?: number
          meta?: { source?: string }
        }>
      ).detail
      if (detail?.prompt) setImagePrefill(detail.prompt)
      setImageBridge({
        negativePrompt: detail?.negativePrompt,
        width: detail?.width,
        height: detail?.height,
        seed: detail?.seed,
        alreadyBridged: detail?.meta?.source === 'bridged' || detail?.meta?.source === 'user'
      })
      setImageOpen(true)
    }
    window.addEventListener('kawaii:open-image-gen', handler)
    return () => window.removeEventListener('kawaii:open-image-gen', handler)
  }, [])
  const bottomRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())

  const active = conversations.find((c) => c.id === activeId)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: isLoading ? 'auto' : 'smooth' })
  }, [active?.messages, isLoading, liveStatus?.phase])

  // Refresh relative time every 30s when a summary exists
  useEffect(() => {
    if (!active?.summaryUpdatedAt) return
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [active?.summaryUpdatedAt, active?.id])

  const summaryLabel = useMemo(() => {
    if (!active?.rollingSummary) return null
    const age = formatSummaryAge(active.summaryUpdatedAt, now)
    const src =
      active.summarySource === 'model'
        ? 'modelo'
        : active.summarySource === 'heuristic'
          ? 'heurístico'
          : null
    if (age && src) return `Resumen ${src} · ${age}`
    if (age) return `Resumen · ${age}`
    if (src) return `Resumen ${src}`
    return 'Resumen de contexto activo'
  }, [active?.rollingSummary, active?.summaryUpdatedAt, active?.summarySource, now])

  if (!active) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-kawaii-text-muted px-4">
        <Sparkles className="w-12 h-12 text-kawaii-pink" />
        <div className="flex flex-col items-center gap-2">
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden border-2 border-kawaii-pink/40 bg-white flex items-center justify-center text-4xl shadow-md">
            {character?.visualImageUrl ? (
              <img
                src={character.visualImageUrl}
                alt=""
                title="Ver avatar ampliado"
                className="w-full h-full object-cover cursor-zoom-in"
                onClick={() => character?.visualImageUrl && setLightboxSrc(character.visualImageUrl)}
              />
            ) : (
              <span>{character?.visualEmoji ?? '🌸'}</span>
            )}
          </div>
          <p className="text-lg font-semibold text-kawaii-text text-center">
            ¡Hola! Soy {character?.name ?? 'Kawaii'}
          </p>
          {character?.relationshipRole && (
            <p className="text-xs text-kawaii-pink-deep text-center max-w-sm">
              {character.relationshipRole}
            </p>
          )}
          {character?.tagline && (
            <p className="text-sm text-center text-kawaii-text-muted max-w-md">
              {character.tagline}
            </p>
          )}
        </div>
        <p className="text-sm text-center">
          Crea una conversación o completa los primeros pasos.
        </p>
        {!dismissChecklist && (
          <SetupChecklist
            onOpenSettings={onOpenSettings}
            onOpenWizard={onOpenWizard}
            onStartChat={() => create()}
          />
        )}
        <button className="btn-kawaii" onClick={() => create()}>
          Nueva conversación
        </button>
      </div>
    )
  }

  return (
    <>
    <div className="flex-1 flex flex-col min-h-0">
      <header className="px-3 py-1.5 border-b border-kawaii-border bg-white/70 backdrop-blur shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <h2 className="text-sm font-semibold text-kawaii-text truncate max-w-[40%] min-w-0" title={active.title}>
            {active.title}
          </h2>
          <span className="text-[10px] text-kawaii-text-muted truncate hidden sm:inline">
            {character?.name ?? 'Kawaii'}
          </span>
          <div className="flex-1" />
          <div className="flex items-center gap-1 flex-wrap justify-end">
            <ActivitiesBar />
            {summaryLabel && (
              <span
                className="text-[10px] text-kawaii-text-muted bg-kawaii-pink-soft/50 border border-kawaii-border rounded-full px-2 py-0.5 max-w-[140px] truncate"
                title={active.rollingSummary ? active.rollingSummary.slice(0, 400) : summaryLabel}
              >
                {summaryLabel}
              </span>
            )}
          </div>
        </div>
        {pluginsOpen && (
          <div className="relative mt-1">
            <PluginsPanel
              onClose={() => setPluginsOpen(false)}
              onInsertPhrase={(phrase) => {
                window.dispatchEvent(
                  new CustomEvent('kawaii:prefill-chat', { detail: { text: phrase } })
                )
                setPluginsOpen(false)
              }}
              onRunTools={(tools, phrase) => {
                window.dispatchEvent(
                  new CustomEvent('kawaii:run-host-tools', {
                    detail: { tools, phrase }
                  })
                )
                setPluginsOpen(false)
              }}
            />
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-3xl mx-auto">
          {active.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onResend={(id) => void resendMessage(id)}
              onDelete={(id) => deleteMessage(id)}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-amber-50 text-amber-900 text-xs flex justify-between items-start gap-2 border-t border-amber-200">
          <span className="leading-relaxed">
            <span className="font-semibold">Aviso: </span>
            {error}
          </span>
          <button type="button" className="underline shrink-0" onClick={clearError}>
            Cerrar
          </button>
        </div>
      )}

      <RouteLiveIndicator
        status={liveStatus}
        visible={showRoute !== false && (isLoading || liveStatus?.phase === 'done')}
      />

      {imageGenEnabled && (
        /* Prefer natural chat: «hazme una imagen de…» / feedback sobre la última foto */

        <>
          {!imageOpen && (
            <div className="px-4 py-1 border-t border-kawaii-border bg-white/50 flex justify-end">
              <button
                type="button"
                className="text-xs flex items-center gap-1 text-kawaii-pink-deep font-semibold hover:underline"
                onClick={() => setImageOpen(true)}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Opciones de imagen
              </button>
            </div>
          )}
          <ErrorBoundary
            name="Imagen"
            fallback={
              <div className="px-4 py-2 text-xs text-red-600 border-t border-kawaii-border">
                El módulo de imágenes falló. El chat sigue disponible.
                <button type="button" className="underline ml-2" onClick={() => setImageOpen(false)}>
                  Cerrar
                </button>
              </div>
            }
          >
            <ImageGenPanel
              open={imageOpen}
              onClose={() => {
                setImageOpen(false)
                setImagePrefill('')
                setImageBridge({})
              }}
              initialPrompt={imagePrefill}
              bridgedNegative={imageBridge.negativePrompt}
              bridgedWidth={imageBridge.width}
              bridgedHeight={imageBridge.height}
              bridgedSeed={imageBridge.seed}
              promptAlreadyBridged={Boolean(imageBridge.alreadyBridged)}
            />
          </ErrorBoundary>
        </>
      )}

      <OnboardingChips
          onChipSend={(label) => {
            void sendMessage(label)
          }}
        />
        <ChatInput
        isLoading={isLoading}
        onSend={sendMessage}
        onStop={stopStreaming}
      />
    </div>
    {lightboxSrc ? (
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    ) : null}
    </>
  )
}
