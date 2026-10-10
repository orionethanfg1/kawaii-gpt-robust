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
import { finalizeAssistantReply } from '@core/chat/assistant-reply-pipeline'
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
      const fin = finalizeAssistantReply(displaySrc, {
        characterName: useSettingsStore.getState().settings.character?.name,
        finishReason: args.finishReason
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
