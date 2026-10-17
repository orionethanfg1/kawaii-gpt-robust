import { useCallback, useEffect, useState } from 'react'

type ExtStatus = {
  forgeRoot: string | null
  controlNetModels: string[]
  controlNetModelsDir: string | null
  extensions: Array<{ name: string }>
  recommended: Array<{ id: string; title: string; status: string; detail: string }>
}

export function ForgeExtensionsPanel() {
  const [st, setSt] = useState<ExtStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await window.kawaii?.forgeExtensionsStatus?.()
      setSt(r as ExtStatus)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const unsub = window.kawaii?.onForgeCnProgress?.((p) => {
      setLog((p.msg || '') + (p.pct != null ? ` (${p.pct}%)` : ''))
    })
    return () => {
      unsub?.()
    }
  }, [refresh])

  const installCn = async () => {
    setBusy(true)
    setErr(null)
    try {
      await window.kawaii?.forgeEnsureControlNet?.()
      const r = await window.kawaii?.forgeInstallControlNetModels?.()
      if (r && !r.ok) setErr(r.error || 'Error descargando ControlNet')
      else setLog(`Instalado: ${(r?.installed || []).join(', ') || 'ok'}`)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 text-[12px]">
      <h4 className="font-semibold text-sm">Extensiones Forge / ControlNet</h4>
      <p className="text-[11px] text-kawaii-text-muted">
        ControlNet da control de pose, bordes y profundidad. Forge lo trae integrado; hace falta
        descargar pesos. IP-Adapter ayuda a fijar la cara del avatar.
      </p>
      {st?.forgeRoot ? (
        <p className="text-[10px] text-kawaii-text-muted font-mono break-all">Root: {st.forgeRoot}</p>
      ) : (
        <p className="text-amber-700 text-[11px]">Forge no detectado — instálalo en Capas primero.</p>
      )}
      <ul className="space-y-1">
        {(st?.recommended || []).map((r) => (
          <li key={r.id} className="rounded-lg border border-kawaii-border/60 px-2 py-1">
            <span className="font-medium">{r.title}</span>
            <span className="text-kawaii-text-muted"> · {r.status}</span>
            <div className="text-[10px] text-kawaii-text-muted">{r.detail}</div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy || !st?.forgeRoot}
        className="px-3 py-1.5 rounded-xl bg-kawaii-pink text-white text-xs disabled:opacity-40"
        onClick={() => void installCn()}
      >
        {busy ? 'Descargando…' : 'Descargar pack ControlNet básico (openpose + canny)'}
      </button>
      {log ? <p className="text-[10px] text-emerald-800">{log}</p> : null}
      {err ? <p className="text-[10px] text-red-600">{err}</p> : null}
    </div>
  )
}
