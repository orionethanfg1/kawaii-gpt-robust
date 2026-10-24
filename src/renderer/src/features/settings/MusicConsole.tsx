import { useCallback } from 'react'
import { LayerConsole } from './LayerConsole'

export function MusicConsole() {
  const fetchTail = useCallback(async () => {
    return window.kawaii?.musicLogTail?.()
  }, [])

  const subscribe = useCallback(
    (cb: (p: { line?: string; tail?: string[] }) => void) => {
      return window.kawaii?.onMusicLogLine?.(cb)
    },
    []
  )

  return (
    <LayerConsole
      title="Consola Música / ACE-Step (solo lectura)"
      emptyHint="Sin salida aún. Al Instalar o Arrancar verás uv sync, torchao, descarga de modelos y la API…"
      fetchTail={fetchTail}
      subscribe={subscribe}
      defaultOpen={true}
      maxHeightClass="max-h-56"
    />
  )
}
