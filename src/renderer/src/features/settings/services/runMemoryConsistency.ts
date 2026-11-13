/**
 * Run memory consistency over open chats (idle-friendly).
 */
import { runMemoryConsistencyPass } from '@core/conversation/memory-consistency'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

export type ConsistencyUiResult = {
  ok: boolean
  durationMs: number
  assistantAdded: string[]
  userAdded: string[]
  favoritesFound: string[]
  scannedAssistant: number
  scannedUser: number
}

export function runOpenChatsMemoryConsistency(): ConsistencyUiResult {
  const convs = useChatStore.getState().conversations || []
  const messages = convs.flatMap((c) =>
    (c.messages || []).map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : ''
    }))
  )
  const s = useSettingsStore.getState().settings
  const report = runMemoryConsistencyPass({
    messages,
    assistantMemory: s.assistantMemory,
    userMemory: s.userMemory
  })
  return {
    ok: true,
    durationMs: report.durationMs,
    assistantAdded: report.assistantAdded,
    userAdded: report.userAdded,
    favoritesFound: report.favoritesFound,
    scannedAssistant: report.scannedAssistant,
    scannedUser: report.scannedUser
  }
}
