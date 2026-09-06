import { useMemo } from 'react'
import { buildCapabilityRegistry } from '@core/generative'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

/** Compact multi-layer status: only shows non-text modalities */
export function GenerativeLayersBadge() {
  const settings = useSettingsStore((s) => s.settings)

  const caps = useMemo(() => {
    try {
      return buildCapabilityRegistry({
        imageGenEnabled: settings?.imageGenEnabled,
        imageProviderMode: settings?.imageProviderMode,
        musicEnabled: settings?.musicGenEnabled === true,
        videoEnabled: settings?.videoGenEnabled === true
      })
    } catch {
      return []
    }
  }, [
    settings?.imageGenEnabled,
    settings?.imageProviderMode,
    settings?.musicGenEnabled,
    settings?.videoGenEnabled
  ])

  const layers = caps.filter((c) => c.modality !== 'text')

  return (
    <div className="flex flex-wrap gap-1 text-[10px]" title="Capas generativas bajo demanda">
      {layers.map((c) => {
        const color =
          c.status === 'available'
            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
            : c.status === 'degraded'
              ? 'bg-amber-100 text-amber-800 border-amber-200'
              : 'bg-kawaii-pink-soft/50 text-kawaii-text-muted border-kawaii-border'
        return (
          <span
            key={c.id}
            className={`px-1.5 py-0.5 rounded-full border ${color}`}
            title={c.reason || c.displayName}
          >
            {c.modality === 'image' ? '🖼 Imagen' : c.modality === 'music' ? '🎵 Música' : '🎬 Video'}{' · '}
            {c.status === 'available' ? 'on' : c.status === 'not_configured' ? 'off' : c.status}
          </span>
        )
      })}
    </div>
  )
}
