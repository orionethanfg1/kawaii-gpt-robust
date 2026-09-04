import { Suspense, lazy, useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { ErrorBoundary } from './ErrorBoundary'
import { Sidebar } from '@features/chat/components/Sidebar'
import { ChatView } from '@features/chat/components/ChatView'
import { RecoveryBanner } from '@features/chat/components/RecoveryBanner'
import { useDownloadStore } from '@features/models/downloadStore'
import { useRecoveryStore } from '@shared/lib/stores/recoveryStore'
import { GenerativeLayersBadge } from '@features/generative/GenerativeLayersBadge'
import { ActivityToasts } from '@shared/ui/ActivityToasts'

/**
 * Wizard / settings / download bar: lazy (optional surface).
 * Sidebar + Chat: eager so the main UI always paints.
 */
const SettingsModal = lazy(() =>
  import('@features/settings/SettingsModal').then((m) => ({ default: m.SettingsModal }))
)
const SetupWizard = lazy(() =>
  import('@features/wizard/SetupWizard').then((m) => ({ default: m.SetupWizard }))
)
const DownloadBar = lazy(() =>
  import('@features/models/DownloadBar').then((m) => ({ default: m.DownloadBar }))
)
const ContextualTips = lazy(() =>
  import('@features/assistant/ContextualTips').then((m) => ({ default: m.ContextualTips }))
)
const ModelsStatusPanel = lazy(() =>
  import('@features/models/ModelsStatusPanel').then((m) => ({
    default: m.ModelsStatusPanel
  }))
)

function useOllamaPullBridge() {
  const upsert = useDownloadStore((s) => s.upsert)
  const remove = useDownloadStore((s) => s.remove)

  useEffect(() => {
    try {
      const unsub = window.kawaii?.onOllamaPullProgress?.((p) => {
        try {
          if (p.status === 'success') {
            upsert({ model: p.model, state: 'done', status: 'Listo', progress: 100 })
            setTimeout(() => remove(p.model), 5000)
            return
          }
          if (p.status === 'cancelled') {
            upsert({
              model: p.model,
              state: 'paused',
              status: 'Pausado — puedes Continuar'
            })
            return
          }
          if (p.error || p.status === 'error') {
            upsert({
              model: p.model,
              state: 'error',
              status: 'Error',
              error: p.error || p.status
            })
            return
          }
          upsert({
            model: p.model,
            state: 'running',
            status: p.status || 'Descargando…',
            progress: p.progress,
            kind: 'ollama'
          })
        } catch (err) {
          console.error('[pull-bridge]', err)
        }
      })
      return () => {
        try {
          unsub?.()
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.error('[pull-bridge setup]', err)
    }
  }, [upsert, remove])
}

function useBackgroundSummarySafe() {
  const enabled = useSettingsStore((s) => s.settings.backgroundSummaryEnabled)
  useEffect(() => {
    if (enabled === false) return
    let stop: (() => void) | undefined
    void import('@features/chat/services/backgroundSummary')
      .then((mod) => {
        try {
          stop = mod.startBackgroundSummary({ idleMs: 8_000, scanIntervalMs: 12_000 })
        } catch (err) {
          console.error('[backgroundSummary start]', err)
        }
      })
      .catch((err) => console.error('[backgroundSummary import]', err))
    return () => {
      try {
        stop?.()
      } catch {
        /* ignore */
      }
    }
  }, [enabled])
}

export function AppShell() {
  const uiComplexity = useSettingsStore((s) => s.settings.uiComplexity || 'smart')


  // Boot: restore SD download recovery into global bar
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await window.kawaii?.sdListRecovery?.()
        if (cancelled || !r?.ok) return
        const { useDownloadStore } = await import('@features/models/downloadStore')
        for (const j of r.jobs || []) {
          const st =
            j.status === 'paused'
              ? 'paused'
              : j.status === 'failed' || j.status === 'cancelled'
                ? 'error'
                : j.status === 'completed'
                  ? 'done'
                  : 'paused' // incomplete on disk — user must resume (don't fake running)
          useDownloadStore.getState().upsert({
            model: `SD:${j.id}`,
            status:
              st === 'error'
                ? j.error || `Falló · ${Math.round(j.pct)}% — Reanudar`
                : `Recovery · ${j.status} · ${Math.round(j.pct)}% — Continuar`,
            progress: j.pct,
            state: st === 'done' ? 'done' : st === 'error' ? 'error' : 'paused',
            kind: 'sd',
            error: j.error
          })
        }
        const fr = await window.kawaii?.forgeListRecovery?.()
        if (fr && Array.isArray(fr)) {
          for (const j of fr as Array<{
            id?: string
            label?: string
            status?: string
            received?: number
            total?: number | null
          }>) {
            const id = j.id || 'forge'
            const pct =
              j.total && j.total > 0
                ? Math.min(99, ((j.received || 0) / j.total) * 100)
                : 0
            useDownloadStore.getState().upsert({
              model: `Forge:${id}`,
              status: `Recovery · ${j.status || 'paused'}`,
              progress: pct,
              state: 'paused',
              kind: 'forge'
            })
          }
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const hasCompletedSetup = useSettingsStore((s) => s.settings.hasCompletedSetup)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showWizard, setShowWizard] = useState(() => !hasCompletedSetup)
  // Persist rehydration: open wizard only if setup never completed
  useEffect(() => {
    if (!hasCompletedSetup) setShowWizard(true)
  }, [hasCompletedSetup])

  useOllamaPullBridge()
  useBackgroundSummarySafe()

  // boot-prep-silent: leave engines ready without technical errors in chat
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = useSettingsStore.getState().settings
        await window.kawaii?.ollamaStart?.(s.localBaseUrl).catch(() => null)
        if (cancelled) return
        if (s.imageGenEnabled !== false) {
          const h = await window.kawaii?.imageA1111Health?.(s.a1111BaseUrl).catch(() => null)
          if (cancelled) return
          if (!h || !(h as { ok?: boolean }).ok) {
            // Try start Forge quietly; ignore user-facing noise
            await window.kawaii?.forgeStart?.().catch(() => null)
          }
        }
      } catch {
        /* silent */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-kawaii-cream via-kawaii-pink-soft/30 to-kawaii-purple-soft/40">
      {showWizard && (
        <ErrorBoundary name="Asistente">
          <Suspense fallback={null}>
            <SetupWizard onComplete={() => setShowWizard(false)} />
          </Suspense>
        </ErrorBoundary>
      )}

      <header className="flex items-center justify-between px-4 py-2 border-b border-kawaii-border bg-white/60 backdrop-blur shrink-0 z-10">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>
            🌸
          </span>
          <h1 className="font-bold text-lg text-kawaii-text tracking-tight">
            KawaiiGPT <span className="text-kawaii-pink-deep font-semibold">Robust</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ErrorBoundary name="Capas" fallback={null}><span className="text-[10px] px-2 py-0.5 rounded-full border border-kawaii-border text-kawaii-text-muted hidden sm:inline">
            UI: {uiComplexity === 'advanced' ? 'Avanzado' : 'Smart'}
          </span>
          <GenerativeLayersBadge /></ErrorBoundary>
          <Button
            variant="ghost"
            className="text-xs"
            onClick={() => setShowWizard(true)}
            title="Asistente de configuración"
          >
            Asistente
          </Button>
          <Button variant="ghost" onClick={() => setSettingsOpen(true)} title="Ajustes">
            <Settings className="w-4 h-4" />
            Ajustes
          </Button>
        </div>
      </header>

      <RecoveryBanner />

      <div className="flex-1 flex min-h-0">
        <ErrorBoundary
          name="Sidebar"
          fallback={
            <aside className="w-56 shrink-0 p-3 text-xs text-kawaii-text-muted border-r border-kawaii-border bg-white/40">
              Sidebar no disponible
            </aside>
          }
        >
          <Sidebar />
        </ErrorBoundary>

        <ErrorBoundary
          name="Chat"
          fallback={
            <div className="flex-1 p-6 text-sm text-kawaii-text">
              El chat no pudo cargar. Revisa la terminal de npm run dev.
            </div>
          }
        >
          <ChatView
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenWizard={() => setShowWizard(true)}
          />
        </ErrorBoundary>
      </div>

      <ErrorBoundary name="Descargas" fallback={null}>
        <Suspense fallback={null}>
          <Suspense fallback={null}>
            <ContextualTips />
          </Suspense>
          <DownloadBar />
          <ActivityToasts />
        </Suspense>
      </ErrorBoundary>

      {settingsOpen && (
        <ErrorBoundary name="Ajustes">
          <Suspense fallback={null}>
            <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
