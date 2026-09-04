import { CharacterSetupAssistant } from './CharacterSetupAssistant'
import { ForgeConsole } from './ForgeConsole'
import { ModelCatalogPanel } from '@features/models/ModelCatalogPanel'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useEffect, useState } from 'react'
import { X, Stethoscope, Loader2 } from 'lucide-react'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import type { ProviderMode } from '@shared/types/settings'
import { Button } from '@shared/ui/Button'
import { runSelfDiagnosis, type DiagReport } from '@core/diagnostics/self-heal'
import { runNetworkProbe } from '@core/diagnostics/network-probe'
import { AppMemoryPanel } from './AppMemoryPanel'
import { SdWorkspacePanel } from '@features/image/components/SdWorkspacePanel'
import { DEFAULT_CHARACTER } from '@core/character/profile'
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
  const [traitsText, setTraitsText] = useState(
    (settings.character?.traits ?? []).join(', ')
  )

  useEffect(() => {
    if (!open) return
    setTraitsText((settings.character?.traits ?? []).join(', '))
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
        update({
          character: {
            ...useSettingsStore.getState().settings.character,
            visualImageUrl: dataUrl,
            visualDescription: res.description,
            visualFromAvatar: true
          }
        })
        activitySuccess(
          res.source === 'vision' ? 'Avatar + descripción listos' : 'Avatar guardado',
          res.source === 'vision'
            ? 'Se generó la descripción física desde la imagen.'
            : 'Puedes regenerar la descripción con OpenRouter.'
        )
      } catch {
        activityInfo('Avatar guardado', 'Sin descripción automática; puedes regenerarla después.')
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="card-kawaii w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6 relative shadow-xl">
        <button
          className="absolute top-4 right-4 p-1 rounded-full hover:bg-kawaii-pink-soft"
          onClick={onClose}
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold text-kawaii-text mb-4">Ajustes ⚙️</h2>
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
        </div>

        <section className="space-y-4">
          {/* Character */}
          <div className="border border-kawaii-border rounded-kawaii p-3 space-y-3 bg-kawaii-pink-soft/20">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-sm text-kawaii-text">Personalidad y avatar</h3>
              <Button
                variant="ghost"
                className="text-[11px]"
                onClick={() => setCharAssistOpen(true)}
              >
                Asistente de personalidad
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-white border border-kawaii-border flex items-center justify-center text-2xl overflow-hidden">
                {char.visualImageUrl ? (
                  <img
                    src={char.visualImageUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  char.visualEmoji
                )}
              </div>
              <div className="flex-1 space-y-1">
                <input
                  className="input-kawaii text-sm"
                  value={char.visualEmoji}
                  onChange={(e) =>
                    update({ character: { ...char, visualEmoji: e.target.value } })
                  }
                  placeholder="Emoji 🌸"
                />
                <input
                  type="file"
                  accept="image/*"
                  className="text-[11px] w-full"
                  onChange={(e) => onAvatarFile(e.target.files?.[0] ?? null)}
                />
                {char.visualImageUrl && (
                  <button
                    type="button"
                    className="text-[11px] text-red-600 underline"
                    onClick={() =>
                      update({
                        character: { ...char, visualImageUrl: undefined }
                      })
                    }
                  >
                    Quitar imagen
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Nombre</label>
              <input
                className="input-kawaii"
                value={char.name}
                onChange={(e) =>
                  update({ character: { ...char, name: e.target.value } })
                }
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Tagline</label>
              <input
                className="input-kawaii"
                value={char.tagline}
                onChange={(e) =>
                  update({ character: { ...char, tagline: e.target.value } })
                }
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Relación con el usuario
              </label>
              <input
                className="input-kawaii"
                value={char.relationshipRole ?? ''}
                onChange={(e) =>
                  update({
                    character: { ...char, relationshipRole: e.target.value }
                  })
                }
                placeholder="Ej: mejor amiga, mentor, asistente profesional…"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                Descripción visual / física
              </label>
              <textarea
                className="input-kawaii min-h-[70px]"
                value={char.visualDescription ?? ''}
                onChange={(e) =>
                  update({
                    character: { ...char, visualDescription: e.target.value }
                  })
                }
                placeholder="Ej: cabello pastel ondulado, ojos grandes y cálidos, detalle floral, estética kawaii suave…"
              />
              <p className="text-[10px] text-kawaii-text-muted mt-0.5">
                Idealmente generada desde el avatar (se intenta al subir la imagen). El
                chat la usa al describirse físicamente.
                {char.visualFromAvatar ? ' · Ligada al avatar.' : ''}
              </p>
              <button
                type="button"
                className="text-[11px] text-kawaii-pink-deep underline"
                onClick={async () => {
                  if (!char.visualImageUrl) return
                  const { describeAvatarFromDataUrl } = await import(
                    '@core/character/avatar-describe'
                  )
                  const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
                  const act = activityProgress('Describiendo avatar', 'Analizando imagen…', 20)
                  try {
                    const res = await describeAvatarFromDataUrl(char.visualImageUrl, {
                      apiKey: keys.openrouter || keys.main || '',
                      characterName: char.name
                    })
                    update({
                      character: {
                        ...char,
                        visualDescription: res.description,
                        visualFromAvatar: true
                      }
                    })
                    const { useActivityStore } = await import('@shared/lib/stores/activityStore')
                    useActivityStore.getState().update(act, {
                      kind: 'success',
                      title:
                        res.source === 'vision'
                          ? 'Descripción desde avatar'
                          : 'Descripción base del avatar',
                      detail: res.description.slice(0, 120) + (res.description.length > 120 ? '…' : ''),
                      progress: 100,
                      ttlMs: 5000
                    })
                    window.setTimeout(() => useActivityStore.getState().dismiss(act), 5000)
                  } catch (e) {
                    activityError(
                      'No se pudo describir el avatar',
                      e instanceof Error ? e.message : String(e)
                    )
                  }
                }}
              >
                Regenerar descripción desde avatar
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Personalidad</label>
              <textarea
                className="input-kawaii min-h-[80px]"
                value={char.personality}
                onChange={(e) =>
                  update({ character: { ...char, personality: e.target.value } })
                }
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Estilo de respuesta</label>
              <textarea
                className="input-kawaii min-h-[60px]"
                value={char.style}
                onChange={(e) =>
                  update({ character: { ...char, style: e.target.value } })
                }
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Rasgos (separados por coma)
              </label>
              <input
                className="input-kawaii"
                value={traitsText}
                onChange={(e) => setTraitsText(e.target.value)}
                onBlur={() =>
                  update({
                    character: {
                      ...char,
                      traits: traitsText
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean)
                    }
                  })
                }
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Modo de proveedor</label>
            <select
              className="input-kawaii"
              value={settings.providerMode}
              onChange={(e) =>
                update({ providerMode: e.target.value as ProviderMode })
              }
            >
              <option value="smart">Smart (recomendado)</option>
              <option value="local">Solo local (Ollama)</option>
              <option value="cloud">Solo cloud</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">URL local (Ollama)</label>
            <input
              className="input-kawaii"
              value={settings.localBaseUrl}
              onChange={(e) => update({ localBaseUrl: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Modelo local</label>
            <input
              className="input-kawaii"
              placeholder="ej: llama3.2:3b"
              value={settings.localModel}
              onChange={(e) => update({ localModel: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">URL cloud</label>
            <input
              className="input-kawaii"
              value={settings.cloudBaseUrl}
              onChange={(e) => update({ cloudBaseUrl: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Modelo cloud</label>
            <input
              className="input-kawaii"
              value={settings.cloudModel}
              onChange={(e) => update({ cloudModel: e.target.value })}
            />
          </div>

          <div className="border border-kawaii-border rounded-kawaii p-3 space-y-3 bg-white/50">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-sm">Proveedores cloud (rotación)</h3>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={settings.cloudAutoRotate !== false}
                  onChange={(e) => update({ cloudAutoRotate: e.target.checked })}
                />
                Auto-rotar
              </label>
            </div>
            <p className="text-[11px] text-kawaii-text-muted leading-relaxed">
              1) Crea una key en el sitio del proveedor (botón de enlace). 2) Pégala en el campo de
              ese proveedor. 3) Si OpenRouter dice que el modelo free ya no existe, pon el modelo{' '}
              <code>openrouter/free</code>. No uses la misma key de Groq en OpenRouter ni al revés.
              Si uno falla por cuota, se prueba el siguiente con key.
            </p>
            <p className="text-[11px] text-kawaii-text-muted mb-2">
              Solo se usan los proveedores con <strong>Activo</strong> y API key.
              Desactivar Groq (u otro) evita por completo que se consulte, aunque la key esté guardada.
            </p>
            {(settings.cloudSlots?.length
              ? settings.cloudSlots
              : []
            ).map((slot) => (
              <div
                key={slot.id}
                className="border border-kawaii-border rounded-lg p-2 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={slot.enabled}
                      onChange={(e) => {
                        const next = (settings.cloudSlots || []).map((s) =>
                          s.id === slot.id ? { ...s, enabled: e.target.checked } : s
                        )
                        update({ cloudSlots: next })
                        const toggled = next.find((s) => s.id === slot.id)
                        if (toggled) {
                          activityInfo(
                            toggled.enabled
                              ? `${toggled.name} activado`
                              : `${toggled.name} desactivado`,
                            toggled.enabled
                              ? 'Entrará en la rotación cloud si hay key.'
                              : 'No se usará aunque tenga key guardada.'
                          )
                        }
                      }}
                    />
                    {slot.name}
                  </label>
                  <span className="text-[10px] text-kawaii-text-muted">
                    prioridad {slot.priority}
                  </span>
                </div>
                <input
                  className="input-kawaii text-xs"
                  value={slot.model}
                  onChange={(e) => {
                    const next = (settings.cloudSlots || []).map((s) =>
                      s.id === slot.id ? { ...s, model: e.target.value } : s
                    )
                    const patch: Record<string, unknown> = { cloudSlots: next }
                    if (slot.id === 'openrouter' || slot.priority === 0) {
                      patch.cloudModel = e.target.value
                      patch.cloudBaseUrl = slot.baseUrl
                    }
                    update(patch as any)
                  }}
                  placeholder="modelo"
                />
                <div className="flex gap-2">
                  <input
                    className="input-kawaii flex-1 text-xs"
                    type="password"
                    value={keyDrafts[slot.id] ?? ''}
                    onChange={(e) =>
                      setKeyDrafts((d) => ({ ...d, [slot.id]: e.target.value }))
                    }
                    placeholder={
                      providerKeys[slot.id] ? '•••• key guardada' : 'API key'
                    }
                  />
                  <Button
                    className="text-xs"
                    onClick={async () => {
                      const k = keyDrafts[slot.id] ?? ''
                      await window.kawaii?.setProviderKey?.(slot.id, k)
                      setProviderKeys((prev) => ({ ...prev, [slot.id]: k }))
                      if (slot.id === 'openrouter') {
                        setApiKey(k)
                        await window.kawaii?.setCloudApiKey?.(k)
                      }
                    }}
                  >
                    Guardar
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              API key principal (compat)
            </label>
            <div className="flex gap-2">
              <input
                className="input-kawaii flex-1"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={savedKeyHint || 'sk-…'}
              />
              <Button onClick={() => void saveApiKey()}>Guardar</Button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              Instrucciones extra (system)
            </label>
            <textarea
              className="input-kawaii min-h-[60px]"
              value={settings.systemPrompt}
              onChange={(e) => update({ systemPrompt: e.target.value })}
              placeholder="Opcional; se suma a la personalidad"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.showRouteInfo}
              onChange={(e) => update({ showRouteInfo: e.target.checked })}
            />
            Mostrar modelo / ruta / motivo bajo cada respuesta
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.autoDiagnoseOnError}
              onChange={(e) => update({ autoDiagnoseOnError: e.target.checked })}
            />
            Autodiagnóstico al fallar un proveedor
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.backgroundSummaryEnabled !== false}
              onChange={(e) =>
                update({ backgroundSummaryEnabled: e.target.checked })
              }
            />
            Resumen de contexto en segundo plano (en reposo)
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.backgroundSummaryAllowCloud === true}
              disabled={settings.backgroundSummaryEnabled === false}
              onChange={(e) =>
                update({ backgroundSummaryAllowCloud: e.target.checked })
              }
            />
            <span>
              Permitir resumen en background vía{' '}
              <strong>cloud</strong> si no hay Ollama
              <span className="block text-[11px] text-kawaii-text-muted">
                Opt-in: puede consumir cuota del proveedor (gratis o de pago).
              </span>
            </span>
          </label>

          <div className="border border-kawaii-border rounded-kawaii p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={settings.imageGenEnabled === true}
                onChange={(e) => {
                  const on = e.target.checked
                  update({
                    imageGenEnabled: on,
                    imageProviderMode: on
                      ? settings.imageProviderMode === 'off'
                        ? 'cloud'
                        : settings.imageProviderMode
                      : 'off'
                  })
                }}
              />
              Generación de imágenes
            </label>
            <p className="text-[11px] text-kawaii-text-muted">
              Botón en el chat o comando <code>/image tu descripción</code>.
            </p>
            {settings.imageGenEnabled && (
              <>
                <ErrorBoundary name="SD-Workspace" fallback={<p className="text-xs text-red-600">Módulo SD no disponible.</p>}>
            {(settings.uiComplexity || 'smart') === 'advanced' ? (
                  <SdWorkspacePanel />
                ) : (
                  <p className="text-[11px] text-kawaii-text-muted">
                    Workspace Forge/SD (rutas, instalar, health): cambia a{' '}
                    <strong>Avanzado</strong> para el panel completo. En Smart basta
                    el botón Generar imagen del chat.
                  </p>
                )}
          </ErrorBoundary>

          <div className="border border-kawaii-border rounded-kawaii p-3 space-y-2">
            <div className="rounded-kawaii border border-kawaii-border p-3 space-y-2 mb-3">
              <h3 className="font-bold text-sm text-kawaii-text">Memoria del usuario</h3>
              <p className="text-[11px] text-kawaii-text-muted leading-relaxed">
                Hechos breves que se envían al modelo (los cloud no leen discos de la app).
                Se extraen al hablar (p.ej. «me llamo…», «me gusta…»).
              </p>
              <ul className="text-xs list-disc pl-4 space-y-0.5 max-h-28 overflow-y-auto">
                <label className="block text-xs font-semibold mb-1">
                  Tu nombre (para que el chat te llame bien)
                  <input
                    className="mt-1 w-full rounded-kawaii border border-kawaii-border px-2 py-1.5 text-sm"
                    value={settings.userMemory?.preferredName || ''}
                    placeholder="Ej. Orion"
                    onChange={(e) => {
                      const preferredName = e.target.value.trim() || undefined
                      const facts = (settings.userMemory?.facts || []).filter(
                        (f) => !/^Nombre preferido:/i.test(f)
                      )
                      if (preferredName) facts.unshift(`Nombre preferido: ${preferredName}`)
                      update({ userMemory: { ...settings.userMemory, preferredName, facts } })
                    }}
                  />
                </label>
                {(settings.userMemory?.facts || []).length === 0 && !settings.userMemory?.preferredName ? (
                  <li className="text-kawaii-text-muted list-none -ml-4">
                    Sin hechos aún.
                  </li>
                ) : (
                  (settings.userMemory?.facts || []).map((f) => <li key={f}>{f}</li>)
                )}
              </ul>
              {(settings.userMemory?.facts || []).length > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-kawaii-pink-deep hover:underline"
                  onClick={() =>
                    update({ userMemory: { facts: [], preferredName: undefined } })
                  }
                >
                  Borrar memoria del usuario
                </button>
              )}
            </div>

            <h3 className="font-bold text-sm text-kawaii-text">Capas generativas (multicapa)</h3>
            <p className="text-[11px] text-kawaii-text-muted">
              El chat de texto es el centro. Imagen, música y video solo se usan cuando el mensaje lo
              pide y la capa está activa.
            </p>
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
              Música (experimental — motor más adelante)
            </label>
            <label className="flex items-center gap-2 text-xs">
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
              Video (experimental — sin motor aún)
            </label>
          </div>

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
                  Aplicar estilo de la personalidad al prompt
                </label>

                <div className="rounded-kawaii border border-kawaii-border p-2 space-y-2 mt-2">
                  <p className="text-[11px] font-semibold">Cloudflare Workers AI (FLUX.1 Schnell)</p>
                  <p className="text-[10px] text-kawaii-text-muted">
                    Gratis con cuota diaria (~150–170 imgs). Dashboard → Workers AI → Use REST API.
                    Crea un token con permiso Workers AI.
                  </p>
                  <label className="block text-xs">Account ID
                    <input
                      className="input-kawaii text-sm w-full mt-0.5"
                      value={settings.cloudflareAccountId || ''}
                      onChange={(e) => {
                        const v = e.target.value.trim()
                        update({ cloudflareAccountId: v })
                        if (v.length >= 16) {
                          void window.kawaii.setProviderKey?.('cloudflareAccountId', v)
                        }
                      }}
                      placeholder="Account ID (Overview del dashboard)"
                    />
                  </label>
                  <label className="block text-xs">API Token
                    <input
                      type="password"
                      className="input-kawaii text-sm w-full mt-0.5"
                      id="cf-token-input"
                      placeholder="Pega el token y pulsa Guardar"
                      autoComplete="off"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      className="text-xs"
                      onClick={async () => {
                        const el = document.getElementById('cf-token-input') as HTMLInputElement | null
                        const token = (el?.value || '').trim()
                        const acc = (settings.cloudflareAccountId || '').trim()
                        if (!acc) {
                          alert('Falta el Account ID')
                          return
                        }
                        if (token) {
                          await window.kawaii.setProviderKey?.('cloudflare', token)
                        }
                        // mirror account id in secure store for main process fallback
                        await window.kawaii.setProviderKey?.(
                          'cloudflareAccountId',
                          acc
                        )
                        const h = await window.kawaii.imageCloudflareProbe?.(acc)
                        alert(
                          h?.ok
                            ? `Guardado. Cloudflare OK (${h.latencyMs} ms)`
                            : `Guardado. Prueba: ${h?.error || 'error'}\n\nRevisa Account ID + token Workers AI.`
                        )
                      }}
                    >
                      Guardar y probar Cloudflare
                    </Button>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  className="text-xs"
                  onClick={async () => {
                    const h = await window.kawaii.imageA1111Health?.(
                      settings.a1111BaseUrl
                    )
                    alert(
                      h?.ok
                        ? `A1111 OK (${h.modelsCount ?? 0} modelos, ${h.latencyMs}ms)`
                        : `A1111 no responde: ${h?.error || 'error'}`
                    )
                  }}
                >
                  Probar A1111
                </Button>
                <Button
                  variant="ghost"
                  className="text-xs"
                  onClick={async () => {
                    const res = await window.kawaii.imageA1111Models?.(
                      settings.a1111BaseUrl
                    )
                    if (!res?.ok) {
                      alert(res?.error || 'No se pudieron listar checkpoints')
                      return
                    }
                    const names = (res.models || []).map((m) => m.title)
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
                  <p className="text-[10px] text-kawaii-text-muted truncate">
                    Checkpoint activo: {settings.a1111Checkpoint}
                  </p>
                ) : null}
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
              </>
            )}
          </div>

          {(settings.uiComplexity || 'smart') === 'advanced' ? (
            <AppMemoryPanel />
          ) : (
            <p className="text-[11px] text-kawaii-text-muted border border-kawaii-border rounded-kawaii p-2">
              Memoria de errores y recovery detallado: activa el modo{' '}
              <strong>Avanzado</strong> arriba.
            </p>
          )}

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

          {/* Diagnostics */}

          <div className="border border-kawaii-border rounded-kawaii p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-1">
                <Stethoscope className="w-4 h-4" /> Autodiagnóstico
              </h3>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  className="text-xs"
                  disabled={diagRunning}
                  onClick={() => void probeNetworkOnly()}
                >
                  Probar red
                </Button>
                <Button
                  variant="ghost"
                  className="text-xs"
                  disabled={diagRunning}
                  onClick={() => void runDiag()}
                >
                  {diagRunning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : null}
                  Ejecutar
                </Button>
              <Button
                variant="ghost"
                className="text-xs"
                disabled={diagRunning}
                onClick={() => void repairImageStack()}
              >
                Reparar capa de imágenes
              </Button>
              </div>
            </div>
            {diag && (
              <ul className="space-y-1 text-xs">
                {diag.checks.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <span>
                      {c.status === 'ok' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'}
                    </span>
                    <span>
                      <strong>{c.label}</strong>: {c.detail}
                      {c.repaired ? ' (reparado)' : ''}
                      {c.repairAction ? (
                        <span className="block text-kawaii-text-muted">
                          → {c.repairAction}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => reset()}>
              Restablecer
            </Button>
            <Button onClick={onClose}>Cerrar</Button>
          </div>
        </section>
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
