/**
 * Lightweight memory consistency pass over recent chat messages.
 * Pure + fast: regex extract only (no LLM). Safe on open / idle.
 */
import {
  extractAssistantSelfFacts,
  mergeAssistantMemory,
  type AssistantMemory
} from './assistant-memory'
import {
  extractUserFactsFromMessage,
  mergeUserMemory,
  type UserMemory
} from './user-memory'
import { extractFavorites, favoritesToStrings, mergeFavoriteStrings } from './favorites'

export type ChatMessageLite = {
  role: 'user' | 'assistant' | string
  content: string
}

export type MemoryConsistencyReport = {
  scannedAssistant: number
  scannedUser: number
  assistantAdded: string[]
  userAdded: string[]
  favoritesFound: string[]
  durationMs: number
  assistantMemory: AssistantMemory
  userMemory: UserMemory
}

const MAX_MSGS = 40
const MAX_CHARS = 12_000

/**
 * Scan recent messages and merge any missing likes/favorites into memory.
 */
export function runMemoryConsistencyPass(input: {
  messages: ChatMessageLite[]
  assistantMemory?: AssistantMemory | null
  userMemory?: UserMemory | null
}): MemoryConsistencyReport {
  const t0 = Date.now()
  const msgs = (input.messages || []).slice(-MAX_MSGS)
  let aMem = input.assistantMemory || { likes: [], favorites: [], dislikes: [] }
  let uMem = input.userMemory || { facts: [], likes: [], favorites: [] }
  const assistantAdded: string[] = []
  const userAdded: string[] = []
  const favoritesFound: string[] = []
  let scannedAssistant = 0
  let scannedUser = 0
  let budget = MAX_CHARS

  for (const m of msgs) {
    const text = String(m.content || '').trim()
    if (!text || text.length < 8) continue
    if (budget <= 0) break
    const slice = text.slice(0, Math.min(text.length, budget))
    budget -= slice.length

    if (m.role === 'assistant') {
      scannedAssistant++
      const patch = extractAssistantSelfFacts(slice)
      const favs = favoritesToStrings(extractFavorites(slice))
      if (favs.length) {
        patch.favorites = mergeFavoriteStrings(patch.favorites, favs, 10)
        favoritesFound.push(...favs)
      }
      if (
        patch.likes?.length ||
        patch.favorites?.length ||
        patch.dislikes?.length ||
        patch.habits?.length ||
        patch.relational?.length
      ) {
        const before = new Set([
          ...(aMem.likes || []),
          ...(aMem.favorites || [])
        ].map((x) => x.toLowerCase()))
        aMem = mergeAssistantMemory(aMem, patch)
        for (const x of [...(patch.likes || []), ...(patch.favorites || [])]) {
          if (!before.has(x.toLowerCase())) assistantAdded.push(x)
        }
      }
    } else if (m.role === 'user') {
      scannedUser++
      const patch = extractUserFactsFromMessage(slice)
      const favs = favoritesToStrings(extractFavorites(slice))
      if (favs.length) {
        patch.favorites = favs
        favoritesFound.push(...favs)
      }
      if (patch.likes?.length || patch.favorites?.length || patch.preferredName) {
        const before = new Set([
          ...(uMem.likes || []),
          ...(uMem.favorites || [])
        ].map((x) => x.toLowerCase()))
        uMem = mergeUserMemory(uMem, patch)
        for (const x of [...(patch.likes || []), ...(patch.favorites || [])]) {
          if (!before.has(x.toLowerCase())) userAdded.push(x)
        }
      }
    }
  }

  return {
    scannedAssistant,
    scannedUser,
    assistantAdded: [...new Set(assistantAdded)].slice(0, 12),
    userAdded: [...new Set(userAdded)].slice(0, 12),
    favoritesFound: [...new Set(favoritesFound)].slice(0, 12),
    durationMs: Date.now() - t0,
    assistantMemory: aMem,
    userMemory: uMem
  }
}
