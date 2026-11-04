/**
 * Scene chips (Seguir cerca / Bajar ritmo / Descansar) — modular intent bus.
 * UI dispatches `kawaii:scene-intent`; ChatView listens and sends a real user turn.
 */

export type SceneIntentKind = 'scene-continue' | 'scene-soften' | 'scene-rest' | string

export type SceneIntentDetail = {
  kind: SceneIntentKind
  userVisible: string
  phase?: string
}

export const SCENE_INTENT_EVENT = 'kawaii:scene-intent'

export function parseSceneIntentDetail(raw: unknown): SceneIntentDetail | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const userVisible = String(d.userVisible || '').trim()
  if (!userVisible) return null
  const kind = String(d.kind || 'scene-continue').trim() || 'scene-continue'
  const phase = d.phase != null ? String(d.phase) : undefined
  return { kind, userVisible, phase }
}

export function dispatchSceneIntent(detail: SceneIntentDetail): void {
  try {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(SCENE_INTENT_EVENT, { detail }))
  } catch {
    /* optional */
  }
}

/** Meta attached to the user message so memory/initiative can treat it as scene control. */
export function sceneIntentUserMeta(detail: SceneIntentDetail): Record<string, unknown> {
  return {
    kind: 'scene-intent',
    sceneKind: detail.kind,
    scenePhaseAtClick: detail.phase,
    uiLabel:
      detail.kind === 'scene-soften'
        ? 'Bajar ritmo'
        : detail.kind === 'scene-rest'
          ? 'Descansar'
          : 'Seguir cerca'
  }
}
