/**
 * On-device route / model telemetry — privacy-first learning for KawaiiGPT.
 *
 * Design goals (max value without cloud analytics):
 * 1. Never store prompt text — only task bucket + model id + latency + outcome.
 * 2. EWMA latency + success rate per (task, model, target).
 * 3. Soft bias for decideRoute + scoreModelForTask after enough samples.
 * 4. Host-owned; harness can read snapshot; smart cleanup can prune.
 *
 * Inspired by local memory routers: after ~20–50 turns, historical signal
 * dominates generic benchmarks for *this* machine and user.
 */

import type { ChatTask } from '../routing/task-route'
import type { RouteTarget } from '../routing/types'

const STORAGE_KEY = 'kawaii-gpt-route-telemetry-v1'
const MAX_EVENTS = 200
const MAX_BUCKETS = 80
/** Minimum samples before applying soft bias */
export const TELEMETRY_MIN_SAMPLES = 4
const EWMA_ALPHA = 0.25

export type TelemetryTarget = 'local' | 'cloud' | 'web'

export type RouteTelemetryEvent = {
  ts: number
  task: ChatTask | 'unknown'
  target: TelemetryTarget
  model: string
  latencyMs: number
  ok: boolean
  /** Optional runtime hint */
  runtime?: 'ollama' | 'openai-compatible' | 'cloud' | 'unknown'
  /** Truncated error class, never full stack */
  errorClass?: string
}

export type TelemetryBucket = {
  key: string
  task: string
  target: TelemetryTarget
  model: string
  n: number
  success: number
  /** EWMA latency (ms) */
  ewmaLatencyMs: number
  lastAt: number
}

export type RouteTelemetrySnapshot = {
  events: number
  buckets: TelemetryBucket[]
  /** Soft recommendations derived from data */
  preferLocalBias: number
  slowLocalModels: string[]
  fastLocalModels: string[]
  updatedAt: number
}

function loadRaw(): { events: RouteTelemetryEvent[]; buckets: TelemetryBucket[] } {
  try {
    if (typeof localStorage === 'undefined') return { events: [], buckets: [] }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { events: [], buckets: [] }
    const p = JSON.parse(raw) as {
      events?: RouteTelemetryEvent[]
      buckets?: TelemetryBucket[]
    }
    return {
      events: Array.isArray(p.events) ? p.events : [],
      buckets: Array.isArray(p.buckets) ? p.buckets : []
    }
  } catch {
    return { events: [], buckets: [] }
  }
}

function saveRaw(data: { events: RouteTelemetryEvent[]; buckets: TelemetryBucket[] }): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        events: data.events.slice(-MAX_EVENTS),
        buckets: data.buckets.slice(0, MAX_BUCKETS)
      })
    )
  } catch {
    /* quota */
  }
}

function bucketKey(task: string, target: TelemetryTarget, model: string): string {
  return `${task}|${target}|${(model || '').toLowerCase().slice(0, 80)}`
}

function normalizeTarget(t: string): TelemetryTarget {
  if (t === 'local') return 'local'
  if (t.includes('web')) return 'web'
  return 'cloud'
}

/**
 * Record one completed (or failed) inference turn.
 * Call from orchestrator onDone / onError — never pass user text.
 */
export function recordRouteOutcome(input: {
  task?: ChatTask | string
  target: RouteTarget | string
  model: string
  latencyMs: number
  ok: boolean
  runtime?: RouteTelemetryEvent['runtime']
  errorClass?: string
}): void {
  const task = (input.task || 'unknown') as ChatTask | 'unknown'
  const target = normalizeTarget(String(input.target || 'local'))
  const model = (input.model || 'unknown').trim().slice(0, 120)
  const latencyMs = Math.max(0, Math.round(Number(input.latencyMs) || 0))
  const event: RouteTelemetryEvent = {
    ts: Date.now(),
    task,
    target,
    model,
    latencyMs,
    ok: Boolean(input.ok),
    runtime: input.runtime,
    errorClass: input.errorClass?.slice(0, 80)
  }

  const data = loadRaw()
  data.events.push(event)
  if (data.events.length > MAX_EVENTS) {
    data.events = data.events.slice(-MAX_EVENTS)
  }

  const key = bucketKey(String(task), target, model)
  let b = data.buckets.find((x) => x.key === key)
  if (!b) {
    b = {
      key,
      task: String(task),
      target,
      model,
      n: 0,
      success: 0,
      ewmaLatencyMs: latencyMs,
      lastAt: event.ts
    }
    data.buckets.unshift(b)
  }
  b.n += 1
  if (event.ok) b.success += 1
  b.ewmaLatencyMs =
    b.n === 1 ? latencyMs : EWMA_ALPHA * latencyMs + (1 - EWMA_ALPHA) * b.ewmaLatencyMs
  b.lastAt = event.ts

  data.buckets.sort((a, c) => c.lastAt - a.lastAt)
  if (data.buckets.length > MAX_BUCKETS) data.buckets = data.buckets.slice(0, MAX_BUCKETS)
  saveRaw(data)
}

export function getTelemetryBuckets(): TelemetryBucket[] {
  return loadRaw().buckets
}

export function getRecentEvents(limit = 20): RouteTelemetryEvent[] {
  return loadRaw().events.slice(-limit)
}

/** Success rate 0–1 for bucket; null if insufficient data */
export function successRate(b: TelemetryBucket): number | null {
  if (b.n < TELEMETRY_MIN_SAMPLES) return null
  return b.success / b.n
}

/**
 * Additive score bias for model selection (-6 … +6).
 * Fast + reliable local models for the task get positive bias.
 */
