import { useAgendaDue } from '@features/chat/hooks/useAgendaDue'
import { AboutSystemModal } from '../features/about/AboutSystemModal'
import { useLayerScheduleToasts } from '../features/layers/useLayerScheduleToasts'
import { GitSyncPanel } from '@/features/git/GitSyncPanel'
import { ensureVisualDescriptionFromAvatar } from '@features/settings/ensureVisualDescription'
import { runAutoBootstrap } from '@features/assistant/autoBootstrap'
import { Suspense, lazy, useEffect, useState } from 'react'
import { PanelLeftClose, PanelLeft, Puzzle } from 'lucide-react'
import { KawaiiIcon } from '@shared/ui/KawaiiIcon'
import { useUiChromeStore } from '@shared/lib/stores/uiChromeStore'
import { Button } from '@shared/ui/Button'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { ErrorBoundary } from './ErrorBoundary'
import { Sidebar } from '@features/chat/components/Sidebar'
import { ChatView } from '@features/chat/components/ChatView'
import { RecoveryBanner } from '@features/chat/components/RecoveryBanner'
import { useDownloadStore } from '@features/models/downloadStore'
import { GenerativeLayersBadge } from '@features/generative/GenerativeLayersBadge'
import { ActivityToasts } from '@shared/ui/ActivityToasts'
import { AgentApprovalBanner } from '@shared/ui/AgentApprovalBanner'

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
  useLayerScheduleToasts()
  useAgendaDue()
  const sidebarCollapsed = useUiChromeStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiChromeStore((s) => s.toggleSidebar)
  const pluginsOpen = useUiChromeStore((s) => s.pluginsOpen)
  const togglePlugins = useUiChromeStore((s) => s.togglePlugins)
  useEffect(() => {
    const onGit = () => setGitOpen(true)
    window.addEventListener('kawaii:open-git-sync', onGit)
    return () => window.removeEventListener('kawaii:open-git-sync', onGit)
  }, [])

  useEffect(() => {
    const unsub = window.kawaii?.onActivityWindowClosed?.(() => {
      void import('@features/activities/companion').then(({ endActivityWithComment }) => {
        endActivityWithComment('window-closed')
      })
    })
    return () => {
      unsub?.()
    }
  }, [])

  const [aboutOpen, setAboutOpen] = useState(false)

  useEffect(() => {
    void runAutoBootstrap()
    // Extra pass for avatar description if bootstrap is still downloading vision
    const t = window.setTimeout(() => void ensureVisualDescriptionFromAvatar(), 12_000)
    return () => window.clearTimeout(t)
  }, [])

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
  const [gitOpen, setGitOpen] = useState(false)

  // ESC cierra ajustes / Git / asistente
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (settingsOpen) {
        e.preventDefault()
        setSettingsOpen(false)
        return
      }
      if (gitOpen) {
        e.preventDefault()
        setGitOpen(false)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, gitOpen])

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
          <button
            type="button"
            className="p-1.5 rounded-lg border border-kawaii-border hover:bg-white/80 text-kawaii-text-muted"
            title={sidebarCollapsed ? 'Mostrar panel' : 'Ocultar panel'}
            onClick={() => toggleSidebar()}
          >
            {sidebarCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
          <KawaiiIcon name="app" size={28} title="KawaiiGPT" />
          <h1 className="font-bold text-lg text-kawaii-text tracking-tight">
            KawaiiGPT <span className="text-kawaii-pink-deep font-semibold">Robust</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <ErrorBoundary name="Capas" fallback={null}>
            <GenerativeLayersBadge />
          </ErrorBoundary>
          <button
            type="button"
            className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition ${
              uiComplexity === 'advanced'
                ? 'bg-violet-100 border-violet-400 text-violet-900'
                : 'bg-kawaii-pink-soft border-kawaii-pink-deep text-kawaii-pink-deep'
            }`}
            title="Alternar interfaz Smart / Avanzada"
            onClick={() => {
              const next = uiComplexity === 'advanced' ? 'smart' : 'advanced'
              useSettingsStore.getState().update({ uiComplexity: next })
            }}
          >
            {uiComplexity === 'advanced' ? '🔧 Avanzada' : '✨ Smart'}
          </button>
          <Button
            variant="ghost"
            className={`text-xs ${pluginsOpen ? 'bg-kawaii-pink-soft' : ''}`}
            onClick={() => togglePlugins()}
            title="Plugins y skills"
          >
            <Puzzle className="w-4 h-4" />
            Plugins
          </Button>
          <Button
            variant="ghost"
            className="text-xs"
            onClick={() => setShowWizard(true)}
            title="Asistente de configuración"
          >
            <KawaiiIcon name="ai" size={16} className="mr-1" />
            Asistente
          </Button>
          <Button
            variant="ghost"
            className="text-xs"
            onClick={() => setAboutOpen(true)}
            title="Tu equipo y Acerca de"
          >
            Equipo
          </Button>
          <Button variant="ghost" onClick={() => setSettingsOpen(true)} title="Ajustes">
            <KawaiiIcon name="settings" size={16} className="mr-1" />
            Ajustes
          </Button>
        </div>
      </header>

      <RecoveryBanner />
      <AgentApprovalBanner />

      <div className="flex-1 flex min-h-0">
        {!sidebarCollapsed && (
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
        )}

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

      {aboutOpen && (
        <ErrorBoundary name="Equipo">
          <AboutSystemModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
        </ErrorBoundary>
      )}

      {settingsOpen && (
        <ErrorBoundary name="Ajustes">
          <Suspense fallback={null}>
            <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      )}
      {gitOpen && (
        <ErrorBoundary name="GitHub">
          <GitSyncPanel open={gitOpen} onClose={() => setGitOpen(false)} />
        </ErrorBoundary>
      )}
    </div>
  )
}