import { groupMemoryFacts } from '@core/conversation/user-memory'
import { MusicConsole } from './MusicConsole'
import { SystemTesterPanel } from './SystemTesterPanel'
import { ActivitiesPanel } from '@features/activities/ActivitiesPanel'
import { ForgeExtensionsPanel } from '@features/layers/ForgeExtensionsPanel'
import { AvatarGalleryPanel } from './AvatarGalleryPanel'
import { LocalSdModelsPanel } from './LocalSdModelsPanel'
import { LocalModelPicker } from './LocalModelPicker'
import { CharacterSetupAssistant } from './CharacterSetupAssistant'
import { ModelCatalogPanel } from '@features/models/ModelCatalogPanel'
import { ResourceBudgetPanel } from './ResourceBudgetPanel'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useEffect, useState } from 'react'
import { X, Stethoscope, Loader2, Music2, Image as ImageIcon, Video, Sparkles, Download, Play, RefreshCw } from 'lucide-react'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import type { ProviderMode } from '@shared/types/settings'
import { Button } from '@shared/ui/Button'
import { runSelfDiagnosis, type DiagReport } from '@core/diagnostics/self-heal'
import { runNetworkProbe } from '@core/diagnostics/network-probe'
import { AppMemoryPanel } from './AppMemoryPanel'
import { SdWorkspacePanel } from '@features/image/components/SdWorkspacePanel'
import { DEFAULT_CHARACTER } from '@core/character/profile'
import {
  SettingsUiProvider,
  PersonaPanel,
  ProvidersPanel,
  LayersPanel,
  ActividadesPanel,
  TesterPanel,
  AdvancedPanel
} from './panels'
import {
  activitySuccess,
  activityError,
  activityProgress,
  activityInfo,
  withActivity
} from '@shared/lib/stores/activityStore'

interface Props {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: Props) {
  const { settings, update, reset } = useSettingsStore()
  const [apiKey, setApiKey] = useState('')
  const [savedKeyHint, setSavedKeyHint] = useState('')
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({})
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [diag, setDiag] = useState<DiagReport | null>(null)
  const [diagRunning, setDiagRunning] = useState(false)
  const [charAssistOpen, setCharAssistOpen] = useState(false)
  const [musicSnap, setMusicSnap] = useState<{
    ok?: boolean
    ace?: { stage?: string; present?: boolean; lastError?: string }
    yue?: { stage?: string; disabledReason?: string }
    eligibility?: {
      summary?: string
      vramGB?: number | null
      ramGB?: number
      ace?: { eligible?: boolean; tier?: string; reason?: string }
      yue?: { eligible?: boolean; reason?: string }
      preferred?: string
    }
    musicRoot?: string
  } | null>(null)
  const [musicRuntime, setMusicRuntime] = useState<{
    state?: string
    message?: string
    baseUrl?: string
    bootProgress?: number
  } | null>(null)
  const [musicBusy, setMusicBusy] = useState(false)
  const [settingsSection, setSettingsSection] = useState<
    'persona' | 'layers' | 'providers' | 'advanced' | 'actividades' | 'tester'
  >('persona')
  const [traitsText, setTraitsText] = useState(
    (settings.character?.traits ?? []).join(', ')
  )

  useEffect(() => {
    if (!open) return
    setTraitsText((settings.character?.traits ?? []).join(', '))
    const refreshMusic = () => {
      void window.kawaii
        ?.musicStatus?.()
        .then((s) => setMusicSnap(s as typeof musicSnap))
        .catch(() => {})
      void window.kawaii
        ?.musicRuntimeStatus?.()
        .then((s) => setMusicRuntime(s as typeof musicRuntime))
        .catch(() => {})
    }
    refreshMusic()
    const unsub = window.kawaii?.onMusicRuntime?.((s) =>
      setMusicRuntime(s as typeof musicRuntime)
    )
    window.kawaii
      ?.getCloudApiKey?.()
      .then((k) => {
        setApiKey(k)
        setSavedKeyHint(k ? '••••••••' : '')
      })
      .catch(() => {})
    window.kawaii
      ?.getAllProviderKeys?.()
      .then((keys) => {
        setProviderKeys(keys)
        setKeyDrafts(keys)
      })
      .catch(() => {})
    return () => {
      try {
        unsub?.()
      } catch {
        /* ignore */
      }
    }
  }, [open, settings.character?.traits])

