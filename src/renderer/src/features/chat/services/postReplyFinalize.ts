/**
 * Post-reply finalize — single owner of:
 *   1) display cleanup (thinking + loop collapse)
 *   2) assistant memory collection (from milder memorySource — B1)
 *   3) relationship sync
 *
 * Extracted from useChat onDone so memory/collapse can evolve without the hook monolith.
 */

import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { bumpTurns } from '@core/conversation/relationship-confidence'
import {
  userReopenedIntimacy,
  clearStaleIntimacyBoundary
} from '@core/conversation/intimacy-stage'
import { maybeNotifyModelRefusal } from './modelRefusalTip'
import { finalizeAssistantReply } from '@core/chat/assistant-reply-pipeline'
import { inferAssistantGender } from '@core/character/pronouns'
import { runAssistantMemoryCollector } from './assistantMemoryCollector'
import { syncRelationshipFromTurn } from './relationshipSync'
import {
  extractUserMood,
  extractAssistantMood,
  mergeMoodEntry
} from '@core/conversation/mood-memory'

export type PostReplyFinalizeArgs = {
  convId: string
  assistantId: string
  /** User message for this turn */
  userText: string
  /** Full text from orchestrator (pre-UI), if any */
  orchestratorContent?: string
  finishReason?: string | null
  limited?: boolean
}

export type PostReplyFinalizeResult = {
  finalText: string
  rawText: string
  memoryChanged: boolean
  limited?: boolean
}

/**
 * Apply display finalize + memory collector for a completed assistant bubble.
 * Safe to call once from onDone. Never throws.
 */
