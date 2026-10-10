import { describe, it, expect, beforeEach } from 'vitest'
import {
  listAppDataKeys,
  pruneAppDiagnostics,
  smartCleanupDiagnostics,
  clearAllKawaiiLocalData,
  isObsoleteDiagnosticsKey,
  isProtectedKey
} from './data-cleanup'

function mockStorage(initial: Record<string, string> = {}) {
  const store = { ...initial }
  const ls = {
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
  // @ts-expect-error test mock
  globalThis.localStorage = ls
  return store
}

describe('data-cleanup', () => {
  beforeEach(() => {
    mockStorage({
      'kawaii-gpt-harness-failures': '[]',
      'kawaii-gpt-system-test-history-v1': '[]',
      'kawaii_test_runs_v1': '[]',
      'kawaii-gpt-settings-v1': '{"ok":true}',
      'kawaii-gpt-character': '{}'
    })
  })

  it('classifies obsolete vs protected keys', () => {
    expect(isObsoleteDiagnosticsKey('kawaii-gpt-system-test-history-v1')).toBe(true)
    expect(isObsoleteDiagnosticsKey('kawaii_test_runs_v1')).toBe(true)
    expect(isObsoleteDiagnosticsKey('kawaii-gpt-harness-failures')).toBe(true)
    expect(isProtectedKey('kawaii-gpt-settings-v1')).toBe(true)
    expect(isObsoleteDiagnosticsKey('kawaii-gpt-settings-v1')).toBe(false)
  })

  it('smart mode clears tests and logs but keeps settings', () => {
    const r = smartCleanupDiagnostics()
    expect(r.ok).toBe(true)
    expect(r.mode).toBe('smart')
    expect(r.cleared).toEqual(
      expect.arrayContaining([
        'kawaii-gpt-harness-failures',
        'kawaii-gpt-system-test-history-v1',
        'kawaii_test_runs_v1'
      ])
    )
    expect(localStorage.getItem('kawaii-gpt-settings-v1')).toBeTruthy()
    expect(localStorage.getItem('kawaii-gpt-character')).toBeTruthy()
    expect(localStorage.getItem('kawaii_test_runs_v1')).toBeNull()
  })

  it('soft prune can clear only failures', () => {
    const r = pruneAppDiagnostics({
      clearFailures: true,
      clearTestHistory: false
    })
    expect(r.cleared).toContain('kawaii-gpt-harness-failures')
    expect(localStorage.getItem('kawaii-gpt-system-test-history-v1')).toBeTruthy()
  })

  it('clear all removes every kawaii key', () => {
    const r = clearAllKawaiiLocalData()
    expect(r.cleared.length).toBeGreaterThanOrEqual(4)
    expect(listAppDataKeys()).toEqual([])
  })
})
