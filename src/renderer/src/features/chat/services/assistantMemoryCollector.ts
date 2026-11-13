/**
 * Post-reply memory collector (assistant individuality).
 * B0: structured runtime logs (counts only — never full reply text).
 */

import {
  type AssistantMemory,
  emptyAssistantMemory,
  isAssistantMemoryEmpty,
  isStableTopicPhrase,
  classifyAssistantLikePhrase,
  isAssistantPreferenceQuestion
} from '@core/conversation/assistant-memory'
import { resolveMirrorVsStore, ASSISTANT_MEMORY_VERSION } from '@core/conversation/assistant-memory-reconcile'
import { reportMemoryCollectStatus } from '@core/conversation/memory-collect-status'
import { recordMemoryWrite, clipSamples } from '@core/conversation/memory-write-log'
import {
  collectAssistantMemoryFromReply,
  type CollectAssistantMemoryResult
} from '@core/conversation/collect-assistant-memory'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import {
  appendAssistantMemoryTurnReceipt,
  hasAssistantMemoryTurnReceipt
} from '@core/conversation/assistant-memory-idempotency'

const MIRROR_KEY = 'kawaii-assistant-memory-v1'

function counts(m?: AssistantMemory | null): {
  likes: number
  favorites: number
  dislikes: number
  habits: number
  boundaries: number
  voiceNotes: number
  relational: number
} {
  return {
    likes: m?.likes?.length || 0,
    favorites: m?.favorites?.length || 0,
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

function writeMirror(mem: AssistantMemory): boolean {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(mem))
    return true
  } catch {
    console.error('[assistant-memory] mirror persist failed')
    return false
  }
}

function persistedMemoryMatches(expected: AssistantMemory): boolean {
  try {
    const raw = localStorage.getItem('kawaii-settings-v2')
    if (!raw) return false
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return false
    const root = parsed as Record<string, unknown>
    const state =
      root.state && typeof root.state === 'object'
        ? (root.state as Record<string, unknown>)
        : root
    const settings =
      state.settings && typeof state.settings === 'object'
        ? (state.settings as Record<string, unknown>)
        : null
    const saved =
      settings?.assistantMemory && typeof settings.assistantMemory === 'object'
        ? (settings.assistantMemory as Record<string, unknown>)
        : null
    if (!saved) return false
    const fields = [
      'preferredNames',
      'rejectedNames',
      'growthNotes',
      'likes',
      'favorites',
      'dislikes',
      'habits',
      'boundaries',
      'voiceNotes',
      'relational'
    ] as const
    return fields.every(
      (field) =>
        JSON.stringify(Array.isArray(saved[field]) ? saved[field] : []) ===
        JSON.stringify(expected[field] || [])
    )
  } catch {
    return false
  }
}

function persistedTurnReceiptMatches(receipt: string): boolean {
  try {
    const raw = localStorage.getItem('kawaii-settings-v2')
    if (!raw) return false
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return false
    const root = parsed as Record<string, unknown>
    const state =
      root.state && typeof root.state === 'object'
        ? (root.state as Record<string, unknown>)
        : root
    const settings =
      state.settings && typeof state.settings === 'object'
        ? (state.settings as Record<string, unknown>)
        : null
    const receipts = settings?.assistantMemoryTurnReceipts
    return Array.isArray(receipts) && receipts.includes(receipt)
  } catch {
    return false
  }
}

export function persistAssistantMemoryTurnReceipt(receipt: string): boolean {
  try {
    const settings = useSettingsStore.getState().settings
    const receipts = appendAssistantMemoryTurnReceipt(
      settings.assistantMemoryTurnReceipts,
      receipt
    )
    useSettingsStore.getState().update({ assistantMemoryTurnReceipts: receipts })
    return (
      hasAssistantMemoryTurnReceipt(
        useSettingsStore.getState().settings.assistantMemoryTurnReceipts,
        receipt
      ) && persistedTurnReceiptMatches(receipt)
    )
  } catch (error) {
    console.warn('[assistant-memory] turn receipt persist failed', error)
    return false
  }
}

/**
 * Force-write assistant memory to settings + mirror (bypasses soft merge quirks).
 */
