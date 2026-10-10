import { useEffect, useMemo, useState } from 'react'
import { HOST_COMMAND_CATALOG } from '@core/agent/host-command-catalog'
import * as CapsMod from '@core/agent/capabilities-registry'
import { mergeCapabilityPlugins } from '@core/plugins/registry'
import type { PluginListItem } from '@core/plugins/types'

type Props = {
  onInsertPhrase?: (phrase: string) => void
  onRunTools?: (tools: string[], phrase: string) => void
  onClose?: () => void
}

export function PluginsPanel({ onInsertPhrase, onRunTools, onClose }: Props) {
  const [q, setQ] = useState('')
  const [disk, setDisk] = useState<PluginListItem[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await window.kawaii?.pluginsList?.()
        if (!cancelled && res?.ok && Array.isArray(res.plugins)) {
          setDisk(res.plugins as PluginListItem[])
        }
      } catch {
        /* optional */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const commands = useMemo(() => {
    const qq = q.trim().toLowerCase()
    return HOST_COMMAND_CATALOG.filter(
      (c) =>
        !qq ||
        c.id.includes(qq) ||
        c.why.toLowerCase().includes(qq) ||
        c.phrases.some((p) => p.toLowerCase().includes(qq))
    )
  }, [q])

  const caps = useMemo(() => {
    try {
      const merged = mergeCapabilityPlugins(disk)
      const qq = q.trim().toLowerCase()
      if (!qq) return merged
      return merged.filter(
        (p) =>
          p.id.includes(qq) ||
          p.title.toLowerCase().includes(qq) ||
          (p.summary || '').toLowerCase().includes(qq) ||
          (p.tools || []).some((t) => t.includes(qq))
      )
    } catch {
      return CapsMod.CAPABILITY_PLUGINS || []
    }
  }, [q, disk])

  return (
    <div className="absolute right-2 top-12 z-40 w-[min(100%,380px)] max-h-[70vh] overflow-auto rounded-kawaii border border-kawaii-border bg-white shadow-lg p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-kawaii-text">Plugins y skills</h3>
        <button type="button" className="text-xs text-kawaii-text-muted" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <p className="text-[11px] text-kawaii-text-muted leading-relaxed">
        Capacidades builtin + <code className="text-[10px]">plugins/</code> ({disk.length} en disco). Frase → se escribe en el chat (el modelo decide). ▶ → harness real. La app es el agente; el modelo razona con el resultado.
      </p>
      <input
        className="input-kawaii text-sm"
        placeholder="Buscar…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-kawaii-text-muted">
          Capacidades / plugins
        </div>
        {caps.map((p) => (
          <div
            key={p.id}
            className="w-full text-left rounded-lg border border-kawaii-border/60 px-2 py-1.5 space-y-1"
          >
            <div className="text-xs font-medium flex items-center gap-2">
              <span>{p.title}</span>
              {disk.some((d) => d.id === p.id) ? (
                <span className="text-[9px] px-1 rounded bg-kawaii-pink-soft text-kawaii-pink-deep">disco</span>
              ) : (
                <span className="text-[9px] px-1 rounded bg-kawaii-mint/40 text-kawaii-text-muted">builtin</span>
              )}
            </div>
            <div className="text-[10px] text-kawaii-text-muted">{p.summary}</div>
            {p.tools?.length ? (
              <div className="text-[10px] text-kawaii-text-muted">tools: {p.tools.join(', ')}</div>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-0.5">
              {(p.phrases || []).slice(0, 2).map((ph) => (
                <button
                  key={ph}
                  type="button"
                  className="text-[10px] text-kawaii-pink-deep underline"
                  onClick={() => onInsertPhrase?.(ph)}
                >
                  {ph}
                </button>
              ))}
              {p.tools?.length && onRunTools ? (
                <>
                  {(p.tools || []).slice(0, 4).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="text-[10px] font-medium text-kawaii-pink-deep underline"
                      title={'Ejecutar ' + t}
                      onClick={() => onRunTools([t], p.phrases?.[0] || p.title)}
                    >
                      ▶ {t}
                    </button>
                  ))}
                  {(p.tools || []).length > 1 ? (
                    <button
                      type="button"
                      className="text-[10px] font-medium text-kawaii-text"
                      onClick={() => onRunTools(p.tools || [], p.phrases?.[0] || p.title)}
                    >
                      Ejecutar todo
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-kawaii-text-muted">
          Harness / host
        </div>
        {commands.map((c) => (
          <div
            key={c.id}
            className="w-full text-left rounded-lg border border-kawaii-border/60 px-2 py-1.5 space-y-1"
          >
            <div className="text-xs font-medium">{c.phrases[0]}</div>
            <div className="text-[10px] text-kawaii-text-muted">{c.why}</div>
            <div className="text-[10px] text-kawaii-text-muted">tools: {c.tools.join(', ')}</div>
            <div className="flex gap-2 pt-0.5">
              <button
                type="button"
                className="text-[10px] text-kawaii-pink-deep underline"
                onClick={() => onInsertPhrase?.(c.phrases[0])}
              >
                Usar frase
              </button>
              {onRunTools ? (
                <button
                  type="button"
                  className="text-[10px] font-medium"
                  onClick={() => onRunTools(c.tools, c.phrases[0])}
                >
                  Ejecutar
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
