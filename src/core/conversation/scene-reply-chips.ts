/**
 * S5 — Optional interactive chips for scene continuity (no robot menus).
 * User taps → normal user message; transparent to the model as their words.
 */
export type SceneReplyChip = {
  id: string
  label: string
  /** Text sent as user message */
  sendText: string
  kind: 'continue' | 'soft_exit' | 'rest' | 'accept' | 'decline'
}

export function sceneReplyChipsForPhase(
  phase: string,
  opts?: { characterName?: string }
): SceneReplyChip[] {
  const p = (phase || 'idle').toLowerCase()
  if (p === 'invited') {
    return [
      {
        id: 'accept',
        label: 'Sí, me apetece',
        sendText: 'Sí, me apetece acercarnos así.',
        kind: 'accept'
      },
      {
        id: 'decline',
        label: 'Ahora no',
        sendText: 'Ahora no, gracias — prefiero seguir con otra cosa.',
        kind: 'decline'
      }
    ]
  }
  if (p === 'scene_active') {
    return [
      {
        id: 'continue',
        label: 'Seguir en la escena',
        sendText: 'Sigue con la escena, no cambies de tema.',
        kind: 'continue'
      },
      {
        id: 'soft_exit',
        label: 'Cambiar de tema',
        sendText: 'Cambiemos de tema un rato, sin prisa.',
        kind: 'soft_exit'
      },
      {
        id: 'rest',
        label: 'Descansar un momento',
        sendText: 'Paremos un momento; quiero calma contigo, sin seguir el guion.',
        kind: 'rest'
      }
    ]
  }
  if (p === 'aftercare') {
    return [
      {
        id: 'continue',
        label: 'Quedarnos así',
        sendText: 'Quedémonos así un rato, sin forzar otra escena.',
        kind: 'continue'
      },
      {
        id: 'soft_exit',
        label: 'Volver a lo cotidiano',
        sendText: 'Volvamos a lo cotidiano; la escena ya terminó para mí.',
        kind: 'soft_exit'
      }
    ]
  }
  return []
}
