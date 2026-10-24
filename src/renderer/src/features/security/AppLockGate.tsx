/**
 * Full-screen PIN gate — app-owned, no OS biometrics.
 * Must never leave the user with a blank UI (no access to settings).
 */
import { useEffect, useState } from 'react'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import {
  needsLockGate,
  tryUnlock,
  touchActivity,
  lockSession,
  markSessionUnlocked,
  type AppLockConfig
} from '@core/security/app-lock'

function lockConfigFromSettings(s: {
  appLockEnabled?: boolean
  appLockSaltB64?: string
  appLockPinHashB64?: string
  appLockTimeoutMinutes?: number
  discreteMode?: boolean
}): AppLockConfig {
  return {
    enabled: Boolean(s.appLockEnabled),
    saltB64: s.appLockSaltB64 || '',
    pinHashB64: s.appLockPinHashB64 || '',
    timeoutMinutes: s.appLockTimeoutMinutes ?? 5,
    discreteMode: Boolean(s.discreteMode)
  }
}

export function AppLockGate({ children }: { children: React.ReactNode }) {
  const settings = useSettingsStore((st) => st.settings)
  const update = useSettingsStore((st) => st.update)
  const cfg = lockConfigFromSettings(settings)
  const [locked, setLocked] = useState(() => needsLockGate(cfg))
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fails, setFails] = useState(0)

  // Misconfigured lock (enabled without hash/salt) → disable so UI is not bricked
  useEffect(() => {
    if (settings.appLockEnabled && (!settings.appLockPinHashB64 || !settings.appLockSaltB64)) {
      update({
        appLockEnabled: false,
        appLockSaltB64: '',
        appLockPinHashB64: ''
      })
      markSessionUnlocked()
      setLocked(false)
    }
  }, [settings.appLockEnabled, settings.appLockPinHashB64, settings.appLockSaltB64, update])

  // Poll inactivity + re-check lock
  useEffect(() => {
    if (!cfg.enabled || !cfg.pinHashB64 || !cfg.saltB64) {
      setLocked(false)
      return
    }
    const tick = () => {
      if (needsLockGate(cfg)) setLocked(true)
    }
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => clearInterval(id)
  }, [cfg.enabled, cfg.pinHashB64, cfg.saltB64, cfg.timeoutMinutes])

  // Activity → postpone re-lock (only when unlocked)
  useEffect(() => {
    if (!cfg.enabled || locked) return
    const onAct = () => touchActivity()
    window.addEventListener('pointerdown', onAct)
    window.addEventListener('keydown', onAct)
    return () => {
      window.removeEventListener('pointerdown', onAct)
      window.removeEventListener('keydown', onAct)
    }
  }, [cfg.enabled, locked])

  // Discrete mode: lock only when document is hidden (not every window blur)
  useEffect(() => {
    if (!cfg.discreteMode || !cfg.enabled || !cfg.pinHashB64) return
    const onVis = () => {
      if (document.hidden) {
        lockSession()
        setLocked(true)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [cfg.discreteMode, cfg.enabled, cfg.pinHashB64])

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await tryUnlock(pin, cfg)
      if (!r.ok) {
        setFails((n) => n + 1)
        setErr(r.error || 'PIN incorrecto')
        setPin('')
        return
      }
      setPin('')
      setFails(0)
      setLocked(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const emergencyDisable = () => {
    update({
      appLockEnabled: false,
      appLockSaltB64: '',
      appLockPinHashB64: ''
    })
    markSessionUnlocked()
    setLocked(false)
    setPin('')
    setErr(null)
    setFails(0)
  }

  if (!cfg.enabled || !cfg.pinHashB64 || !cfg.saltB64) {
    return <>{children}</>
  }

  // Locked: only gate (never a blank screen without controls)
  if (locked) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(145deg, #1a1020 0%, #2d1b3d 50%, #1a1020 100%)',
          padding: 16,
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 360,
            background: '#fff',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32 }}>🔒</div>
            <h2 style={{ margin: '8px 0 4px', fontSize: 18, fontWeight: 800, color: '#1a1020' }}>
              App bloqueada
            </h2>
            <p style={{ margin: 0, fontSize: 12, color: '#666' }}>
              Introduce tu PIN (solo en este dispositivo; no usa Windows Hello).
            </p>
          </div>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="••••"
            value={pin}
            maxLength={12}
            autoFocus
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pin.length >= 4) void submit()
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              textAlign: 'center',
              fontSize: 20,
              letterSpacing: 8,
              padding: '12px 16px',
              borderRadius: 10,
              border: '2px solid #e8b4c8',
              outline: 'none'
            }}
          />
          {err ? (
            <p style={{ margin: 0, fontSize: 12, color: '#c62828', textAlign: 'center' }}>{err}</p>
          ) : null}
          <button
            type="button"
            disabled={busy || pin.length < 4}
            onClick={() => void submit()}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 10,
              border: 'none',
              background: busy || pin.length < 4 ? '#ccc' : '#e91e8c',
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
              cursor: busy || pin.length < 4 ? 'not-allowed' : 'pointer'
            }}
          >
            {busy ? 'Comprobando…' : 'Desbloquear'}
          </button>
          {fails >= 3 ? (
            <button
              type="button"
              onClick={emergencyDisable}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: 10,
                border: '1px solid #999',
                background: '#f5f5f5',
                color: '#333',
                fontSize: 11,
                cursor: 'pointer'
              }}
            >
              ¿No puedes entrar? Desactivar candado (quita la protección PIN)
            </button>
          ) : (
            <p style={{ margin: 0, fontSize: 10, color: '#999', textAlign: 'center' }}>
              Tras 3 intentos fallidos aparecerá una opción de recuperación.
            </p>
          )}
        </div>
      </div>
    )
  }

  return <>{children}</>
}
