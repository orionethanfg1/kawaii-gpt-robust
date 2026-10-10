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

import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import {
  extractExplicitNickname,
  looksLikeNicknameAccept,
  looksLikeNicknameReject,
  extractUserFactsFromMessage,
  mergeUserMemory,
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
export function applyUserMemoryFromTurn(trimmed: string): void {
  try {
    const facts = extractUserFactsFromMessage(trimmed)
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
