/**
 * After the user is idle, free RAM/VRAM: unload large Ollama models and stop residual Forge.
 * Does not touch LM Studio (no public unload API).
 */
import { useChatStore } from '@shared/lib/stores/chatStore'

const DEFAULT_IDLE_MS = 4 * 60 * 1000 // 4 min without chat activity
const SCAN_MS = 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null
let running = false
let lastReleaseAt = 0

function lastChatActivityMs(): number {
  try {
    const convs = useChatStore.getState().conversations || []
    let max = 0
    for (const c of convs) {
      const t = Number(c.updatedAt) || 0
      if (t > max) max = t
    }
    return max
  } catch {
    return Date.now()
  }
}

async function maybeRelease(): Promise<void> {
  const last = lastChatActivityMs()
  const idleFor = Date.now() - last
  if (idleFor < DEFAULT_IDLE_MS) return
  if (Date.now() - lastReleaseAt < DEFAULT_IDLE_MS) return
  lastReleaseAt = Date.now()
  try {
    const k = (window as any).kawaii
    if (!k) return
    // Stop Forge if it was left running (no sticky image job assumed after idle)
    try {
      await k.forgeStop?.()
    } catch {
      /* */
    }
    // Unload large Ollama residents only
    try {
      await k.unloadLocalModels?.({ unloadAll: false, minSizeGB: 8 })
    } catch {
      /* */
    }
  } catch {
    /* ignore */
  }
}

export function startIdleResourceRelease(): () => void {
  if (timer) return stopIdleResourceRelease
  running = true
  timer = setInterval(() => {
    if (!running) return
    void maybeRelease()
  }, SCAN_MS)
  setTimeout(() => {
    if (running) void maybeRelease()
  }, Math.min(DEFAULT_IDLE_MS, 15_000))
  return stopIdleResourceRelease
}

export function stopIdleResourceRelease(): void {
  running = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
