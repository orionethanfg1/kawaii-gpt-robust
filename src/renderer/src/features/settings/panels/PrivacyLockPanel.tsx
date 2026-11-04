/**
 * B — Candado de app (PIN propio, sin biometría del SO).
 */
import { useState } from 'react'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import {
  setupLock,
  isValidPinFormat
} from '@core/security/app-lock'
import { Button } from '@shared/ui/Button'

export function PrivacyLockPanel() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const enabled = Boolean(settings.appLockEnabled && settings.appLockPinHashB64)

  const enable = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await setupLock(pin, pin2)
      if (!r.ok) {
        setMsg(r.error)
        return
      }
      update({
        appLockEnabled: true,
        appLockSaltB64: r.saltB64,
        appLockPinHashB64: r.pinHashB64
      })
      setPin('')
      setPin2('')
      setMsg('Candado activado. Se pedirá el PIN al abrir o tras inactividad.')
    } finally {
      setBusy(false)
    }
  }

  const disable = () => {
    update({
      appLockEnabled: false,
      appLockSaltB64: '',
      appLockPinHashB64: ''
    })
    // Keep session usable — do not leave UI locked after disabling
    void import('@core/security/app-lock').then(({ markSessionUnlocked }) => {
      markSessionUnlocked()
    })
    setMsg('Candado desactivado.')
  }

  return (
    <div className="space-y-3 rounded-kawaii border border-kawaii-border bg-white/70 p-3">
      <h3 className="font-bold text-sm text-kawaii-text">Privacidad · Candado de la app</h3>
      <p className="text-[10px] text-kawaii-text-muted">
        PIN de 4–12 dígitos guardado solo en este dispositivo (hash PBKDF2). No usa Windows Hello
        ni huella del sistema: funciona aunque el SO no tenga biometría.
      </p>
      {enabled ? (
        <div className="space-y-2">
          <p className="text-[11px] text-emerald-800">✓ Candado activo</p>
          <label className="flex items-center gap-2 text-[11px]">
            Tiempo de inactividad (min)
            <input
              type="number"
              min={1}
              max={120}
              className="input-kawaii w-16 text-sm"
              value={settings.appLockTimeoutMinutes ?? 5}
              onChange={(e) =>
                update({ appLockTimeoutMinutes: Math.max(1, Math.min(120, +e.target.value || 5)) })
              }
            />
          </label>
          <label className="flex items-start gap-2 text-[11px] cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(settings.discreteMode)}
              onChange={(e) => update({ discreteMode: e.target.checked })}
            />
            <span>
              Modo discreto
              <span className="block text-[10px] text-kawaii-text-muted">
                Al cambiar de ventana o ocultar la app, se bloquea y se difumina la UI.
              </span>
            </span>
          </label>
          <Button type="button" className="text-[11px]" onClick={disable}>
            Quitar candado
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="password"
            inputMode="numeric"
            className="input-kawaii w-full text-sm"
            placeholder="PIN nuevo (4–12 dígitos)"
            value={pin}
            maxLength={12}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          <input
            type="password"
            inputMode="numeric"
            className="input-kawaii w-full text-sm"
            placeholder="Repite el PIN"
            value={pin2}
            maxLength={12}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
          />
          <Button
            type="button"
            className="text-[11px]"
            disabled={busy || !isValidPinFormat(pin)}
            onClick={() => void enable()}
          >
            Activar candado
          </Button>
        </div>
      )}
      {msg ? <p className="text-[11px] text-kawaii-text-muted">{msg}</p> : null}
      <p className="text-[10px] text-kawaii-text-muted border-t border-kawaii-border pt-2">
        Chats: usa el icono 🔒 en la lista para marcar un chat como privado (oculta el título).
        Exportar con candado activo pedirá el PIN si hay privados.
      </p>
    </div>
  )
}
