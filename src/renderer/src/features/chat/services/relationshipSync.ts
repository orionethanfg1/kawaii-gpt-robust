/**
 * Auto-update character relationship role from chat dynamics.
 */

import {
  detectRelationshipShift,
  extractReactionFromAssistant,
  MAX_RELATIONSHIP_HISTORY
} from '@core/character/relationship-detect'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

export type RelationshipSyncResult = {
  updated: boolean
  fromRole?: string
  toRole?: string
  reaction?: string
}

/**
 * Call with the user message (and optionally assistant reply after generation).
 * Updates settings.character in place when a clear shift is detected.
 */
export function syncRelationshipFromTurn(
  userText: string,
  assistantText?: string
): RelationshipSyncResult {
  try {
    const settings = useSettingsStore.getState().settings
    const ch = settings.character || { name: 'Asistente', tagline: '', personality: '', style: '', visualEmoji: '', traits: [] }
    const current = (ch.relationshipRole || '').trim()
    const shift = detectRelationshipShift(userText, current)
    if (!shift) {
      // Still allow refining reaction if already in a role and assistant spoke about feelings
      if (assistantText && current) {
        const rx = extractReactionFromAssistant(assistantText)
        if (rx && rx !== ch.relationshipReaction) {
          useSettingsStore.getState().update({
            character: {
              ...ch,
              relationshipReaction: rx
            }
          })
          return { updated: true, fromRole: current, toRole: current, reaction: rx }
        }
      }
      return { updated: false }
    }

    const reaction =
      (assistantText && extractReactionFromAssistant(assistantText)) ||
      shift.suggestedReaction

    const entry = {
      at: Date.now(),
      fromRole: current || '(sin rol)',
      toRole: shift.toRole,
      trigger: shift.trigger,
      reaction
    }
    const history = [...(ch.relationshipHistory || []), entry].slice(-MAX_RELATIONSHIP_HISTORY)

    useSettingsStore.getState().update({
      character: {
        ...ch,
        relationshipRole: shift.toRole,
        relationshipReaction: reaction,
        relationshipHistory: history
      }
    })

    return {
      updated: true,
      fromRole: entry.fromRole,
      toRole: entry.toRole,
      reaction
    }
  } catch (e) {
    console.warn('[relationshipSync]', e)
    return { updated: false }
  }
}
