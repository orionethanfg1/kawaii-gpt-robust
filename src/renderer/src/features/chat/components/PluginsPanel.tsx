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
  const [catalogTools, setCatalogTools] = useState<
    Array<{ name: string; pluginId: string; description?: string }>
  >([])
  const [lastRun, setLastRun] = useState<string | null>(null)

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
      try {
        const cat = await (window.kawaii as { pluginsCatalog?: () => Promise<{ ok?: boolean; tools?: Array<{ name: string; pluginId: string; description?: string }> }> })?.pluginsCatalog?.()
        if (!cancelled && cat?.ok && Array.isArray(cat.tools)) {
          setCatalogTools(cat.tools)
        }
      } catch {
        /* optional */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const runTools = (tools: string[], phrase: string) => {
    if (!tools.length || !onRunTools) return
    setLastRun(tools.slice(0, 4).join(', ') + (tools.length > 4 ? '…' : ''))
    onRunTools(tools, phrase)
  }

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
        Builtin + <code className="text-[10px]">plugins/</code> ({disk.length} en disco
        {catalogTools.length ? ` · ${catalogTools.length} tools` : ''}). Frase → chat. ▶ → harness
        real (host). La app es el agente.
      </p>
      {lastRun ? (
        <p className="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
          Última ejecución pedida: <strong>{lastRun}</strong>
        </p>
      ) : null}
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
                      onClick={() => runTools([t], p.phrases?.[0] || p.title)}
                    >
                      ▶ {t}
                    </button>
                  ))}
                  {(p.tools || []).length > 1 ? (
                    <button
                      type="button"
                      className="text-[10px] font-medium text-kawaii-text"
                      onClick={() => runTools(p.tools || [], p.phrases?.[0] || p.title)}
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

      {catalogTools.length > 0 ? (
        <div className="space-y-1.5 border-t border-kawaii-border/50 pt-2">
          <div className="text-[10px] uppercase tracking-wide text-kawaii-text-muted">
            Tools del catálogo (disco)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {catalogTools
              .filter((t) => {
                const qq = q.trim().toLowerCase()
                if (!qq) return true
                return (
                  t.name.toLowerCase().includes(qq) ||
                  t.pluginId.toLowerCase().includes(qq) ||
                  (t.description || '').toLowerCase().includes(qq)
                )
              })
              .slice(0, 24)
              .map((t) => (
                <button
                  key={t.pluginId + ':' + t.name}
                  type="button"
                  className="text-[10px] px-1.5 py-0.5 rounded border border-kawaii-border/70 hover:bg-kawaii-pink-soft/40"
                  title={t.description || t.pluginId}
                  onClick={() => runTools([t.name], t.name)}
                >
                  ▶ {t.name}
                </button>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
