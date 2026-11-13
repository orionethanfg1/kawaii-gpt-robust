import { mergeUserMemory, type ExtractedFacts, type UserMemory } from '@core/conversation/user-memory'
import {
  buildUserMemoryExtractMessages,
  filterKnownUserMemoryPatch,
  parseUserMemoryExtractJson,
  sanitizeUserMemoryExtract,
  shouldReviewUserMemoryText
} from '@core/conversation/user-memory-llm'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import type { Settings } from '@shared/types/settings'
import { isChatBusy } from './chatBusy'

const scheduledTurns = new Set<string>()
const completedTurns = new Set<string>()
const MAX_COMPLETED_TURNS = 500

function toSettingsUserMemory(memory: UserMemory): NonNullable<Settings['userMemory']> {
  return {
    ...memory,
    facts: memory.facts || [],
    nicknames: memory.nicknames || [],
    avatarScenes: memory.avatarScenes || [],
    goals: memory.goals || [],
    likes: memory.likes || [],
    favorites: memory.favorites || [],
    dislikes: memory.dislikes || [],
    standingInstructions: memory.standingInstructions || []
  }
}

function persistedMemoryContainsPatch(
  expected: UserMemory,
  patch: Partial<ExtractedFacts>
): boolean {
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
      settings?.userMemory && typeof settings.userMemory === 'object'
        ? (settings.userMemory as Record<string, unknown>)
        : null
    if (!saved) return false
    for (const field of [
      'userName',
      'preferredName',
      'appearanceNotes',
      'currentFocus'
    ] as const) {
      if (patch[field] && saved[field] !== expected[field]) return false
    }
    for (const field of [
      'facts',
      'standingInstructions',
      'goals',
      'likes',
      'favorites',
      'dislikes'
    ] as const) {
      const expectedValues = patch[field]
      if (!expectedValues?.length) continue
      const savedValues = Array.isArray(saved[field]) ? (saved[field] as unknown[]) : []
      if (expectedValues.some((value) => !savedValues.includes(value))) return false
    }
    if (patch.people?.length) {
      const savedPeople = Array.isArray(saved.people) ? saved.people : []
      if (
        patch.people.some(
          (person) =>
            !savedPeople.some(
              (stored) =>
                stored &&
                typeof stored === 'object' &&
                (stored as { name?: unknown }).name === person.name
            )
        )
      ) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

function rememberCompletedTurn(turnKey: string): void {
  completedTurns.add(turnKey)
  if (completedTurns.size > MAX_COMPLETED_TURNS) {
    const oldest = completedTurns.values().next().value
    if (oldest) completedTurns.delete(oldest)
  }
}

export function scheduleUserMemoryLlmReview(args: {
  convId: string
  assistantId: string
  userText: string
  previousAssistantText?: string
}): void {
  const text = String(args.userText || '').trim()
  const turnKey = `${args.convId}:${args.assistantId}`
  if (!shouldReviewUserMemoryText(text) || completedTurns.has(turnKey) || scheduledTurns.has(turnKey)) {
    return
  }

  scheduledTurns.add(turnKey)
  void (async () => {
    try {
      for (let attempt = 0; isChatBusy() && attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
      if (isChatBusy()) return

      const before = useSettingsStore.getState().settings
      const model = String(before.localModel || '').trim()
      if (!model) return
      const memorySnapshot = JSON.stringify(before.userMemory || null)
      const openAIUrl = String(before.localOpenAIBaseUrl || '').trim()
      const ollamaUrl = String(before.localBaseUrl || '').trim()
      if (!openAIUrl && !ollamaUrl) return

      const { OpenAICompatibleProvider, OllamaProvider } = await import('@core/providers')
      const provider = openAIUrl
        ? new OpenAICompatibleProvider({
            id: 'user-memory-reviewer',
            displayName: 'User memory reviewer',
            baseUrl: openAIUrl,
            timeoutMs: 45_000
          })
        : new OllamaProvider({ baseUrl: ollamaUrl, timeoutMs: 45_000 })

      const result = await provider.chat({
        model,
        messages: buildUserMemoryExtractMessages(text, args.previousAssistantText),
        temperature: 0.1,
        maxTokens: 240
      })
      const proposedPatch = sanitizeUserMemoryExtract(
        parseUserMemoryExtractJson(result.content),
        text
      )
      const current = useSettingsStore.getState().settings.userMemory
      if (JSON.stringify(current || null) !== memorySnapshot) {
        console.info('[user-memory] llm-review skipped; memory changed during extraction')
        return
      }
      const patch = filterKnownUserMemoryPatch(proposedPatch, current)
      const hasPatch = Object.values(patch).some((value) =>
        Array.isArray(value) ? value.length > 0 : Boolean(value)
      )
      if (!hasPatch) return
      const next = mergeUserMemory(current, patch)
      useSettingsStore.getState().update({ userMemory: toSettingsUserMemory(next) })
      if (!persistedMemoryContainsPatch(next, patch)) {
        console.error('[user-memory] llm-review durable readback mismatch')
        return
      }
      console.info('[user-memory] llm-review persisted', {
        facts: patch.facts?.length || 0,
        likes: patch.likes?.length || 0,
        dislikes: patch.dislikes?.length || 0,
        favorites: patch.favorites?.length || 0,
        goals: patch.goals?.length || 0,
        people: patch.people?.length || 0
      })
    } catch (error) {
      console.warn('[user-memory] llm-review skipped', error)
    } finally {
      scheduledTurns.delete(turnKey)
      rememberCompletedTurn(turnKey)
    }
  })()
}