export function forcePersistAssistantMemory(mem: AssistantMemory, turnReceipt?: string): boolean {
  try {
    const scrubLikes = (xs?: string[]) =>
      (xs || [])
        .filter((x) => classifyAssistantLikePhrase(x) === 'stable' || isStableTopicPhrase(x))
        .slice(0, 12)
    const scrubReject = (xs?: string[]) =>
      (xs || []).filter((x) => !/^(así|asi|eso|esto)$/i.test(x)).slice(0, 6)
    const clean = {
      preferredNames: Array.isArray(mem.preferredNames) ? mem.preferredNames.slice(0, 8) : [],
      rejectedNames: scrubReject(mem.rejectedNames),
      growthNotes: Array.isArray(mem.growthNotes) ? mem.growthNotes.slice(0, 10) : [],
      likes: scrubLikes(mem.likes),
      favorites: Array.isArray(mem.favorites) ? mem.favorites.slice(0, 10) : [],
      dislikes: Array.isArray(mem.dislikes) ? mem.dislikes.slice(0, 10) : [],
      habits: Array.isArray(mem.habits) ? mem.habits.slice(0, 10) : [],
      boundaries: Array.isArray(mem.boundaries) ? mem.boundaries.slice(0, 8) : [],
      voiceNotes: Array.isArray(mem.voiceNotes) ? mem.voiceNotes.slice(0, 8) : [],
      relational: Array.isArray(mem.relational) ? mem.relational.slice(0, 12) : [],
      updatedAt: Date.now()
    }
    const before = counts(useSettingsStore.getState().settings.assistantMemory)
    const settings = useSettingsStore.getState().settings
    useSettingsStore.getState().update({
      assistantMemory: clean,
      ...(turnReceipt
        ? {
            assistantMemoryTurnReceipts: appendAssistantMemoryTurnReceipt(
              settings.assistantMemoryTurnReceipts,
              turnReceipt
            )
          }
        : {})
    })
    const mirrorOk = writeMirror(clean)
    const after = counts(useSettingsStore.getState().settings.assistantMemory)
    const durableOk = persistedMemoryMatches(clean)
    const receiptOk =
      !turnReceipt ||
      (hasAssistantMemoryTurnReceipt(
        useSettingsStore.getState().settings.assistantMemoryTurnReceipts,
        turnReceipt
      ) &&
        persistedTurnReceiptMatches(turnReceipt))
    console.warn('[assistant-memory] persisted', {
      before,
      after,
      mirrorOk,
      durableOk,
      receiptOk,
      updatedAt: clean.updatedAt
    })
    // Readback mismatch = store rejected or merge lost fields
    if (
      after.likes < (clean.likes?.length || 0) ||
      (after.favorites || 0) < (clean.favorites?.length || 0) ||
      after.dislikes < (clean.dislikes?.length || 0) ||
      after.habits < (clean.habits?.length || 0)
    ) {
      console.warn('[assistant-memory] setState readback mismatch', {
        written: counts(clean),
        store: after
      })
      return false
    }
    if (!durableOk || !receiptOk) {
      console.error('[assistant-memory] durable readback mismatch', {
        memory: durableOk,
        receipt: receiptOk
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
  opts?: { userText?: string; turnReceipt?: string }
): CollectAssistantMemoryResult | null {
  const settings = useSettingsStore.getState().settings
  if (
    opts?.turnReceipt &&
    hasAssistantMemoryTurnReceipt(settings.assistantMemoryTurnReceipts, opts.turnReceipt)
  ) {
    return null
  }
  const prev = settings.assistantMemory || emptyAssistantMemory()
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
    const receiptOk = opts?.turnReceipt
      ? persistAssistantMemoryTurnReceipt(opts.turnReceipt)
      : true
    console.warn('[assistant-memory] skip', result.reason, {
      textLen,
      extracted: extractedCounts,
      store: counts(prev),
      receiptOk
    })
    reportMemoryCollectStatus({
      at: Date.now(),
      ok: receiptOk,
      changed: false,
      reason: result.reason,
      extracted: {
        likes: extractedCounts.likes,
        dislikes: extractedCounts.dislikes,
        habits: extractedCounts.habits,
        relational: result.extracted?.relational?.length || 0
      },
      ...(!receiptOk ? { error: 'Persistent assistant-memory turn receipt readback failed' } : {})
    })
    result.persisted = receiptOk
    return result
  }

  const ok = forcePersistAssistantMemory(result.memory, opts?.turnReceipt)
  console.warn('[assistant-memory] write', {
    reason: result.reason,
    textLen,
    extracted: extractedCounts,
    written: counts(result.memory),
    persistOk: ok
  })
  reportMemoryCollectStatus({
    at: Date.now(),
    ok,
    changed: true,
    reason: result.reason,
    extracted: {
      likes: extractedCounts.likes,
      dislikes: extractedCounts.dislikes,
      habits: extractedCounts.habits,
      relational: result.extracted?.relational?.length || 0
    },
    persistOk: ok,
    ...(!ok
      ? { error: 'Persistent settings readback did not match the written assistant memory' }
      : {})
  })
  try {
    const ex = result.extracted || {}
    recordMemoryWrite({
      side: 'assistant',
      reason: String(result.reason || 'collector'),
      fields: {
        likes: extractedCounts.likes,
        dislikes: extractedCounts.dislikes,
        habits: extractedCounts.habits,
        relational: ex.relational?.length || 0,
        preferredNames: ex.preferredNames?.length || 0,
        favorites: (ex as { favorites?: string[] }).favorites?.length || 0
      },
      samples: clipSamples({
        likes: ex.likes,
        dislikes: ex.dislikes,
        habits: ex.habits,
        relational: ex.relational,
        preferredNames: ex.preferredNames,
        favorites: (ex as { favorites?: string[] }).favorites
      }),
      persistOk: ok
    })
  } catch {
    /* log optional */
  }
  if (ok && isAssistantPreferenceQuestion(opts?.userText)) {
    scheduleLlmAssistantMemoryEnrich(replyText, opts)
  }
  return { ...result, persisted: ok }
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

/**
 * Background: ask the local/cloud model to extract clean memory (app = intermediary).
 * Heuristics already ran; LLM may add high-quality topics and is filtered again.
 */
export function scheduleLlmAssistantMemoryEnrich(
  replyText: string,
  opts?: { userText?: string }
): void {
  const text = String(replyText || '').trim()
  if (text.length < 80) return
  const expectedUpdatedAt =
    useSettingsStore.getState().settings.assistantMemory?.updatedAt || 0
  void (async () => {
    try {
      const {
        buildAssistantMemoryExtractMessages,
        parseAssistantMemoryExtractJson,
        sanitizeLlmMemoryPatch
      } = await import('@core/conversation/assistant-memory-llm')
      const { mergeAssistantMemory } = await import('@core/conversation/assistant-memory')
      const settings = useSettingsStore.getState().settings
      const model = (settings.localModel || '').trim()
      if (!model) return
      const openBase = (settings.localOpenAIBaseUrl || '').trim()
      const ollamaBase = (settings.localBaseUrl || '').trim()
      const messages = buildAssistantMemoryExtractMessages(text, opts?.userText)
      const { OpenAICompatibleProvider, OllamaProvider } = await import('@core/providers')
      const provider = openBase
        ? new OpenAICompatibleProvider({
            id: 'assistant-memory-extractor',
            displayName: 'Assistant memory extractor',
            baseUrl: openBase,
            timeoutMs: 45_000
          })
        : ollamaBase
          ? new OllamaProvider({ baseUrl: ollamaBase, timeoutMs: 45_000 })
          : null
      if (!provider) return
      const result = await provider.chat({
        model,
        messages,
        temperature: 0.1,
        maxTokens: 400
      })
      const raw = result.content
      const patch = sanitizeLlmMemoryPatch(parseAssistantMemoryExtractJson(raw))
      const has =
        (patch.likes?.length || 0) +
          (patch.preferredNames?.length || 0) +
          (patch.dislikes?.length || 0) +
          (patch.relational?.length || 0) >
        0
      if (!has) return
      const current = useSettingsStore.getState().settings.assistantMemory
      if ((current?.updatedAt || 0) !== expectedUpdatedAt) {
        console.info('[assistant-memory] llm-enrich skipped; memory changed during extraction')
        return
      }
      const prev = current || emptyAssistantMemory()
      const next = mergeAssistantMemory(prev, patch)
      const persistOk = forcePersistAssistantMemory(next)
      if (persistOk) {
        console.info('[assistant-memory] llm-enrich persisted', {
          likes: patch.likes?.length || 0,
          names: patch.preferredNames?.length || 0
        })
      } else {
        console.error('[assistant-memory] llm-enrich persistence failed')
      }
    } catch (e) {
      console.warn('[assistant-memory] llm-enrich skip', e)
    }
  })()
}
