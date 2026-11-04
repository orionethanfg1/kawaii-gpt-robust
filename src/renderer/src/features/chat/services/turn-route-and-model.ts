/**
 * Auto-route + sticky model for one turn (X4 / S1).
 * Document turns never switch model (single-resident for progressive read).
 */
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { applyAutoModelRouting } from './appAgent'
import { markDocReadingActive } from './chatBusy'
import type { LivePhase } from '../components/RouteLiveIndicator'

export type RouteMeta = {
  task?: string
  reason?: string
  switched?: boolean
  lifecycle?: string
  from?: string
  to?: string
}

export type RouteAndModelInput = {
  convId: string
  trimmed: string
  attachments?: Array<{ dataUrl?: string; mimeType?: string; name?: string }>
  /** When DecisionPacket forces tools/docs, prefer sticky when possible */
  preferSticky?: boolean
  setPhase: (phase: LivePhase, info?: { target: string; model: string; reason: string; at: number }) => void
}

export type RouteAndModelResult = {
  liveSettings: ReturnType<typeof useSettingsStore.getState>['settings']
  routeMeta: RouteMeta
  /** True when we intentionally skipped auto-switch (doc / sticky) */
  sticky: boolean
}

export function isDocumentProgressTurn(convId: string, trimmed: string): boolean {
  if (/\[APP\].*lectura del documento/i.test(trimmed)) return true
  if (/continuar la lectura del documento/i.test(trimmed)) return true
  try {
    if (
      typeof sessionStorage !== 'undefined' &&
      Number(sessionStorage.getItem('kawaii-doc-auto-chain:' + convId) || '0') > 0
    ) {
      return true
    }
  } catch {
    /* */
  }
  return false
}

function hasImageAttachment(
  attachments?: Array<{ dataUrl?: string; mimeType?: string; name?: string }>
): boolean {
  return Boolean(
    attachments?.some(
      (a) =>
        a.dataUrl &&
        (String(a.mimeType || '').startsWith('image/') ||
          /\.(png|jpe?g|webp|gif)$/i.test(String(a.name || '')))
    )
  )
}

/**
 * Resolve local model for this turn. Never loads a second model for progressive doc reading.
 */
export async function resolveRouteAndModel(input: RouteAndModelInput): Promise<RouteAndModelResult> {
  let liveSettings = useSettingsStore.getState().settings
  let routeMeta: RouteMeta = {}
  let sticky = false

  const isDocTurn = isDocumentProgressTurn(input.convId, input.trimmed) || Boolean(input.preferSticky)

  if (isDocTurn) {
    sticky = true
    routeMeta = {
      task: 'chat',
      reason: 'lectura documento · mismo modelo (single-resident)',
      switched: false
    }
    try {
      markDocReadingActive(180_000)
    } catch {
      /* */
    }
    liveSettings = useSettingsStore.getState().settings
    input.setPhase('generating', {
      target: 'local',
      model: (liveSettings.localModel || '').trim() || 'local',
      reason: 'Lectura de documento (sin cambiar modelo)',
      at: Date.now()
    })
    return { liveSettings, routeMeta, sticky }
  }

  try {
    const ar = await applyAutoModelRouting(input.trimmed, {
      hasImageAttachment: hasImageAttachment(input.attachments)
    })
    routeMeta = {
      task: ar.task,
      reason: ar.reason,
      switched: ar.applied,
      lifecycle: ar.lifecycle,
      from: ar.from,
      to: ar.to
    }
    liveSettings = useSettingsStore.getState().settings
    input.setPhase('generating', {
      target: 'local',
      model: (liveSettings.localModel || '').trim() || 'local',
      reason: ar.reason || '',
      at: Date.now()
    })
  } catch {
    liveSettings = useSettingsStore.getState().settings
  }

  return { liveSettings, routeMeta, sticky }
}
