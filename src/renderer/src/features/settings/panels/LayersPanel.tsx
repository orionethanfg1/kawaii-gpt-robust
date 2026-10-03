/**
 * M3 — LayersPanel
 */
import { useSettingsUi } from './SettingsUiContext'
import { Button } from '@shared/ui/Button'
import { Download, Play, RefreshCw, Loader2, Image as ImageIcon, Music2, Video } from 'lucide-react'
import { SdWorkspacePanel } from '@features/image/components/SdWorkspacePanel'
import { ResourceBudgetPanel } from '../ResourceBudgetPanel'
import { LocalSdModelsPanel } from '../LocalSdModelsPanel'
import { ForgeConsole } from '../ForgeConsole'
import { LayerConsole } from '../LayerConsole'
import { MusicConsole } from '../MusicConsole'
import { ModelCatalogPanel } from '@features/models/ModelCatalogPanel'
import { ForgeExtensionsPanel } from '@features/layers/ForgeExtensionsPanel'
import {
  withActivity,
  activitySuccess,
  activityError,
  activityInfo
} from '@shared/lib/stores/activityStore'


export function LayersPanel() {
  const {
    settings,
    update,
    char,
    traitsText,
    setTraitsText,
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
  } = useSettingsUi()

  return (
    <div className="space-y-3">
  <div id="settings-resource-budget" className="scroll-mt-4 ">
    <ResourceBudgetPanel />
  </div>
  <div id="settings-layers" className="scroll-mt-4 space-y-3 rounded-kawaii border border-kawaii-border bg-white/60 p-3 ">
    <div>
      <h3 className="font-bold text-sm text-kawaii-text">Capas generativas (multicapa)</h3>
      <p className="text-[11px] text-kawaii-text-muted mt-1">
        El chat de texto es el centro. Imagen, música o video solo se usan cuando el mensaje
        lo pide y la capa está activa.
      </p>
    </div>

    <div className="rounded-lg border border-kawaii-border p-3 space-y-1.5 bg-kawaii-pink-soft/15">
      <div className="flex items-center gap-2">
        <ImageIcon className="w-4 h-4 text-kawaii-pink-deep shrink-0" />
        <span className="text-xs font-semibold flex-1">Imagen</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800">
          Activa
        </span>
      </div>
      <p className="text-[10px] text-kawaii-text-muted pl-6">
        Forge/SD local, Cloudflare, Pollinations, OpenAI. Configura el modo más abajo.
      </p>
    </div>

    <ForgeExtensionsPanel />

    <div className="rounded-lg border border-sky-200/80 p-3 space-y-2 bg-sky-50/40">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm shrink-0" aria-hidden>🔊</span>
        <span className="text-xs font-semibold flex-1">Voz del chat (LATAM)</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-sky-200 bg-sky-50 text-sky-900">
          es-MX
        </span>
      </div>
      <p className="text-[10px] text-kawaii-text-muted">
        Voces neuronales Edge · por defecto <strong>Dalia (México)</strong>, acento
        latinoamericano neutro. No usa la voz robótica de Windows. Requiere Python +
        <code className="text-[9px]">edge-tts</code> (se intenta instalar solo).
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={settings.voiceTtsEnabled !== false}
          onChange={(e) => update({ voiceTtsEnabled: e.target.checked })}
        />
        Mostrar botón 🔊 en mensajes del asistente
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={settings.voiceTtsAutoPlay === true}
          onChange={(e) => update({ voiceTtsAutoPlay: e.target.checked })}
        />
        Leer automáticamente las respuestas (experimental)
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={settings.voiceTtsActivitiesOnly === true}
          onChange={(e) => update({ voiceTtsActivitiesOnly: e.target.checked })}
        />
        Voz solo en mini-juegos (aventura / ajedrez)
      </label>
      <label className="block text-[10px] text-kawaii-text-muted">
        Voz
        <select
          className="mt-0.5 w-full text-xs rounded border border-kawaii-border px-2 py-1.5 bg-white"
          value={settings.voiceTtsVoiceId || 'es-MX-DaliaNeural'}
          onChange={(e) => update({ voiceTtsVoiceId: e.target.value })}
        >
          <option value="es-MX-DaliaNeural">Dalia · México (neutro LATAM)</option>
          <option value="es-MX-JorgeNeural">Jorge · México</option>
          <option value="es-CO-SalomeNeural">Salomé · Colombia</option>
          <option value="es-AR-ElenaNeural">Elena · Argentina</option>
          <option value="es-PE-CamilaNeural">Camila · Perú</option>
          <option value="es-US-PalomaNeural">Paloma · EE.UU. español</option>
          <option value="es-ES-ElviraNeural">Elvira · España (opcional)</option>
        </select>
      </label>
      <button
        type="button"
        className="text-[11px] px-2.5 py-1.5 rounded-lg bg-sky-600 text-white hover:bg-sky-700"
        onClick={() => {
          void (async () => {
            const { activityInfo, activityError } = await import(
              '@shared/lib/stores/activityStore'
            )
            activityInfo('Instalando motor de voz…')
            try {
              const r = await window.kawaii?.voiceEnsure?.()
              if (r?.ok) {
                activityInfo(
                  r.installed
                    ? 'Motor de voz instalado. Ya puedes usar 🔊'
                    : 'Motor de voz listo'
                )
              } else {
                activityError(r?.error || 'No se pudo instalar el motor de voz')
              }
              const log = await window.kawaii?.voiceGetLog?.()
              if (log?.lines?.length) {
                const el = document.getElementById('kawaii-voice-console')
                if (el) el.textContent = log.lines.slice(-40).join('\n')
              }
            } catch (e) {
              activityError(e instanceof Error ? e.message : String(e))
            }
          })()
        }}
      >
        Instalar / reparar motor de voz
      </button>
      <div className="w-full space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-kawaii-text-muted">
            Consola de voz
          </span>
          <button
            type="button"
            className="text-[10px] text-sky-700 hover:underline"
            onClick={() => {
              void (async () => {
                const log = await window.kawaii?.voiceGetLog?.()
                const el = document.getElementById('kawaii-voice-console')
                if (el) {
                  el.textContent = (log?.lines || []).slice(-60).join('\n') || '(vacío)'
                }
              })()
            }}
          >
            Actualizar
          </button>
        </div>
        <pre
          id="kawaii-voice-console"
          className="text-[10px] leading-snug max-h-28 overflow-auto rounded border border-kawaii-border bg-zinc-950 text-zinc-200 p-2 whitespace-pre-wrap break-all"
        >
          Pulsa Actualizar o 🔊 para ver logs…
        </pre>
      </div>
    </div>

    <div className="rounded-lg border border-violet-200/80 p-3 space-y-2 bg-violet-50/50">
      <div className="flex items-center gap-2 flex-wrap">
        <Music2 className="w-4 h-4 text-violet-600 shrink-0" />
        <span className="text-xs font-semibold flex-1">Música · ACE-Step</span>
        <span
          className={
            'text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ' +
            (musicRuntime?.state === 'running'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : musicRuntime?.state === 'starting'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : musicSnap?.ace?.stage === 'ready' || musicSnap?.ace?.stage === 'models'
                  ? 'border-sky-200 bg-sky-50 text-sky-900'
                  : musicSnap?.ace?.stage === 'cloned' || musicSnap?.ace?.stage === 'venv'
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : musicSnap?.eligibility?.ace?.eligible
                      ? 'border-violet-200 bg-violet-50 text-violet-900'
                      : 'border-kawaii-border bg-white text-kawaii-text-muted')
          }
        >
          {musicRuntime?.state === 'running'
            ? 'API activa'
            : musicRuntime?.state === 'starting'
              ? 'Arrancando…'
              : musicSnap?.ace?.stage === 'ready'
                ? 'Entorno listo'
                : musicSnap?.ace?.stage === 'cloned' || musicSnap?.ace?.stage === 'venv'
                  ? 'Código instalado'
                  : musicSnap?.ace?.stage === 'error'
                    ? 'Error install'
                    : musicSnap?.eligibility?.ace?.eligible
                      ? 'Pendiente instalar'
                      : 'No elegible'}
        </span>
      </div>
      <p className="text-[10px] text-kawaii-text-muted">
        Motor local tipo Suno (ACE-Step). YuE solo con GPU ≥16&nbsp;GB VRAM.
      </p>
      {musicSnap?.eligibility ? (
        <div className="flex flex-wrap gap-1 text-[10px]">
          <span className="rounded-full border border-kawaii-border bg-white px-2 py-0.5">
            VRAM {musicSnap.eligibility.vramGB ?? '?'} GB
          </span>
          <span className="rounded-full border border-kawaii-border bg-white px-2 py-0.5">
            RAM {musicSnap.eligibility.ramGB ?? '?'} GB
          </span>
          <span
            className={
              'rounded-full border px-2 py-0.5 ' +
              (musicSnap.eligibility.ace?.eligible
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-kawaii-border bg-white text-kawaii-text-muted')
            }
          >
            ACE {musicSnap.eligibility.ace?.eligible ? `sí · ${musicSnap.eligibility.ace?.tier || ''}` : 'no'}
          </span>
          <span
            className={
              'rounded-full border px-2 py-0.5 ' +
              (musicSnap.eligibility.yue?.eligible
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-kawaii-border bg-white text-kawaii-text-muted')
            }
          >
            YuE {musicSnap.eligibility.yue?.eligible ? 'sí' : 'no'}
          </span>
        </div>
      ) : (
        <p className="text-[10px] text-kawaii-text-muted">Pulsa «Analizar PC» para ver compatibilidad.</p>
      )}
      {musicRuntime?.state === 'running' || musicRuntime?.state === 'starting' ? (
        <p className="text-[10px] text-violet-900">
          {musicRuntime.message}
          {musicRuntime.baseUrl ? ` · ${musicRuntime.baseUrl}` : ''}
          {typeof musicRuntime.bootProgress === 'number' && musicRuntime.state === 'starting'
            ? ` · ${musicRuntime.bootProgress}%`
            : ''}
        </p>
      ) : musicSnap?.ace?.stage === 'error' && musicSnap?.ace?.lastError ? (
        <p className="text-[10px] text-red-700 break-words">{musicSnap.ace.lastError}</p>
      ) : null}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={settings.musicGenEnabled === true}
          onChange={(e) =>
            update({
              musicGenEnabled: e.target.checked,
              musicProviderMode: e.target.checked ? 'local' : 'off'
            })
          }
        />
        Usar música cuando el chat lo pida
      </label>
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="ghost"
          className="text-[11px]"
          disabled={musicBusy}
          onClick={async () => {
            setMusicBusy(true)
            try {
              await withActivity('Música', async (upd) => {
                upd('Analizando hardware…', 30)
                const a = await window.kawaii?.musicAnalyze?.()
                const st = (a as { state?: typeof musicSnap })?.state
                if (st) setMusicSnap(st)
                else if (a && (a as { eligibility?: unknown }).eligibility) {
                  setMusicSnap(a as typeof musicSnap)
                }
                const s = await window.kawaii?.musicStatus?.()
                if (s) setMusicSnap(s as typeof musicSnap)
                upd('Análisis listo', 100)
                return a
              }, { successMessage: 'Hardware analizado' })
            } catch {
              /* withActivity already toasts error */
            } finally {
              setMusicBusy(false)
            }
          }}
        >
          <RefreshCw className="w-3 h-3 mr-1 inline" />
          Analizar PC
        </Button>
        <Button
          variant="ghost"
          className="text-[11px]"
          disabled={musicBusy}
          onClick={async () => {
            setMusicBusy(true)
            try {
              await withActivity(
                'Música',
                async (upd) => {
                  upd('Descargando / instalando ACE-Step…', 15)
                  const unsub = window.kawaii?.onMusicInstallProgress?.((p) => {
                    upd(p.message || 'Instalando…', Math.min(95, p.pct || 20))
                  })
                  try {
                    const r = await window.kawaii?.musicInstall?.({})
                    if ((r as { ok?: boolean })?.ok === false) {
                      throw new Error(
                        String((r as { error?: string })?.error || 'Instalación fallida')
                      )
                    }
                    const s = await window.kawaii?.musicStatus?.()
                    if (s) setMusicSnap(s as typeof musicSnap)
                    upd('Instalación completa', 100)
                    return r
                  } finally {
                    unsub?.()
                  }
                },
                { successMessage: 'ACE-Step instalado' }
              )
            } catch {
              /* toasted */
            } finally {
              setMusicBusy(false)
            }
          }}
        >
          <Download className="w-3 h-3 mr-1 inline" />
          Instalar
        </Button>
        <Button
          variant="ghost"
          className="text-[11px]"
          disabled={musicBusy}
          onClick={async () => {
            setMusicBusy(true)
            try {
              await withActivity(
                'Música',
                async (upd) => {
                  upd('Arrancando ACE-Step API…', 15)
                  const unsub = window.kawaii?.onMusicRuntime?.((s) => {
                    setMusicRuntime(s as typeof musicRuntime)
                    const msg = String(
                      (s as { message?: string }).message ||
                        (s as { lastLogLine?: string }).lastLogLine ||
                        'Arrancando…'
                    )
                    const pct =
                      typeof (s as { bootProgress?: number }).bootProgress === 'number'
                        ? Math.max(15, Math.min(95, (s as { bootProgress: number }).bootProgress))
                        : 30
                    upd(msg.slice(0, 140), pct)
                  })
                  try {
                    const r = await window.kawaii?.musicEnsureReady?.()
                    setMusicRuntime(r as typeof musicRuntime)
                    if ((r as { state?: string })?.state === 'error') {
                      throw new Error(
                        String((r as { message?: string })?.message || 'No arrancó')
                      )
                    }
                    if ((r as { state?: string })?.state !== 'running') {
                      throw new Error(
                        String(
                          (r as { message?: string })?.message ||
                            'ACE no quedó en running'
                        )
                      )
                    }
                    upd(String((r as { message?: string })?.message || 'API lista'), 100)
                    return r
                  } finally {
                    unsub?.()
                  }
                },
                { successMessage: 'Motor de música listo' }
              )
            } catch {
              /* toasted */
            } finally {
              setMusicBusy(false)
            }
          }}
        >
          <Play className="w-3 h-3 mr-1 inline" />
          Arrancar
        </Button>
      </div>
      <MusicConsole />
    </div>

    <div className="rounded-lg border border-kawaii-border p-3 space-y-1.5 opacity-90">
      <div className="flex items-center gap-2">
        <Video className="w-4 h-4 text-kawaii-text-muted shrink-0" />
        <span className="text-xs font-semibold flex-1">Video</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-kawaii-border bg-white text-kawaii-text-muted">
          Próximamente
        </span>
      </div>
      <p className="text-[10px] text-kawaii-text-muted pl-6">
        Aún no hay motor. El interruptor solo reserva la capa para más adelante.
      </p>
      <label className="flex items-center gap-2 text-xs pl-6">
        <input
          type="checkbox"
          checked={settings.videoGenEnabled === true}
          onChange={(e) =>
            update({
              videoGenEnabled: e.target.checked,
              videoProviderMode: e.target.checked ? 'local' : 'off'
            })
          }
        />
        Reservar capa de video
      </label>
    </div>

    <div className="rounded-lg border border-kawaii-border p-3 space-y-2 bg-white/70">
      <p className="text-xs font-semibold text-kawaii-text">Iniciativa de conversación</p>
      <p className="text-[10px] text-kawaii-text-muted">
        Si la app sigue abierta y no escribes en un rato, el chat puede enviarte un mensaje
        corto. Actívalo aquí o en Persona. No interrumpe mientras escribes.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={settings.conversationInitiativeEnabled === true}
          onChange={(e) =>
            update({ conversationInitiativeEnabled: e.target.checked })
          }
        />
        Tomar iniciativa de conversación
      </label>
      {settings.conversationInitiativeEnabled ? (
        <div className="space-y-2 pl-1">
          <label className="flex flex-col gap-0.5 text-[11px] text-kawaii-text-muted">
            Frecuencia
            <select
              className="input-kawaii text-sm"
              value={settings.conversationInitiativeMode || 'personality'}
              onChange={(e) =>
                update({
                  conversationInitiativeMode: e.target.value as
                    | 'personality'
                    | 'fixed'
                })
              }
            >
              <option value="personality">
                Según personalidad (desesperada ~1 min; profesional ~10 min)
              </option>
              <option value="fixed">Duración fija</option>
            </select>
          </label>
          {(settings.conversationInitiativeMode || 'personality') === 'fixed' ? (
            <label className="block text-[11px] text-kawaii-text-muted">
              Minutos de espera
              <input
                type="number"
                min={1}
                max={120}
                className="input-kawaii text-sm w-24 mt-0.5 ml-2"
                value={settings.conversationInitiativeMinutes ?? 4}
                onChange={(e) =>
                  update({
                    conversationInitiativeMinutes: Math.max(
                      1,
                      Math.min(120, Number(e.target.value) || 4)
                    )
                  })
                }
              />
            </label>
          ) : (
            <p className="text-[10px] text-kawaii-text-muted">
              El tono del personaje define la cadencia (p. ej. desesperada ~1 min, calmada ~7 min). En el chat puedes decir «dame 5 minutos» o «no me hables en 2
              minutos».
            </p>
          )}
        </div>
      ) : null}
    </div>

    {settings.imageGenEnabled ? (
      <div className="rounded-lg border border-kawaii-border p-3 space-y-2 bg-white/70">
        <p className="text-xs font-semibold">Imagen · proveedor y Forge</p>
        <label className="block text-xs font-semibold">Modo</label>
        <select
          className="input-kawaii text-sm"
          value={settings.imageProviderMode}
          onChange={(e) =>
            update({
              imageProviderMode: e.target.value as
                | 'off'
                | 'cloud'
                | 'local'
                | 'smart'
            })
          }
        >
          <option value="cloud">Cloud (Pollinations)</option>
          <option value="smart">Smart (local → cloud)</option>
          <option value="local">Solo local (Forge/A1111)</option>
        </select>
        <label className="block text-xs font-semibold">URL Forge / A1111</label>
        <input
          className="input-kawaii text-sm"
          value={settings.a1111BaseUrl}
          onChange={(e) => update({ a1111BaseUrl: e.target.value })}
          placeholder="http://127.0.0.1:7860"
        />
        <p className="text-[10px] text-kawaii-text-muted">
          Arranca WebUI con <code>--api</code>. Checkpoints en la carpeta models del
          WebUI (SD 1.5 si VRAM menor a 8 GB; SDXL si 8 GB o mas).
        </p>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.imageUseCharacterStyle !== false}
            onChange={(e) =>
              update({ imageUseCharacterStyle: e.target.checked })
            }
          />
          Usar estilo / ficha del personaje en prompts de imagen
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            className="text-xs"
            onClick={async () => {
              const res = await window.kawaii.imageA1111Health?.(settings.a1111BaseUrl)
              alert(res?.ok ? `Forge OK (${res.latencyMs} ms)` : res?.error || 'Sin respuesta')
            }}
          >
            Probar Forge
          </Button>
          <Button
            variant="ghost"
            className="text-xs"
            onClick={async () => {
              const res = await window.kawaii.imageA1111Models?.(settings.a1111BaseUrl)
              if (!res?.ok) {
                alert(res?.error || 'No se pudieron listar checkpoints')
                return
              }
              const names = (res.models || []).map((m: { title?: string }) => m.title)
              const pick =
                res.current && names.includes(res.current)
                  ? res.current
                  : names[0] || ''
              if (pick) update({ a1111Checkpoint: pick })
              alert(
                names.length
                  ? `Checkpoints (${names.length}):\n${names.slice(0, 15).join('\n')}${
                      names.length > 15 ? '\n…' : ''
                    }\n\nSeleccionado: ${pick || '(ninguno)'}`
                  : 'WebUI respondió sin modelos'
              )
            }}
          >
            Listar checkpoints
          </Button>
          {settings.a1111Checkpoint ? (
            <p className="text-[10px] text-kawaii-text-muted truncate w-full">
              Checkpoint activo: {settings.a1111Checkpoint}
            </p>
          ) : null}

          <div className="w-full pt-1">
            <ForgeConsole />
          </div>
          <Button
            variant="ghost"
            className="text-xs"
            onClick={async () => {
              const r = await window.kawaii.imageCleanup?.(30)
              alert(
                r?.ok
                  ? `Limpieza: ${r.removed} archivos > 30 días`
                  : r?.error || 'Error'
              )
            }}
          >
            Limpiar imágenes antiguas
          </Button>
        </div>
      </div>
    ) : null}
  </div>

<div className="border border-kawaii-border rounded-kawaii p-3 space-y-2">
  <h3 className="font-bold text-sm">Catálogo de modelos locales</h3>
  <ModelCatalogPanel />
</div>


{(settings.character?.relationshipHistory?.length || settings.character?.relationshipReaction) ? (
  <div className="border border-kawaii-border rounded-kawaii p-3 space-y-2 bg-white/50">
    <h3 className="font-bold text-sm">Relación (auto desde el chat)</h3>
    {settings.character?.relationshipRole ? (
      <p className="text-xs">
        <span className="text-kawaii-text-muted">Rol actual:</span>{' '}
        {settings.character.relationshipRole}
      </p>
    ) : null}
    {settings.character?.relationshipReaction ? (
      <p className="text-xs">
        <span className="text-kawaii-text-muted">Reacción auténtica:</span>{' '}
        {settings.character.relationshipReaction}
      </p>
    ) : null}
    {(settings.character?.relationshipHistory || []).length > 0 ? (
      <ul className="text-[11px] text-kawaii-text-muted space-y-1 max-h-28 overflow-y-auto">
        {[...(settings.character?.relationshipHistory || [])]
          .slice()
          .reverse()
          .map((h, i) => (
            <li key={`${h.at}-${i}`}>
              {new Date(h.at).toLocaleString()} · {h.fromRole} → {h.toRole}
              <br />
              <span className="opacity-80">{h.reaction}</span>
            </li>
          ))}
      </ul>
    ) : null}
    <p className="text-[10px] text-kawaii-text-muted">
      Se actualiza solo cuando el usuario redefine el vínculo con claridad en el chat.
    </p>
  </div>
) : null}


    </div>
  )
}