export function finalizeCompletedAssistantReply(
  args: PostReplyFinalizeArgs
): PostReplyFinalizeResult {
  const { convId, assistantId, userText } = args

  // Persist after every completed turn (companion history must not vanish)
  try {
    void import('./chatDiskSpill').then(async (m) => {
      try {
        const st = useChatStore.getState()
        const cons = st.conversations || []
        m.noteFullConversationsForSpill(cons)
        const active = cons.find((c) => c.id === convId) || cons.find((c) => c.id === st.activeId)
        if (active && (active.messages?.length || 0) > 0) {
          await m.spillConversationToDisk(active)
        }
      } catch (e) {
        console.warn('[postReplyFinalize] chat spill', e)
      }
    })
  } catch {
    /* */
  }

  // R4: clear intimacy soft-no if user reopens or fact is stale
  try {
    const s0 = useSettingsStore.getState().settings
    const mem0 = s0.userMemory || { facts: [] }
    let facts = clearStaleIntimacyBoundary(mem0.facts || [], {
      lastBoundaryAt: s0.relationshipState?.lastIntimacyProposalAt
    })
    if (userReopenedIntimacy(userText || '')) {
      facts = clearStaleIntimacyBoundary(facts, { force: true })
      const rel = { ...(s0.relationshipState || {}), intimacyOpen: true, updatedAt: Date.now() }
      useSettingsStore.getState().update({
        userMemory: { ...mem0, facts, updatedAt: Date.now() },
        relationshipState: rel
      })
    } else if (facts.length !== (mem0.facts || []).length) {
      useSettingsStore.getState().update({
        userMemory: { ...mem0, facts, updatedAt: Date.now() }
      })
    }
  } catch {
    /* R4 optional */
  }

  // I1–I3: intimacy scene phase + privileged first-time / scene notes (separate extractor)
  void import('@core/conversation/intimacy-memory')
    .then(({ applyIntimacyExtraction }) => {
      const sI = useSettingsStore.getState().settings
      let msgs: Array<{ role?: string; content?: string }> = []
      try {
        const { useChatStore } = require('@shared/lib/stores/chatStore') as typeof import('@shared/lib/stores/chatStore')
        const active = useChatStore.getState().getActive?.()
        msgs = (active?.messages || []).map((m: { role?: string; content?: string }) => ({
          role: m.role,
          content: String(m.content || '')
        }))
      } catch {
        msgs = []
      }
      if (msgs.length < 4) return
      const done = Boolean(
        (sI.relationshipState as { firstIntimateSceneDone?: boolean } | undefined)
          ?.firstIntimateSceneDone
      )
      const applied = applyIntimacyExtraction({
        facts: sI.userMemory?.facts || [],
        relationship: sI.relationshipState,
        messages: msgs,
        userName: (() => {
          const p = (sI.userMemory as { preferredName?: string } | undefined)?.preferredName
          if (p && !/^(tuyo|tuya|amor|cari[nñ]o)$/i.test(String(p).trim())) return p
          return undefined
        })(),
        characterName: sI.character?.name,
        forceFirst: !done && msgs.length >= 8
      })
      const prevPhase = (sI.relationshipState as { scenePhase?: string } | undefined)?.scenePhase
      // Always align scenePhase with live signals (messages + facts)
      let livePhase = applied.phase
      try {
        const { resolveLiveIntimatePhase } = require('@core/conversation/intimacy-memory') as typeof import('@core/conversation/intimacy-memory')
        livePhase = resolveLiveIntimatePhase({
          relationship: applied.relationship,
          facts: applied.facts,
          recentTexts: msgs.map((m: { content?: string }) => String(m.content || ''))
        })
      } catch {
        /* */
      }
      const relOut = {
        ...applied.relationship,
        scenePhase: livePhase,
        updatedAt: Date.now()
      }
      if (
        applied.wroteFirst ||
        applied.wroteNote ||
        applied.phase !== prevPhase ||
        livePhase !== prevPhase
      ) {
        useSettingsStore.getState().update({
          userMemory: {
            ...(sI.userMemory || { facts: [] }),
            facts: applied.facts,
            updatedAt: Date.now()
          },
          relationshipState: relOut
        })
      }
      if (applied.wroteFirst || applied.wroteNote) {
        try {
          const { useChatStore } = require('@shared/lib/stores/chatStore') as typeof import('@shared/lib/stores/chatStore')
          const id = useChatStore.getState().activeId
          if (id) useChatStore.getState().setPrivate?.(id, true)
        } catch {
          /* */
        }
      }
      if (applied.wroteFirst) {
        void (async () => {
          try {
            const firstLine = applied.facts.find((f) => String(f).startsWith('INTIMACY_FIRST:'))
            const draft = firstLine
              ? String(firstLine).replace(/^INTIMACY_FIRST:\s*/i, '')
              : ''
            if (draft.length < 40) return
            const {
              refineIntimacyFirstInApp,
              commitIntimacyFirstNarrative
            } = await import('./refineIntimacyFirst')
            const refined = await refineIntimacyFirstInApp({
              draft,
              messages: msgs,
              userName: (sI.userMemory as { userName?: string } | undefined)?.userName,
              characterName: sI.character?.name
            })
            if (refined.source === 'llm' && refined.text) {
              commitIntimacyFirstNarrative(refined.text)
            }
          } catch {
            /* non-blocking */
          }
        })()
      }
    })
    .catch(() => null)

  console.warn('[kawaii-memory] finalize enter', {
    conv: convId.slice(0, 8),
    orchLen: String(args.orchestratorContent || '').length,
    userLen: String(userText || '').length,
    finishReason: args.finishReason || null,
    limited: Boolean(args.limited)
  })
  let rawText = String(args.orchestratorContent || '').trim()
  let finalText = ''
  let memorySource = ''
  let memoryChanged = false
  let limited = Boolean(args.limited)

  try {
    const st = useChatStore.getState()
    const msg = st.conversations
      .find((c) => c.id === convId)
      ?.messages.find((m) => m.id === assistantId)
    if (!rawText) rawText = msg?.content || ''
    const displaySrc =
      rawText.length >= (msg?.content || '').length ? rawText : msg?.content || rawText

    if (displaySrc) {
      let previousAssistant = ''
      const recentAssistants: string[] = []
      try {
        const conv = st.conversations.find((c) => c.id === convId)
        const msgs = conv?.messages || []
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m.id === assistantId) continue
          if (m.role === 'assistant' && m.content && !m.isStreaming) {
            // skip pure harness bubbles for opener stats
            const model = String(m.meta?.model || '')
            if (model === 'harness-host' || /harness/i.test(model)) continue
            recentAssistants.push(String(m.content))
            if (!previousAssistant) previousAssistant = String(m.content)
            if (recentAssistants.length >= 4) break
          }
        }
      } catch {
        /* */
      }
      const stSettings = useSettingsStore.getState().settings
      const userName =
        (stSettings.userMemory as { preferredName?: string; name?: string } | undefined)
          ?.preferredName ||
        (stSettings.userMemory as { name?: string } | undefined)?.name ||
        undefined
      const assistantGender = inferAssistantGender({
        explicit: (stSettings.character as { gender?: string } | undefined)?.gender,
        relationshipRole: stSettings.character?.relationshipRole,
        name: stSettings.character?.name,
        personality: stSettings.character?.personality
      })
      const fin = finalizeAssistantReply(displaySrc, {
        characterName: stSettings.character?.name,
        userName,
        finishReason: args.finishReason,
        previousAssistant,
        recentAssistants,
        assistantGender
      })
      finalText = fin.display
      memorySource = fin.memorySource || fin.raw
      limited = limited || Boolean(fin.limited)
      if (finalText) {
        const prevMeta = (msg?.meta || {}) as Record<string, unknown>
        st.updateMessage(convId, assistantId, {
          content: finalText,
          isStreaming: false,
          meta: {
            ...prevMeta,
            ...(args.finishReason ? { finishReason: args.finishReason } : {}),
            ...(limited ? { limited: true } : {})
          }
        })
      }
    }
  } catch (e) {
    console.warn('[postReplyFinalize] display', e)
  }

  try {
    syncRelationshipFromTurn(userText, finalText || rawText)
  } catch {
    /* ignore */
  }

  // Companion: evolve relationship stage with real conversation turns
  try {
    const s = useSettingsStore.getState().settings
    try {
      const modelHint = String(
        (useChatStore.getState().conversations
          .find((c) => c.id === convId)
          ?.messages.find((m) => m.id === assistantId)?.meta as { model?: string } | undefined)
          ?.model || ''
      )
      maybeNotifyModelRefusal(finalText || rawText, { modelId: modelHint })
    } catch {
      /* tip */
    }
    const nextRel = bumpTurns(s.relationshipState, 1)
    if (
      nextRel.turnsTogether !== s.relationshipState?.turnsTogether ||
      nextRel.stage !== s.relationshipState?.stage
    ) {
      useSettingsStore.getState().update({ relationshipState: nextRel })
    }
  } catch {
    /* ignore */
  }

  // Memory: prefer B1 memorySource (milder), then raw / store
  try {
    const storeTxt =
      useChatStore
        .getState()
        .conversations.find((c) => c.id === convId)
        ?.messages.find((m) => m.id === assistantId)?.content || ''

    const candidates: Array<{ via: string; text: string }> = [
      { via: 'memorySource', text: memorySource },
      { via: 'raw', text: rawText },
      { via: 'store', text: storeTxt },
      { via: 'final', text: finalText }
    ]
    for (const c of candidates) {
      if (!c.text || c.text.length < 8) continue
      const r = runAssistantMemoryCollector(c.text, { userText })
      if (r?.changed) {
        memoryChanged = true
        console.warn('[postReplyFinalize] memory-hit', { via: c.via, reason: r.reason })
        break
      }
      if (r && !r.changed) {
        console.warn('[postReplyFinalize] memory-no-change', { via: c.via, reason: r.reason })
      }
    }
  } catch (e) {
    console.warn('[postReplyFinalize] memory', e)
  }

  // Late flush if stream wrote after finalize
  setTimeout(() => {
    try {
      const again =
        useChatStore
          .getState()
          .conversations.find((c) => c.id === convId)
          ?.messages.find((m) => m.id === assistantId)?.content || finalText
      if (again && again.length > 12) {
        const r = runAssistantMemoryCollector(again, { userText })
        if (r?.changed) {
          console.warn('[postReplyFinalize] memory-hit', { via: 'late', reason: r.reason })
        }
      }
    } catch {
      /* ignore */
    }
  }, 400)

  // B2b — mood with timestamps (user + assistant)
  try {
    const now = Date.now()
    const s = useSettingsStore.getState()
    const uMood = extractUserMood(userText, now)
    const aMood = extractAssistantMood(memorySource || finalText || rawText, now)
    const patch: Record<string, unknown> = {}
    if (uMood) {
      patch.userMood = mergeMoodEntry(
        (s.settings as { userMood?: import('@core/conversation/mood-memory').MoodEntry[] }).userMood,
        uMood
      )
    }
    if (aMood) {
      patch.assistantMood = mergeMoodEntry(
        (s.settings as { assistantMood?: import('@core/conversation/mood-memory').MoodEntry[] }).assistantMood,
        aMood,
        6
      )
    }
    if (Object.keys(patch).length) {
      s.update(patch as never)
      console.warn('[kawaii-memory] mood', {
        user: Boolean(uMood),
        assistant: Boolean(aMood)
      })
    }
  } catch (e) {
    console.warn('[kawaii-memory] mood collect failed', e)
  }

  return { finalText, rawText, memoryChanged, limited }
}