export function telemetryModelBias(modelId: string, task: ChatTask): number {
  const id = modelId.toLowerCase()
  const buckets = loadRaw().buckets.filter(
    (b) =>
      b.target === 'local' &&
      b.task === task &&
      (b.model.toLowerCase() === id ||
        b.model.toLowerCase().includes(id) ||
        id.includes(b.model.toLowerCase().split(':')[0]))
  )
  if (!buckets.length) return 0
  // Prefer the most-sampled matching bucket
  const b = [...buckets].sort((a, c) => c.n - a.n)[0]
  if (b.n < TELEMETRY_MIN_SAMPLES) return 0

  const rate = b.success / b.n
  let bias = 0
  // Reliability
  if (rate >= 0.9) bias += 2
  else if (rate >= 0.75) bias += 1
  else if (rate < 0.5) bias -= 3
  else if (rate < 0.65) bias -= 1

  // Latency (local chat: <8s good, >45s painful on 27B)
  if (b.ewmaLatencyMs > 0) {
    if (b.ewmaLatencyMs < 8_000) bias += 2
    else if (b.ewmaLatencyMs < 20_000) bias += 1
    else if (b.ewmaLatencyMs > 60_000) bias -= 3
    else if (b.ewmaLatencyMs > 40_000) bias -= 2
    else if (b.ewmaLatencyMs > 25_000) bias -= 1
  }
  return Math.max(-6, Math.min(6, bias))
}

/**
 * How hard to prefer local in smart mode: 0 = neutral, 1 = strong local, -1 = lean cloud.
 * Based on aggregate local vs cloud outcomes on this machine.
 */
export function telemetryPreferLocalBias(): number {
  const buckets = loadRaw().buckets
  const local = buckets.filter((b) => b.target === 'local' && b.n >= TELEMETRY_MIN_SAMPLES)
  const cloud = buckets.filter((b) => b.target === 'cloud' && b.n >= TELEMETRY_MIN_SAMPLES)
  if (!local.length && !cloud.length) return 0

  const avgRate = (list: TelemetryBucket[]) => {
    if (!list.length) return null
    const n = list.reduce((s, b) => s + b.n, 0)
    const ok = list.reduce((s, b) => s + b.success, 0)
    return n ? ok / n : null
  }
  const avgLat = (list: TelemetryBucket[]) => {
    if (!list.length) return null
    const n = list.reduce((s, b) => s + b.n, 0)
    const w = list.reduce((s, b) => s + b.ewmaLatencyMs * b.n, 0)
    return n ? w / n : null
  }

  const lr = avgRate(local)
  const cr = avgRate(cloud)
  const ll = avgLat(local)
  let bias = 0.15 // product default: mild local-first
  if (lr != null && lr >= 0.85) bias += 0.25
  if (lr != null && lr < 0.55) bias -= 0.35
  if (ll != null && ll > 50_000) bias -= 0.3
  if (ll != null && ll < 12_000) bias += 0.15
  if (cr != null && cr > 0.9 && lr != null && lr < 0.7) bias -= 0.2
  return Math.max(-1, Math.min(1, bias))
}

/** Models that are consistently slow on this machine (local) */
export function getSlowLocalModels(thresholdMs = 45_000): string[] {
  return loadRaw()
    .buckets.filter(
      (b) =>
        b.target === 'local' &&
        b.n >= TELEMETRY_MIN_SAMPLES &&
        b.ewmaLatencyMs >= thresholdMs
    )
    .map((b) => b.model)
}

export function getFastLocalModels(thresholdMs = 15_000): string[] {
  return loadRaw()
    .buckets.filter(
      (b) =>
        b.target === 'local' &&
        b.n >= TELEMETRY_MIN_SAMPLES &&
        b.ewmaLatencyMs > 0 &&
        b.ewmaLatencyMs <= thresholdMs &&
        b.success / b.n >= 0.7
    )
    .sort((a, c) => a.ewmaLatencyMs - c.ewmaLatencyMs)
    .map((b) => b.model)
}

export function buildTelemetrySnapshot(): RouteTelemetrySnapshot {
  const buckets = getTelemetryBuckets()
  return {
    events: loadRaw().events.length,
    buckets,
    preferLocalBias: telemetryPreferLocalBias(),
    slowLocalModels: getSlowLocalModels(),
    fastLocalModels: getFastLocalModels(),
    updatedAt: Date.now()
  }
}

/** Compact lines for harness / system prompt (no PII) */
export function formatTelemetryForPrompt(limit = 6): string {
  const snap = buildTelemetrySnapshot()
  if (!snap.buckets.length) return ''
  const top = [...snap.buckets]
    .filter((b) => b.n >= 2)
    .sort((a, c) => c.n - a.n)
    .slice(0, limit)
  if (!top.length) return ''
  const lines = top.map((b) => {
    const rate = ((b.success / b.n) * 100).toFixed(0)
    const sec = (b.ewmaLatencyMs / 1000).toFixed(1)
    return `- ${b.task}/${b.target}/${b.model}: n=${b.n} ok=${rate}% ~${sec}s`
  })
  return (
    `[TELEMETRIA_LOCAL] Sesgo preferLocal=${snap.preferLocalBias.toFixed(2)} ` +
    `(solo esta máquina, sin texto de usuario):\n` +
    lines.join('\n')
  )
}

export function clearRouteTelemetry(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** For unit tests: inject buckets without localStorage quirks */
export function __testResetTelemetry(data?: {
  events?: RouteTelemetryEvent[]
  buckets?: TelemetryBucket[]
}): void {
  if (!data) {
    clearRouteTelemetry()
    return
  }
  saveRaw({
    events: data.events || [],
    buckets: data.buckets || []
  })
}