  if (!open) return null

  const char = settings.character ?? DEFAULT_CHARACTER

  const saveApiKey = async () => {
    try {
      await window.kawaii?.setCloudApiKey?.(apiKey)
      setSavedKeyHint(apiKey ? 'Guardada' : '')
      activitySuccess(
        apiKey ? 'API key guardada' : 'API key borrada',
        'La key se usa solo en este equipo.'
      )
    } catch (e) {
      activityError('No se pudo guardar la key', e instanceof Error ? e.message : String(e))
    }
  }

  const buildDiagOpts = async () => {
    const key = (await window.kawaii?.getCloudApiKey?.()) ?? ''
    const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
    const cfTok = Boolean((keys.cloudflare || '').trim())
    const live = useSettingsStore.getState().settings
    return {
      localBaseUrl: live.localBaseUrl,
      localModel: live.localModel,
      cloudBaseUrl: live.cloudBaseUrl,
      hasCloudKey: Boolean(key || keys.openrouter || keys.main),
      providerMode: live.providerMode,
      ollamaStart: () => window.kawaii.ollamaStart(live.localBaseUrl),
      imageGenEnabled: live.imageGenEnabled !== false,
      imageProviderMode: live.imageProviderMode || 'smart',
      a1111BaseUrl: live.a1111BaseUrl,
      cloudflareAccountId: live.cloudflareAccountId,
      hasCloudflareToken: cfTok,
      forgeStart: async () => {
        const r = await window.kawaii.forgeStart?.()
        return {
          ok: Boolean(r && (r as { ok?: boolean }).ok !== false && (r as { state?: string }).state !== 'error'),
          message: (r as { message?: string })?.message,
          baseUrl: (r as { baseUrl?: string })?.baseUrl
        }
      },
      forgeRefreshHealth: async () => {
        const r = await window.kawaii.forgeRefreshHealth?.()
        return {
          ok: Boolean((r as { ok?: boolean })?.ok || (r as { apiOk?: boolean })?.apiOk),
          baseUrl: (r as { baseUrl?: string })?.baseUrl,
          error: (r as { error?: string })?.error,
          apiOk: (r as { apiOk?: boolean })?.apiOk
        }
      },
      cloudflareProbe: (accountId: string) =>
        window.kawaii.imageCloudflareProbe?.(accountId) ??
        Promise.resolve({ ok: false, error: 'Probe no disponible' }),
      imageA1111Health: (baseUrl?: string) =>
        window.kawaii.imageA1111Health?.(baseUrl) ??
        Promise.resolve({ ok: false, error: 'Health no disponible' })
    }
  }

