import { useEffect, useRef, useState } from 'react'

type Props = {
  title: string
  emptyHint: string
  /** Initial load */
  fetchTail?: () => Promise<{ lines?: string[]; path?: string | null } | undefined>
  /** Live subscription; return unsubscribe */
  subscribe?: (cb: (p: { line?: string; tail?: string[] }) => void) => (() => void) | void
  defaultOpen?: boolean
  maxHeightClass?: string
}

/** Read-only collapsible console shared by Forge, Music, etc. */
export function LayerConsole({
  title,
  emptyHint,
  fetchTail,
  subscribe,
  defaultOpen = true,
  maxHeightClass = 'max-h-48'
}: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [path, setPath] = useState<string | null>(null)
  const [open, setOpen] = useState(defaultOpen)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let unsub: (() => void) | undefined
    void (async () => {
      try {
        const r = await fetchTail?.()
        if (r?.lines?.length) setLines(r.lines)
        if (r?.path) setPath(r.path)
      } catch {
        /* ignore */
      }
      const u = subscribe?.(({ line, tail }) => {
        if (tail?.length) setLines(tail)
        else if (line) setLines((prev) => [...prev.slice(-199), line])
      })
      if (typeof u === 'function') unsub = u
    })()
    return () => {
      try {
        unsub?.()
      } catch {
        /* ignore */
      }
    }
  }, [fetchTail, subscribe])

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, open])

  return (
    <div className="mt-2 rounded-kawaii border border-kawaii-border overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold bg-black/5 hover:bg-black/10"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{title}</span>
        <span className="text-kawaii-text-muted">
          {open ? 'Ocultar' : 'Mostrar'} · {lines.length} líneas
        </span>
      </button>
      {open ? (
        <div
          className={`bg-[#1a1a1e] text-[#d4d4d8] font-mono text-[10px] leading-relaxed ${maxHeightClass} overflow-y-auto p-2`}
        >
          {lines.length === 0 ? (
            <p className="text-zinc-500">{emptyHint}</p>
          ) : (
            lines.map((l, i) => (
              <div key={`${i}-${l.slice(0, 32)}`} className="whitespace-pre-wrap break-all">
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
