import { useEffect } from 'react'
import { activityInfo, activitySuccess, activityError } from '@shared/lib/stores/activityStore'
import { notifyUser } from '@shared/lib/notify'

/** Subscribe to main-process layer swaps (Forge ↔ ACE) and surface toasts. */
export function useLayerScheduleToasts() {
  useEffect(() => {
    const off = window.kawaii?.onLayersSchedule?.((ev) => {
      const title =
        ev.phase === 'preparing'
          ? 'Cambiando capa…'
          : ev.phase === 'ready'
            ? 'Capa lista'
            : ev.phase === 'released'
              ? 'VRAM liberada'
              : 'Capa: aviso'
      const detail = ev.message + (ev.ms != null ? ` · ${Math.round(ev.ms / 1000)}s` : '')
      if (ev.phase === 'error') {
        void notifyUser(title, detail, { kind: 'error', sticky: false, os: false })
        activityError(title, detail)
      } else if (ev.phase === 'ready') {
        activitySuccess(title, detail, { ttlMs: 5000 })
      } else {
        activityInfo(title, detail)
      }
    })
    return () => {
      off?.()
    }
  }, [])
}