  const runDiag = async () => {
    setDiagRunning(true)
    const actId = activityProgress(
      'Autodiagnóstico',
      'Red, Ollama, cloud, Forge y Cloudflare…',
      10
    )
    try {
      const report = await runSelfDiagnosis(await buildDiagOpts())
      setDiag(report)
      const ok = Boolean(report.healthy)
      const { useActivityStore } = await import('@shared/lib/stores/activityStore')
      useActivityStore.getState().update(actId, {
        kind: ok ? 'success' : 'error',
        title: ok ? 'Diagnóstico OK' : 'Diagnóstico con avisos',
        detail: (report.checks || []).map((c: { label: string; status: string }) => `${c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '✗'} ${c.label}`).slice(0, 5).join(' · ') || (ok ? 'Todo en orden' : 'Revisa el informe'),
        progress: 100,
        ttlMs: ok ? 4000 : 12_000
      })
      window.setTimeout(() => useActivityStore.getState().dismiss(actId), ok ? 4000 : 12_000)
    } catch (e) {
      activityError('Diagnóstico falló', e instanceof Error ? e.message : String(e))
    } finally {
      setDiagRunning(false)
    }
  }

  
  const repairImageStack = async () => {
    setDiagRunning(true)
    const actId = activityProgress(
      'Reparar imágenes',
      'Forge --api + Cloudflare…',
      15
    )
    try {
      // 1) Persist CF account to secure store if present
      const live = useSettingsStore.getState().settings
      const acc = (live.cloudflareAccountId || '').trim()
      if (acc) {
        await window.kawaii.setProviderKey?.('cloudflareAccountId', acc)
      }
      // 2) Full diagnosis with auto forge start
      const report = await runSelfDiagnosis(await buildDiagOpts())
      setDiag(report)
      const forge = report.checks.find((c) => c.id === 'forge-api')
      const cf = report.checks.find((c) => c.id === 'cloudflare')
      const parts = [
        forge ? `Forge: ${forge.status}${forge.repaired ? ' (reparado)' : ''}` : '',
        cf ? `Cloudflare: ${cf.status}` : ''
      ].filter(Boolean)
      const ok = report.checks
        .filter((c) => c.id === 'forge-api' || c.id === 'cloudflare')
        .every((c) => c.status === 'ok' || c.status === 'warn')
      const { useActivityStore } = await import('@shared/lib/stores/activityStore')
      useActivityStore.getState().update(actId, {
        kind: ok ? 'success' : 'error',
        title: ok ? 'Capa de imágenes revisada' : 'Capa de imágenes con fallos',
        detail: parts.join(' · ') || report.checks.map((c) => c.label).slice(0, 4).join(' · '),
        progress: 100,
        ttlMs: 10_000
      })
      window.setTimeout(() => useActivityStore.getState().dismiss(actId), 10_000)
    } catch (e) {
      activityError('Reparar imágenes', e instanceof Error ? e.message : String(e))
    } finally {
      setDiagRunning(false)
    }
  }

  const probeNetworkOnly = async () => {
    const actId = activityProgress('Prueba de red', 'Consultando hosts públicos…', 20)
    try {
      const report = await runNetworkProbe({ timeoutMs: 5000 })
      activitySuccess('Red medida', report.summary)
      setDiag({
        at: report.at,
        healthy: report.level === 'online',
        checks: [
          {
            id: 'network',
            label: 'Red / Internet',
            status:
              report.level === 'online'
                ? 'ok'
                : report.level === 'partial'
                  ? 'warn'
                  : 'fail',
            detail: report.summary
          },
          ...report.targets.map((tg) => ({
            id: `net-${tg.id}`,
            label: tg.label,
            status: (tg.ok ? 'ok' : 'warn') as 'ok' | 'warn' | 'fail',
            detail: tg.ok
              ? `OK · ${tg.latencyMs} ms`
              : tg.error || 'Sin respuesta'
          }))
        ]
      })
    } catch (e) {
      activityError(
        'Prueba de red',
        e instanceof Error ? e.message : String(e)
      )
    } finally {
      // activity store dismiss handled by ttl often
      void actId
    }
  }


