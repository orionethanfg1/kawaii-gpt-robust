/**
 * Panel de sincronización GitHub con identidad SSH por cuenta.
 * Persistente en .git/config + .kawaii-git-identity.json del repo.
 */
import { useCallback, useEffect, useState } from 'react'
import { GitBranch, RefreshCw, Upload, KeyRound, ShieldAlert } from 'lucide-react'

type GitStatus = {
  ok: boolean
  repoRoot?: string
  branch?: string
  remoteUrl?: string
  dirty?: boolean
  ahead?: number
  behind?: number
  staged?: number
  unstaged?: number
  untracked?: number
  userName?: string
  userEmail?: string
  sshCommand?: string
  lastError?: string
}

type SshKey = { name: string; path: string }

interface Props {
  open: boolean
  onClose: () => void
}

export function GitSyncPanel({ open, onClose }: Props) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [keys, setKeys] = useState<SshKey[]>([])
  const [keyPath, setKeyPath] = useState('')
  const [label, setLabel] = useState('orionethan')
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [hostAlias, setHostAlias] = useState('')
  const [message, setMessage] = useState('')
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string>('')
  const [confirmForce, setConfirmForce] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [st, ks, saved] = await Promise.all([
        window.kawaii?.gitStatus?.(),
        window.kawaii?.gitListKeys?.(),
        window.kawaii?.gitSavedIdentity?.()
      ])
      setStatus((st as GitStatus) || { ok: false, lastError: 'API git no disponible' })
      setKeys((ks as SshKey[]) || [])
      if (saved && typeof saved === 'object') {
        const s = saved as {
          label?: string
          keyPath?: string
          userName?: string
          userEmail?: string
          hostAlias?: string
        }
        if (s.keyPath) setKeyPath(s.keyPath)
        if (s.label) setLabel(s.label)
        if (s.userName) setUserName(s.userName)
        if (s.userEmail) setUserEmail(s.userEmail)
        if (s.hostAlias) setHostAlias(s.hostAlias)
      }
      if (st && (st as GitStatus).userName && !userName) {
        setUserName((st as GitStatus).userName || '')
      }
      if (st && (st as GitStatus).userEmail && !userEmail) {
        setUserEmail((st as GitStatus).userEmail || '')
      }
    } catch (e) {
      setLog(String(e))
    }
  }, [userName, userEmail])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  if (!open) return null

  const applyIdentity = async () => {
    if (!keyPath) {
      setLog('Elige una llave SSH privada.')
      return
    }
    setBusy(true)
    setLog('Aplicando identidad al repo…')
    try {
      const r = await window.kawaii?.gitApplyIdentity?.({
        label,
        keyPath,
        userName: userName || undefined,
        userEmail: userEmail || undefined,
        hostAlias: hostAlias || undefined
      })
      setLog(
        r?.ok
          ? `✓ Identidad guardada en este repo.\n${(r.steps || []).join('\n')}`
          : `✗ ${r?.error || 'Error'}`
      )
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const testAuth = async () => {
    setBusy(true)
    setLog('Probando acceso al remote (ls-remote)…')
    try {
      const r = await window.kawaii?.gitTestAuth?.()
      setLog(r?.ok ? `✓ Auth OK\n${r.stdout || ''}` : `✗ ${r?.error || 'Falló SSH/auth'}`)
    } finally {
      setBusy(false)
    }
  }

  const runSync = async () => {
    if (force && !confirmForce) {
      setConfirmForce(true)
      setLog('Force push activo: marca de nuevo «Confirmo force» o desactiva force.')
      return
    }
    setBusy(true)
    setLog('git add -A → commit → push…')
    try {
      const msg =
        message.trim() ||
        `chore: sync ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
      const r = await window.kawaii?.gitSync?.(msg, force && confirmForce)
      setLog(
        r?.ok
          ? `✓ Sincronizado\n${(r.steps || []).join('\n')}\n${r.stdout || ''}`
          : `✗ ${r?.error || r?.stderr || 'Error en sync'}\n${(r?.steps || []).join('\n')}`
      )
      setConfirmForce(false)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4">
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-kawaii-lg border-2 border-violet-300 bg-gradient-to-b from-violet-50 to-white shadow-xl"
        role="dialog"
        aria-label="GitHub Sync"
      >
        <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-violet-200 bg-violet-100/90 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-violet-700" />
            <div>
              <h2 className="text-sm font-bold text-violet-900">GitHub Sync</h2>
              <p className="text-[10px] text-violet-700">
                Identidad SSH por repo · add / commit / push · multi-cuenta
              </p>
            </div>
          </div>
          <button
            type="button"
            className="text-xs text-violet-800 hover:underline"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* Status card */}
          <section className="rounded-kawaii border border-violet-200 bg-white/90 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-violet-900">Estado del repositorio</p>
              <button
                type="button"
                className="text-[10px] text-violet-700 hover:underline inline-flex items-center gap-1"
                onClick={() => void refresh()}
                disabled={busy}
              >
                <RefreshCw className="h-3 w-3" /> Actualizar
              </button>
            </div>
            {status?.ok ? (
              <ul className="text-[11px] text-kawaii-text space-y-0.5">
                <li>
                  <span className="text-kawaii-text-muted">Ruta:</span> {status.repoRoot}
                </li>
                <li>
                  <span className="text-kawaii-text-muted">Rama:</span> {status.branch}{' '}
                  {status.dirty ? (
                    <span className="text-amber-700">· cambios locales</span>
                  ) : (
                    <span className="text-emerald-700">· limpio</span>
                  )}
                </li>
                <li>
                  <span className="text-kawaii-text-muted">Remote:</span> {status.remoteUrl || '—'}
                  {status.remoteUrl && /^https?:\/\//i.test(status.remoteUrl) ? (
                    <span className="text-red-700 font-semibold">
                      {' '}
                      · HTTPS (causará login en navegador) → Guardar identidad para pasar a SSH
                    </span>
                  ) : status.remoteUrl && /git@/i.test(status.remoteUrl) ? (
                    <span className="text-emerald-700"> · SSH OK</span>
                  ) : null}
                </li>
                <li>
                  <span className="text-kawaii-text-muted">Ahead/behind:</span> +{status.ahead ?? 0} / −
                  {status.behind ?? 0} · staged {status.staged ?? 0} · unstaged {status.unstaged ?? 0} ·
                  untracked {status.untracked ?? 0}
                </li>
                <li>
                  <span className="text-kawaii-text-muted">user:</span> {status.userName || '—'} &lt;
                  {status.userEmail || '—'}&gt;
                </li>
                <li className="break-all">
                  <span className="text-kawaii-text-muted">ssh:</span> {status.sshCommand || '(global)'}
                </li>
              </ul>
            ) : (
              <p className="text-xs text-amber-800">{status?.lastError || 'Cargando…'}</p>
            )}
          </section>

          {/* Identity */}
          <section className="rounded-kawaii border border-violet-200 bg-white/90 p-3 space-y-2">
            <p className="text-xs font-semibold text-violet-900 flex items-center gap-1">
              <KeyRound className="h-3.5 w-3.5" /> Identidad de esta cuenta (persistente en el repo)
            </p>
            <p className="text-[10px] text-kawaii-text-muted">
              Si aparece «Sign in» del navegador, el remote era HTTPS: al guardar identidad se convierte a SSH. Best practice: una llave por cuenta + <code>core.sshCommand</code> local al repo
              con <code>IdentitiesOnly=yes</code>. Así el push no “pierde” la configuración.
            </p>
            <label className="block text-[11px]">
              Etiqueta
              <input
                className="input-kawaii w-full text-xs mt-0.5"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="orionethan"
              />
            </label>
            <label className="block text-[11px]">
              Llave privada (~/.ssh)
              <select
                className="input-kawaii w-full text-xs mt-0.5"
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
              >
                <option value="">— elegir —</option>
                {keys.map((k) => (
                  <option key={k.path} value={k.path}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[11px]">
                user.name
                <input
                  className="input-kawaii w-full text-xs mt-0.5"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                />
              </label>
              <label className="block text-[11px]">
                user.email
                <input
                  className="input-kawaii w-full text-xs mt-0.5"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                />
              </label>
            </div>
            <label className="block text-[11px]">
              Host alias SSH (opcional, ej. github-orionethan)
              <input
                className="input-kawaii w-full text-xs mt-0.5"
                value={hostAlias}
                onChange={(e) => setHostAlias(e.target.value)}
                placeholder="vacío = solo IdentityFile"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-kawaii text-xs px-3 py-1.5"
                disabled={busy}
                onClick={() => void applyIdentity()}
              >
                Guardar identidad en este repo
              </button>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-full border border-violet-300 text-violet-800"
                disabled={busy}
                onClick={() => void testAuth()}
              >
                Probar auth
              </button>
            </div>
          </section>

          {/* Sync actions */}
          <section className="rounded-kawaii border border-violet-200 bg-white/90 p-3 space-y-2">
            <p className="text-xs font-semibold text-violet-900 flex items-center gap-1">
              <Upload className="h-3.5 w-3.5" /> Sincronizar
            </p>
            <label className="block text-[11px]">
              Mensaje de commit
              <input
                className="input-kawaii w-full text-xs mt-0.5"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="chore: actualizar app"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-amber-900">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => {
                  setForce(e.target.checked)
                  setConfirmForce(false)
                }}
              />
              <ShieldAlert className="h-3.5 w-3.5" />
              Force push (<code>--force</code>) — peligroso si hay colaboradores
            </label>
            {force && (
              <label className="flex items-center gap-2 text-[11px] text-red-800">
                <input
                  type="checkbox"
                  checked={confirmForce}
                  onChange={(e) => setConfirmForce(e.target.checked)}
                />
                Confirmo force push a origin
              </label>
            )}
            <button
              type="button"
              className="btn-kawaii w-full text-sm py-2"
              disabled={busy}
              onClick={() => void runSync()}
            >
              {busy ? 'Trabajando…' : 'git add -A + commit + push'}
            </button>
          </section>

          <section className="rounded-kawaii border border-kawaii-border bg-kawaii-cream/40 p-2">
            <p className="text-[10px] font-semibold text-kawaii-text-muted mb-1">Salida</p>
            <pre className="text-[10px] whitespace-pre-wrap break-all max-h-40 overflow-y-auto text-kawaii-text">
              {log || '—'}
            </pre>
          </section>

          <p className="text-[10px] text-kawaii-text-muted leading-relaxed">
            En Windows, para varias cuentas: en <code>%USERPROFILE%\.ssh\config</code> define Host
            aliases con <code>IdentityFile</code> e <code>IdentitiesOnly yes</code>. Esta mini-app
            escribe <code>core.sshCommand</code> solo en <strong>este</strong> repositorio para que
            no dependas del agent global.
          </p>
        </div>
      </div>
    </div>
  )
}
