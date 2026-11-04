import { useEffect, useState } from 'react'
import { assessFaceIdFromModelNames, type FaceIdStatus } from '@core/image/faceid-status'

/**
 * Soft warning when Forge has no FaceID models (self-portraits weaker).
 */
export function FaceIdStatusBanner({ enabled }: { enabled?: boolean }) {
  const [status, setStatus] = useState<FaceIdStatus | null>(null)

  useEffect(() => {
    if (enabled === false) return
    let cancelled = false
    void (async () => {
      try {
        const health = await window.kawaii?.imageHealth?.()
        const names: string[] = []
        const h = health as {
          controlNetModels?: string[]
          models?: string[]
          faceIdStatus?: FaceIdStatus
        }
        if (h?.faceIdStatus) {
          if (!cancelled) setStatus(h.faceIdStatus)
          return
        }
        if (Array.isArray(h?.controlNetModels)) names.push(...h.controlNetModels)
        if (Array.isArray(h?.models)) names.push(...h.models)
        // Also try dedicated list if exposed
        try {
          const cn = await (window.kawaii as { forgeControlNetModels?: () => Promise<string[]> })
            ?.forgeControlNetModels?.()
          if (Array.isArray(cn)) names.push(...cn)
        } catch {
          /* */
        }
        if (!cancelled) setStatus(assessFaceIdFromModelNames(names))
      } catch {
        if (!cancelled)
          setStatus({
            available: false,
            kind: 'none',
            message: 'No se pudo comprobar FaceID (Forge ¿en marcha?)'
          })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  if (!status || status.available) return null
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
      <strong>Identidad facial:</strong> {status.message}
    </div>
  )
}