  const onAvatarFile = (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return
    if (file.size > 2_000_000) {
      alert('Imagen demasiado grande (máx. ~2 MB)')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = String(reader.result)
      update({
        character: {
          ...char,
          visualImageUrl: dataUrl,
          visualFromAvatar: true
        }
      })
      // Best-effort: derive physical description from avatar
      try {
        const { describeAvatarFromDataUrl } = await import('@core/character/avatar-describe')
        const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
        const key = keys.openrouter || keys.main || ''
        const res = await describeAvatarFromDataUrl(dataUrl, {
          apiKey: key,
          characterName: char.name
        })
        const desc = (res.description || '').trim()
        update({
          character: {
            ...useSettingsStore.getState().settings.character,
            visualImageUrl: dataUrl,
            visualDescription: desc,
            visualFromAvatar: Boolean(desc)
          }
        })
        if (res.source === 'vision' || res.source === 'ollama') {
          activitySuccess(
            'Avatar + descripción listos',
            'Se generó la descripción física desde la imagen.'
          )
        } else {
          activityInfo(
            'Avatar guardado sin descripción detallada',
            'Configura OpenRouter o un modelo vision en Ollama (llava) y pulsa regenerar descripción.'
          )
        }
      } catch {
        activityInfo('Avatar guardado', 'Sin descripción automática; puedes regenerarla después.')
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="card-kawaii w-full max-w-4xl max-h-[92vh] flex flex-col p-0 relative shadow-xl border border-kawaii-pink-deep/10 bg-gradient-to-b from-white to-rose-50/40 overflow-hidden">
        <div className="shrink-0 z-10 px-4 pt-4 pb-2 bg-white/95 border-b border-kawaii-border flex flex-wrap gap-1.5 items-center">
          {(
            [
              ['persona', 'Personalidad'],
              ['layers', 'Capas'],
              ['providers', 'Proveedores'],
              ['advanced', 'Avanzado'],
              ['actividades', 'Juegos'],
              ['tester', '🧪 Tester']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={
                'text-[11px] px-2.5 py-1 rounded-full border transition-colors ' +
                (settingsSection === id
                  ? 'bg-kawaii-pink-soft border-kawaii-pink-deep/40 text-kawaii-text font-semibold'
                  : 'bg-white border-kawaii-border text-kawaii-text-muted hover:border-kawaii-pink-deep/30')
              }
              onClick={() => {
                setSettingsSection(id)
                requestAnimationFrame(() => {
                  const map: Record<string, string> = {
                    persona: 'settings-persona',
                    layers: 'settings-resource-budget',
                    providers: 'settings-providers',
                    advanced: 'settings-advanced',
                    actividades: 'settings-actividades',
                    tester: 'settings-tester'
                  }
                  const el = document.getElementById(map[id] || '')
                  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                  // Focus section for a11y / visible feedback
                  el?.classList.add('ring-2', 'ring-kawaii-pink-deep/30')
                  window.setTimeout(() => el?.classList.remove('ring-2', 'ring-kawaii-pink-deep/30'), 900)
                })
              }}
            >
              {label}
            </button>
          ))}
        <p className="w-full text-[10px] text-kawaii-text-muted mt-1 px-0.5">
            {settingsSection === 'persona' && 'Personalidad, avatar, relación y asistente guiado.'}
            {settingsSection === 'layers' && 'Presupuesto RAM/VRAM, Forge, música (ACE) y vídeo.'}
            {settingsSection === 'providers' && 'API keys, Ollama y catálogo de modelos locales.'}
            {settingsSection === 'advanced' && 'Autodiagnóstico, red, memoria de errores y recuperación.'}
            {settingsSection === 'actividades' && 'Mini-juegos: aventura y ajedrez con el chat.'}
            {settingsSection === 'tester' && 'Informes 0.9.4, historial, comparación y export Markdown/JSON.'}
          </p>
          <button
            type="button"
            className="ml-auto p-1 rounded-full hover:bg-kawaii-pink-soft shrink-0"
            onClick={onClose}
            title="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-5 sm:px-6 py-4">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-kawaii-text tracking-tight">Ajustes</h2>
          <p className="text-[11px] text-kawaii-text-muted mt-0.5">
            Personalidad, capas, proveedores y herramientas avanzadas en un solo lugar.
          </p>
        </div>
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[11px] font-semibold text-kawaii-text">Modo de interfaz:</span>
            {(['smart', 'advanced'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => update({ uiComplexity: m })}
                className={`text-[11px] px-3 py-1.5 rounded-full border font-medium ${
                  (settings.uiComplexity || 'smart') === m
                    ? 'bg-kawaii-pink-deep text-white border-kawaii-pink-deep shadow-sm'
                    : 'border-kawaii-border text-kawaii-text-muted hover:border-kawaii-pink'
                }`}
              >
                {m === 'smart' ? '✨ Smart (recomendado)' : '🔧 Avanzado'}
              </button>
            ))}
            <label className="flex items-center gap-1.5 text-[11px] text-kawaii-text-muted ml-auto">
              <input
                type="checkbox"
                checked={settings.assistantTipsEnabled !== false}
                onChange={(e) => update({ assistantTipsEnabled: e.target.checked })}
              />
              Tips del asistente
            </label>
          </div>
          <p className="text-[11px] text-kawaii-text-muted rounded-kawaii border border-kawaii-border bg-kawaii-pink-soft/30 px-2.5 py-1.5">
            {(settings.uiComplexity || 'smart') === 'smart' ? (
              <>
                <strong className="text-kawaii-text">Smart:</strong> menos paneles, defaults
                seguros, el router elige proveedor. Oculta slots cloud detallados, timeouts y
                opciones de Forge/SD expertas. Ideal para uso diario.
              </>
            ) : (
              <>
                <strong className="text-kawaii-text">Avanzado:</strong> rotación de proveedores,
                tokens, timeouts, workspace SD/Forge, memoria de errores y autodiagnóstico
                completo. Cambia a Smart cuando no necesites tanto detalle.
              </>
            )}
          </p>
          <div className="rounded-kawaii border border-kawaii-border bg-white/70 px-2.5 py-2 space-y-1.5">
            <p className="text-[11px] font-medium text-kawaii-text">Datos locales (logs / harness)</p>
            <p className="text-[10px] text-kawaii-text-muted">
              Borra memorias de fallos del harness, historial de tests o feedback archivado. No borra
              chats ni Ajustes de personalidad.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="text-[11px] px-2 py-1 rounded-lg border border-kawaii-border hover:bg-kawaii-pink-soft"
                onClick={async () => {
                  const { pruneAppDiagnostics, listAppDataKeys } = await import('@core/agent')
                  const keys = listAppDataKeys()
                  const r = pruneAppDiagnostics({
                    clearFailures: true,
                    clearSuccess: true,
                    clearTestHistory: true
                  })
                  activityInfo(
                    `Limpieza suave: ${r.detail}`,
                    keys.slice(0, 8).join(', ') || 'sin claves'
                  )
                }}
              >
                Limpiar logs suaves
              </button>
              <button
                type="button"
                className="text-[11px] px-2 py-1 rounded-lg border border-amber-300 text-amber-900 hover:bg-amber-50"
                onClick={async () => {
                  if (!confirm('¿Borrar también likes/dislikes activos y archivos?')) return
                  const { pruneAppDiagnostics } = await import('@core/agent')
                  const r = pruneAppDiagnostics({
                    clearFailures: true,
                    clearSuccess: true,
                    clearFeedbackActive: true,
                    clearFeedbackArchives: true,
                    clearTestHistory: true
                  })
                  activityInfo(`Limpieza fuerte: ${r.detail}`)
                }}
              >
                Limpiar + feedback
              </button>
            </div>
          </div>
        </div>

        <section className="space-y-4">
          {/* Character */}

          <SettingsUiProvider
            value={{
              settings,
              update,
              char,
              traitsText,
              setTraitsText,
              charAssistOpen,
              setCharAssistOpen,
              onAvatarFile,
              apiKey,
              setApiKey,
              savedKeyHint,
              setSavedKeyHint,
              providerKeys,
              setProviderKeys,
              keyDrafts,
              setKeyDrafts,
              saveApiKey,
              diag,
              diagRunning,
              runDiag,
              repairImageStack,
              probeNetworkOnly,
              musicSnap,
              setMusicSnap,
              musicRuntime,
              setMusicRuntime,
              musicBusy,
              setMusicBusy
            }}
          >
            {settingsSection === 'persona' && <PersonaPanel />}
            {settingsSection === 'providers' && <ProvidersPanel />}
            {settingsSection === 'layers' && <LayersPanel />}
            {settingsSection === 'actividades' && <ActividadesPanel />}
            {settingsSection === 'tester' && <TesterPanel />}
            {settingsSection === 'advanced' && <AdvancedPanel />}
          </SettingsUiProvider>

          <div className="flex justify-between pt-2 px-4 pb-4">
            <Button variant="ghost" onClick={() => reset()}>
              Restablecer
            </Button>
            <Button onClick={onClose}>Cerrar</Button>
          </div>
        </section>
        </div>
      </div>
      {charAssistOpen && (
        <CharacterSetupAssistant
          value={char}
          onChange={(next) => update({ character: next })}
          onClose={() => setCharAssistOpen(false)}
          getOpenRouterKey={async () => {
            const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
            return keys.openrouter || keys.main || ''
          }}
        />
      )}
    </div>
  )
}
