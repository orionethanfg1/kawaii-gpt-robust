import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordRouteOutcome,
  telemetryModelBias,
  telemetryPreferLocalBias,
  buildTelemetrySnapshot,
  formatTelemetryForPrompt,
  __testResetTelemetry,
  TELEMETRY_MIN_SAMPLES
} from './route-telemetry'

function mockStorage() {
  const store: Record<string, string> = {}
  // @ts-expect-error test
  globalThis.localStorage = {
    get length() {
      return Object.keys(store).length
    },
    key(i: number) {
      return Object.keys(store)[i] ?? null
    },
    getItem(k: string) {
      return store[k] ?? null
    },
    setItem(k: string, v: string) {
      store[k] = v
    },
    removeItem(k: string) {
      delete store[k]
    },
    clear() {
      for (const k of Object.keys(store)) delete store[k]
    }
  }
}

describe('route-telemetry', () => {
  beforeEach(() => {
    mockStorage()
    __testResetTelemetry()
  })

  it('records outcomes and builds buckets', () => {
    for (let i = 0; i < TELEMETRY_MIN_SAMPLES; i++) {
      recordRouteOutcome({
        task: 'chat',
        target: 'local',
        model: 'qwen2.5:7b',
        latencyMs: 5000 + i * 100,
        ok: true
      })
    }
    const snap = buildTelemetrySnapshot()
    expect(snap.events).toBe(TELEMETRY_MIN_SAMPLES)
    expect(snap.buckets[0].model).toBe('qwen2.5:7b')
    expect(snap.buckets[0].success).toBe(TELEMETRY_MIN_SAMPLES)
    expect(telemetryModelBias('qwen2.5:7b', 'chat')).toBeGreaterThan(0)
  })

  it('penalizes slow failing models', () => {
    for (let i = 0; i < TELEMETRY_MIN_SAMPLES; i++) {
      recordRouteOutcome({
        task: 'chat',
        target: 'local',
        model: 'qwen/qwen3.8-27b',
        latencyMs: 70_000,
        ok: i === 0 // mostly fail
      })
    }
    expect(telemetryModelBias('qwen/qwen3.8-27b', 'chat')).toBeLessThan(0)
  })

  it('preferLocal bias drops when local is slow/unreliable', () => {
    for (let i = 0; i < TELEMETRY_MIN_SAMPLES; i++) {
      recordRouteOutcome({
        task: 'chat',
        target: 'local',
        model: 'heavy',
        latencyMs: 80_000,
        ok: false
      })
      recordRouteOutcome({
        task: 'chat',
        target: 'cloud',
        model: 'gpt',
        latencyMs: 2000,
        ok: true
      })
    }
    expect(telemetryPreferLocalBias()).toBeLessThan(0.15)
  })

  it('formatTelemetryForPrompt never includes free text prompts', () => {
    recordRouteOutcome({
      task: 'code',
      target: 'local',
      model: 'coder',
      latencyMs: 3000,
      ok: true
    })
    const s = formatTelemetryForPrompt()
    expect(s).not.toMatch(/password|secret|usuario dijo/i)
    expect(s).toMatch(/TELEMETRIA_LOCAL|coder|code/)
  })
})
