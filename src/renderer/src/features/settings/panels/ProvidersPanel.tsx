/**
 * M3 — ProvidersPanel (reescrito: JSX del extract era inválido)
 */
import { Button } from '@shared/ui/Button'
import type { ProviderMode } from '@shared/types/settings'
import { LocalModelPicker } from '../LocalModelPicker'
import { useSettingsUi } from './SettingsUiContext'

export function ProvidersPanel() {
  const {
    settings,
    update,
    keyDrafts,
    setKeyDrafts,
    setProviderKeys,
    setApiKey,
    setSavedKeyHint
  } = useSettingsUi()

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-semibold mb-1">Modo de proveedor</label>
        <select
          className="input-kawaii"
          value={settings.providerMode}
          onChange={(e) => update({ providerMode: e.target.value as ProviderMode })}
        >
          <option value="smart">Smart (recomendado)</option>
          <option value="local">Solo local (Ollama / LM Studio)</option>
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
        <label className="block text-sm font-semibold mb-1">
          URL OpenAI-compatible (LM Studio, etc.)
        </label>
        <input
          className="input-kawaii"
          value={settings.localOpenAIBaseUrl || ''}
          onChange={(e) => update({ localOpenAIBaseUrl: e.target.value })}
          placeholder="http://127.0.0.1:1234/v1"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Modelo local</label>
        <LocalModelPicker />
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
          <h3 id="settings-providers" className="font-bold text-sm scroll-mt-4">
            Proveedores cloud (rotación)
          </h3>
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
          Pega la API key de cada proveedor. Solo se usan los que estén activos y con key. Si uno
          falla por cuota, se prueba el siguiente.
        </p>
        {(settings.cloudSlots?.length ? settings.cloudSlots : []).map((slot) => (
          <div
            key={slot.id}
            className="border border-kawaii-border rounded-lg p-2 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">{slot.label || slot.id}</span>
              <label className="flex items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={slot.enabled !== false}
                  onChange={(e) => {
                    const next = (settings.cloudSlots || []).map((s) =>
                      s.id === slot.id ? { ...s, enabled: e.target.checked } : s
                    )
                    update({ cloudSlots: next })
                  }}
                />
                Activo
              </label>
            </div>
            {slot.baseUrl ? (
              <p className="text-[10px] text-kawaii-text-muted truncate">{slot.baseUrl}</p>
            ) : null}
            <input
              className="input-kawaii text-sm"
              type="password"
              placeholder="API key"
              value={keyDrafts[slot.id] ?? ''}
              onChange={(e) =>
                setKeyDrafts((prev) => ({ ...prev, [slot.id]: e.target.value }))
              }
            />
            <Button
              variant="ghost"
              className="text-xs"
              onClick={async () => {
                const k = keyDrafts[slot.id] ?? ''
                await window.kawaii?.setProviderKey?.(slot.id, k)
                setProviderKeys((prev) => ({ ...prev, [slot.id]: k }))
                if (slot.id === 'openrouter' || slot.priority === 0) {
                  setApiKey(k)
                  setSavedKeyHint(k ? '••••••••' : '')
                  if (slot.baseUrl) update({ cloudBaseUrl: slot.baseUrl })
                }
              }}
            >
              Guardar key
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
