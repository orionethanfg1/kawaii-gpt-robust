/**
 * Fase 1 — pure router precedence + sticky (no network).
 */

import { decideAutoRoute } from './model-router'
import {
  armIntimateSticky,
  clearIntimateSticky,
  isIntimateStickyActive,
  onConversationChanged,
  onAdultOptInChanged
} from './intimate-sticky'

export type Phase1Check = { id: string; ok: boolean; detail: string }

export function runPhase1PureChecks(): Phase1Check[] {
  const out: Phase1Check[] = []
  clearIntimateSticky()

  const installed = [
    'qwen/qwen3-14b',
    'mlabonne_qwen3-14b-abliterated',
    'openai/gpt-oss-20b'
  ]

  // Pin blocks normal chat
  const pinnedChat = decideAutoRoute({
    userText: 'hola cómo estás',
    settings: {
      autoModelRouting: true,
      localModelPinned: true,
      localModel: 'qwen/qwen3-14b',
      adultIntimacyOptIn: true,
      relationshipState: { stage: 'intimate_adult' },
      character: { relationshipRole: 'novios' }
    },
    installed,
    conversationId: 'c1'
  })
  out.push({
    id: 'phase1-pin-blocks-chat',
    ok: pinnedChat.applied === false && pinnedChat.to === 'qwen/qwen3-14b',
    detail: `applied=${pinnedChat.applied} to=${pinnedChat.to} reason=${pinnedChat.reason}`
  })

  // Pin yields to intimacy
  const pinnedInt = decideAutoRoute({
    userText: 'quiero besar tus labios',
    settings: {
      autoModelRouting: true,
      localModelPinned: true,
      localModel: 'qwen/qwen3-14b',
      adultIntimacyOptIn: true,
      relationshipState: { stage: 'intimate_adult' },
      character: { relationshipRole: 'novios' }
    },
    installed,
    conversationId: 'c1'
  })
  out.push({
    id: 'phase1-pin-yields-intimacy',
    ok:
      pinnedInt.task === 'intimacy' &&
      pinnedInt.applied === true &&
      /abliterat/i.test(pinnedInt.to),
    detail: `task=${pinnedInt.task} to=${pinnedInt.to} reason=${pinnedInt.reason}`
  })

  // Sticky only same conversation
  clearIntimateSticky()
  armIntimateSticky({ conversationId: 'c1' })
  out.push({
    id: 'phase1-sticky-same-conv',
    ok: isIntimateStickyActive({ adultOptIn: true, conversationId: 'c1' }) === true,
    detail: 'sticky active on c1'
  })
  out.push({
    id: 'phase1-sticky-other-conv',
    ok: isIntimateStickyActive({ adultOptIn: true, conversationId: 'c2' }) === false,
    detail: 'sticky inactive on c2'
  })

  onConversationChanged('c2')
  out.push({
    id: 'phase1-sticky-clear-on-chat-change',
    ok: isIntimateStickyActive({ adultOptIn: true, conversationId: 'c1' }) === false,
    detail: 'cleared after conversation change'
  })

  armIntimateSticky({ conversationId: 'c3' })
  onAdultOptInChanged(false)
  out.push({
    id: 'phase1-sticky-clear-on-optin-off',
    ok: isIntimateStickyActive({ adultOptIn: true, conversationId: 'c3' }) === false,
    detail: 'cleared when adult opt-in off'
  })

  clearIntimateSticky()
  return out
}
