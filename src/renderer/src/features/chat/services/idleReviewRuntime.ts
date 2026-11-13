/**
 * X9 — Idle review runtime (outside chat turn orchestrator).
 * Runs deterministic memory harvest / consistency when UI is quiet.
 */
import { planIdleReview, IDLE_REVIEW_DEFAULTS, type IdleReviewKind } from '@core/agent/idle-review'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { isChatBusy } from './chatBusy'

let timer: ReturnType<typeof setInterval> | null = null
let lastActivityAt = Date.now()
let lastReviewAt = 0
let lastKind: IdleReviewKind | undefined
let running = false
let streamBusy = false

export function setIdleReviewStreamBusy(busy: boolean): void {
  streamBusy = busy
  if (!busy) lastActivityAt = Date.now()
}

export function touchIdleReviewActivity(): void {
  lastActivityAt = Date.now()
}

async function runHarvest(): Promise<boolean> {
  // Transcript-wide harvesting is paused until candidates have provenance and review.
  return false
}

async function runConsistency(): Promise<boolean> {
  const { runMemoryConsistencyPass } = await import('@core/conversation/memory-consistency')
  const active = useChatStore.getState().conversations.find(
    (c) => c.id === useChatStore.getState().activeId
  )
  const messages = (active?.messages || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-40)
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : ''
    }))
  if (messages.length < 4) return false
  const st = useSettingsStore.getState().settings
  const report = runMemoryConsistencyPass({
    messages,
    assistantMemory: st.assistantMemory,
    userMemory: st.userMemory
  })
  console.info('[idle-review] memory consistency preview', {
    assistantCandidates: report.assistantAdded.length,
    userCandidates: report.userAdded.length,
    favoritesFound: report.favoritesFound.length
  })
  return false
}

async function tick(): Promise<void> {
  if (running) return
  const plan = planIdleReview({
    idleMs: Date.now() - lastActivityAt,
    streamBusy,
    chatBusy: isChatBusy(),
    sinceLastReviewMs: lastReviewAt ? Date.now() - lastReviewAt : 1e12,
    lastKind
  })
  if (plan.kind === 'none') return
  running = true
  try {
    let did = false
    if (plan.kind === 'memory_harvest') did = await runHarvest()
    else if (plan.kind === 'memory_consistency') did = await runConsistency()
    lastKind = plan.kind
    // Always advance cooldown so we don't spin on empty passes
    lastReviewAt = Date.now()
    if (did) {
      try {
        console.info('[idle-review] done', plan.kind, plan.reason)
      } catch {
        /* */
      }
    }
  } catch (e) {
    try {
      console.warn('[idle-review] error', e)
    } catch {
      /* */
    }
    lastReviewAt = Date.now()
  } finally {
    running = false
  }
}

export function startIdleReviewRuntime(opts?: {
  scanIntervalMs?: number
}): () => void {
  stopIdleReviewRuntime()
  lastActivityAt = Date.now()
  const interval = opts?.scanIntervalMs ?? IDLE_REVIEW_DEFAULTS.scanIntervalMs
  timer = setInterval(() => {
    void tick()
  }, interval)

  const onActivity = () => {
    lastActivityAt = Date.now()
  }
  const onStreamDone = () => {
    lastActivityAt = Date.now()
    streamBusy = false
  }
  try {
    window.addEventListener('pointerdown', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity, { passive: true })
    window.addEventListener('kawaii:assistant-stream-done', onStreamDone)
  } catch {
    /* */
  }

  return () => {
    stopIdleReviewRuntime()
    try {
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('kawaii:assistant-stream-done', onStreamDone)
    } catch {
      /* */
    }
  }
}

export function stopIdleReviewRuntime(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
