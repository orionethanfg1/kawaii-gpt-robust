import { useEffect, useRef, useState } from 'react'

/** Read-only live console for Forge stdout / install steps */
export function ForgeConsole() {
  const [lines, setLines] = useState<string[]>([])
  const [path, setPath] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let unsub: (() => void) | undefined
    void (async () => {
      try {
        const r = await window.kawaii.forgeLogTail?.()
        if (r?.lines?.length) setLines(r.lines)
        if (r?.path) setPath(r.path)
      } catch {
        /* ignore */
      }
      unsub = window.kawaii.onForgeLogLine?.(({ line, tail }) => {
        if (tail?.length) setLines(tail)
        else if (line) setLines((prev) => [...prev.slice(-199), line])
      })
    })()
    return () => {
      try {
        unsub?.()
      } catch {
        /* ignore */
      }
    }
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="mt-2 rounded-kawaii border border-kawaii-border overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold bg-black/5 hover:bg-black/10"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Consola Forge (solo lectura)</span>
        <span className="text-kawaii-text-muted">{open ? 'Ocultar' : 'Mostrar'} · {lines.length} líneas</span>
      </button>
      {open ? (
        <div className="bg-[#1a1a1e] text-[#d4d4d8] font-mono text-[10px] leading-relaxed max-h-48 overflow-y-auto p-2">
          {lines.length === 0 ? (
            <p className="text-zinc-500">Sin salida aún. Al arrancar Forge verás aquí pip, CLIP, Startup time…</p>
          ) : (
            lines.map((l, i) => (
              <div key={`${i}-${l.slice(0, 24)}`} className="whitespace-pre-wrap break-all">
                {l}
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>
      ) : null}
      {path ? (
        <p className="text-[9px] text-kawaii-text-muted px-2 py-1 truncate" title={path}>
          Log: {path}
        </p>
      ) : null}
    </div>
  )
}
