import type { ChatMachineCapacity } from '@core/conversation/output-budget'

const CACHE_MS = 5 * 60_000
let cachedAt = 0
let cachedCapacity: ChatMachineCapacity | null = null
let pending: Promise<ChatMachineCapacity | null> | null = null

export function parseChatMachineCapacity(value: unknown): ChatMachineCapacity | null {
  if (!value || typeof value !== 'object') return null
  const profile = value as { totalMemoryGB?: unknown; vramGB?: unknown }
  const ramGB =
    typeof profile.totalMemoryGB === 'number' &&
    Number.isFinite(profile.totalMemoryGB) &&
    profile.totalMemoryGB > 0
      ? profile.totalMemoryGB
      : undefined
  const vramGB =
    typeof profile.vramGB === 'number' &&
    Number.isFinite(profile.vramGB) &&
    profile.vramGB > 0
      ? profile.vramGB
      : undefined
  return ramGB || vramGB ? { ramGB, vramGB } : null
}

/** Reads only the persisted profile; never triggers hardware scans during chat. */
export function getChatMachineCapacity(): Promise<ChatMachineCapacity | null> {
  if (Date.now() - cachedAt < CACHE_MS && cachedAt > 0) {
    return Promise.resolve(cachedCapacity)
  }
  if (pending) return pending
  pending = (async () => {
    try {
      const profile = await window.kawaii?.machineGetProfile?.()
      cachedCapacity = parseChatMachineCapacity(profile)
      cachedAt = Date.now()
      return cachedCapacity
    } catch {
      cachedCapacity = null
      cachedAt = Date.now()
      return null
    } finally {
      pending = null
    }
  })()
  return pending
}

export function resetChatMachineCapacityCache(): void {
  cachedAt = 0
  cachedCapacity = null
  pending = null
}
