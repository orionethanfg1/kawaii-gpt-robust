/**
 * P1 — sendMessage phases (pure side-effects on settings / stores).
 * Keeps useChat.sendMessage as an ordered pipeline, not a monolith of logic.
 *
 * Phase order in useChat:
 *   1. local shortcuts
 *   2. applyNicknameFromUserMessage
 *   3. host-owned paths
 *   4. plan media → media handoff
 *   5. ensure conversation + applyUserMemoryFromTurn
 *   6. orchestrator stream + postReplyFinalize
 */

import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import {
  extractExplicitNickname,
  looksLikeNicknameAccept,
  looksLikeNicknameReject,
  extractUserFactsFromMessage,
  extractUserFactsFromTurnPair,
  mergeUserMemory,
  sanitizeUserMemoryNames,
  hasMemorySignal
} from '@core/conversation/user-memory'
import {
  advanceOnboardingAfterExtract,
  shouldRunOnboarding,
  type OnboardingStep
} from '@core/conversation/memory-onboarding'
import {
  acceptNickname,
  rejectNickname
} from '@core/conversation/relationship-confidence'
import { syncRelationshipFromTurn } from './relationshipSync'

/** Phase: nicknames / preferred name from the user turn. */
export function applyNicknameFromUserMessage(trimmed: string): void {
  try {
    const nick = extractExplicitNickname(trimmed)
    if (nick) {
      const mem = useSettingsStore.getState().settings.userMemory || { facts: [] }
      const nicks = Array.isArray(mem.nicknames) ? [...mem.nicknames] : []
      if (!nicks.map((x) => x.toLowerCase()).includes(nick.toLowerCase())) nicks.push(nick)
      useSettingsStore.getState().update({
        userMemory: {
          ...mem,
          preferredName: mem.preferredName || nick,
          nicknames: nicks.slice(0, 12),
          pendingNickname: undefined,
          updatedAt: Date.now()
        }
      })
      return
    }
    if (looksLikeNicknameAccept(trimmed)) {
      const mem = useSettingsStore.getState().settings.userMemory || { facts: [] }
      const rel = useSettingsStore.getState().settings.relationshipState
      const pend = mem.pendingNickname
      if (pend) {
        const r = acceptNickname(mem, rel, pend)
        useSettingsStore.getState().update({
          userMemory: r.userMemory,
          relationshipState: r.relationship
        })
      }
      return
    }
    if (looksLikeNicknameReject(trimmed)) {
      const mem = useSettingsStore.getState().settings.userMemory || { facts: [] }
      const rel = useSettingsStore.getState().settings.relationshipState
      const pend = mem.pendingNickname
      if (pend) {
        const r = rejectNickname(mem, rel, pend)
        useSettingsStore.getState().update({
          userMemory: r.userMemory,
          relationshipState: r.relationship
        })
      }
    }
  } catch {
    /* fail-soft */
  }
}

/** Phase: extract user facts + onboarding + relationship sync for this turn. */
export function applyUserMemoryFromTurn(
  trimmed: string,
  opts?: { previousAssistantText?: string; conversationId?: string }
): void {
  try {
    // E5 — explicit forget: «olvida que te llamo X» / «ya no me digas X»
    try {
      const forgetAsst =
        trimmed.match(
          /\b(?:olvida(?:\s+que)?(?:\s+te\s+llamo)?|ya no me digas|no me digas m[aá]s)\s+["«]?([^"».\n,;!?]{2,40})["»]?/i
        ) ||
        trimmed.match(/\b(?:olvida|borra)\s+(?:el apodo|que me llamas)\s+["«]?([^"».\n,;!?]{2,40})["»]?/i)
      if (forgetAsst?.[1]) {
        const name = forgetAsst[1].trim()
        const prev = useSettingsStore.getState().settings.assistantMemory || {}
        const preferredNames = (prev.preferredNames || []).filter(
          (n) => n.toLowerCase() !== name.toLowerCase()
        )
        const rejectedNames = Array.from(
          new Set([...(prev.rejectedNames || []), name])
        ).slice(0, 8)
        useSettingsStore.getState().update({
          assistantMemory: {
            ...prev,
            preferredNames,
            rejectedNames,
            updatedAt: Date.now()
          }
        })
      }
      const forgetUser = trimmed.match(
        /\b(?:olvida mi nombre|ya no me llames)\s+["«]?([^"».\n,;!?]{2,30})["»]?/i
      )
      if (forgetUser?.[1]) {
        const name = forgetUser[1].trim()
        const um = useSettingsStore.getState().settings.userMemory || { facts: [] }
        if (
          um.preferredName &&
          um.preferredName.toLowerCase() === name.toLowerCase()
        ) {
          useSettingsStore.getState().update({
            userMemory: { ...um, preferredName: undefined, updatedAt: Date.now() }
          })
        }
      }
    } catch {
      /* forget optional */
    }
    let previousAssistant = opts?.previousAssistantText || ''
    if (!previousAssistant && opts?.conversationId) {
      try {
        const conv = useChatStore.getState().conversations.find((c) => c.id === opts!.conversationId)
        const msgs = conv?.messages || []
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m.role === 'assistant' && m.content && !m.isStreaming) {
            previousAssistant = String(m.content)
            break
          }
        }
      } catch {
        /* optional */
      }
    }
    const facts = previousAssistant
      ? extractUserFactsFromTurnPair(trimmed, previousAssistant)
      : extractUserFactsFromMessage(trimmed)
    // Heal bad preferredName (e.g. «cuál» from «dime cuál de las dos»)
    try {
      const cur = useSettingsStore.getState().settings.userMemory
      const cleaned = sanitizeUserMemoryNames(cur)
      if (cleaned && cleaned !== cur) {
        useSettingsStore.getState().update({ userMemory: cleaned })
      }
    } catch {
      /* */
    }
    if (hasMemorySignal(facts)) {
      const prev = useSettingsStore.getState().settings.userMemory
      const merged = mergeUserMemory(prev, facts)
      const ob = useSettingsStore.getState().settings.memoryOnboarding
      const step = (ob?.step || 'name') as OnboardingStep
      let nextOb = ob
      try {
        if (
          shouldRunOnboarding({
            userMemory: prev,
            onboarding: ob,
            memoryGatePending: useSettingsStore.getState().settings.memoryGatePending
          })
        ) {
          const nextStep = advanceOnboardingAfterExtract(step, facts)
          nextOb = {
            active: nextStep !== 'done',
            step: nextStep,
            dismissed: false,
            updatedAt: Date.now()
          }
        }
      } catch {
        /* */
      }
      useSettingsStore.getState().update({
        userMemory: merged,
        ...(nextOb ? { memoryOnboarding: nextOb } : {})
      })
    }
    try {
      syncRelationshipFromTurn(trimmed)
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}
