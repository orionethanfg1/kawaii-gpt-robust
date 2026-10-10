/**
 * Post-reply memory collector (assistant individuality).
 * B0: structured runtime logs (counts only — never full reply text).
 */

import {
  type AssistantMemory,
  emptyAssistantMemory,
  isAssistantMemoryEmpty
} from '@core/conversation/assistant-memory'
import { resolveMirrorVsStore, ASSISTANT_MEMORY_VERSION } from '@core/conversation/assistant-memory-reconcile'
import { reportMemoryCollectStatus } from '@core/conversation/memory-collect-status'
import {
  collectAssistantMemoryFromReply,
  type CollectAssistantMemoryResult
} from '@core/conversation/collect-assistant-memory'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

const MIRROR_KEY = 'kawaii-assistant-memory-v1'

function counts(m?: AssistantMemory | null): {
  likes: number
  dislikes: number
  habits: number
  boundaries: number
  voiceNotes: number
  relational: number
} {
  return {
    likes: m?.likes?.length || 0,
    dislikes: m?.dislikes?.length || 0,
    habits: m?.habits?.length || 0,
    boundaries: m?.boundaries?.length || 0,
    voiceNotes: m?.voiceNotes?.length || 0,
    relational: m?.relational?.length || 0
  }
}

function readMirror(): AssistantMemory | null {
  try {
    const raw = localStorage.getItem(MIRROR_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as AssistantMemory
    if (!p || typeof p !== 'object') return null
    return p
  } catch {
    return null
  }
}

function writeMirror(mem: AssistantMemory): void {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(mem))
  } catch {
    /* quota */
  }
}

/**
 * Force-write assistant memory to settings + mirror (bypasses soft merge quirks).
 */
export function forcePersistAssistantMemory(mem: AssistantMemory): boolean {
  try {
    const clean: AssistantMemory = {
      likes: Array.isArray(mem.likes) ? mem.likes.slice(0, 12) : [],
      dislikes: Array.isArray(mem.dislikes) ? mem.dislikes.slice(0, 10) : [],
      habits: Array.isArray(mem.habits) ? mem.habits.slice(0, 10) : [],
      boundaries: Array.isArray(mem.boundaries) ? mem.boundaries.slice(0, 8) : [],
      voiceNotes: Array.isArray(mem.voiceNotes) ? mem.voiceNotes.slice(0, 8) : [],
      relational: Array.isArray(mem.relational) ? mem.relational.slice(0, 12) : [],
      updatedAt: Date.now()
    }
    const before = counts(useSettingsStore.getState().settings.assistantMemory)
    useSettingsStore.getState().update({ assistantMemory: clean })
    writeMirror(clean)
    const after = counts(useSettingsStore.getState().settings.assistantMemory)
    const mirrorOk = !isAssistantMemoryEmpty(readMirror())
    console.warn('[assistant-memory] persisted', {
      before,
      after,
      mirrorOk,
      updatedAt: clean.updatedAt
    })
    // Readback mismatch = store rejected or merge lost fields
    if (
      after.likes < clean.likes!.length ||
      after.dislikes < clean.dislikes!.length ||
      after.habits < clean.habits!.length
    ) {
      console.warn('[assistant-memory] setState readback mismatch', {
        written: counts(clean),
        store: after
      })
      return false
    }
    return true
  } catch (e) {
    console.warn('[assistant-memory] setState failed', e)
    return false
  }
}

/**
 * Main entry from postReplyFinalize / onDone.
 */
export function runAssistantMemoryCollector(
  replyText: string,
  opts?: { userText?: string }
): CollectAssistantMemoryResult | null {
  const prev =
    useSettingsStore.getState().settings.assistantMemory || emptyAssistantMemory()
  const textLen = String(replyText || '').length
  let result: CollectAssistantMemoryResult
  try {
    result = collectAssistantMemoryFromReply(prev, replyText, opts)
  } catch (e) {
    console.warn('[assistant-memory] collect failed', e)
    reportMemoryCollectStatus({
      at: Date.now(),
      ok: false,
      changed: false,
      error: e instanceof Error ? e.message : 'collect failed'
    })
    return null
  }

  const extractedCounts = {
    likes: result.extracted?.likes?.length || 0,
    dislikes: result.extracted?.dislikes?.length || 0,
    habits: result.extracted?.habits?.length || 0
  }

  if (!result.changed) {
    console.warn('[assistant-memory] skip', result.reason, {
      textLen,
      extracted: extractedCounts,
      store: counts(prev)
    })
    reportMemoryCollectStatus({
      at: Date.now(),
      ok: true,
      changed: false,
      reason: result.reason,
      extracted: {
        likes: extractedCounts.likes,
        dislikes: extractedCounts.dislikes,
        habits: extractedCounts.habits,
        relational: result.extracted?.relational?.length || 0
      }
    })
    return result
  }

  const ok = forcePersistAssistantMemory(result.memory)
  console.warn('[assistant-memory] write', {
    reason: result.reason,
    textLen,
    extracted: extractedCounts,
    written: counts(result.memory),
    persistOk: ok
  })
  reportMemoryCollectStatus({
    at: Date.now(),
    ok: true,
    changed: true,
    reason: result.reason,
    extracted: {
      likes: extractedCounts.likes,
      dislikes: extractedCounts.dislikes,
      habits: extractedCounts.habits,
      relational: result.extracted?.relational?.length || 0
    },
    persistOk: ok
  })
  return result
}

/** Panel can rehydrate from mirror if store empty */
export function hydrateAssistantMemoryFromMirror(): AssistantMemory | null {
  const mir = readMirror()
  const store = useSettingsStore.getState().settings.assistantMemory
  const resolved = resolveMirrorVsStore(store, mir)
  if (resolved.source === 'empty' || isAssistantMemoryEmpty(resolved.memory)) return null
  forcePersistAssistantMemory(resolved.memory)
  console.warn('[assistant-memory] hydrate', {
    source: resolved.source,
    version: ASSISTANT_MEMORY_VERSION,
    ...counts(resolved.memory)
  })
  return resolved.memory
}

export function peekAssistantMemoryMirror(): AssistantMemory | null {
  return readMirror()
}
