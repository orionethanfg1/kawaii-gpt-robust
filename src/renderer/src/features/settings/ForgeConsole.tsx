import { useCallback } from 'react'
import { LayerConsole } from './LayerConsole'

/** Read-only live console for Forge stdout / install steps */
export function ForgeConsole() {
  const fetchTail = useCallback(async () => {
    return window.kawaii?.forgeLogTail?.()
  }, [])

  const subscribe = useCallback(
    (cb: (p: { line?: string; tail?: string[] }) => void) => {
      return window.kawaii?.onForgeLogLine?.(cb)
    },
    []
  )

  return (
    <LayerConsole
      title="Consola Forge (solo lectura)"
      emptyHint="Sin salida aún. Al arrancar Forge verás aquí pip, CLIP, Startup time…"
      fetchTail={fetchTail}
      subscribe={subscribe}
      defaultOpen={true}
    />
  )
}
