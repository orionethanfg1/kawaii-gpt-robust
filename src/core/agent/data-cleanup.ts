/**
 * Prune stale localStorage diagnostics / harness / feedback noise.
 * Host-owned; harness can call clear_app_logs.
 */

const KNOWN_KEYS = [
  'kawaii-gpt-harness-failures',
  'kawaii-gpt-harness-success',
  'kawaii-gpt-feedback-v1',
  'kawaii-gpt-feedback-archives-v1',
  'kawaii-gpt-system-test-history-v1',
  'kawaii-gpt-system-test-last-v1'
] as const

export type CleanupResult = {
  ok: boolean
  cleared: string[]
  kept: string[]
  detail: string
}

export function listAppDataKeys(): string[] {
  if (typeof localStorage === 'undefined') return []
  const out: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('kawaii-gpt')) out.push(k)
  }
  return out.sort()
}

/** Soft prune: failure memory older entries, trim feedback archives */
export function pruneAppDiagnostics(opts?: {
  clearFailures?: boolean
  clearSuccess?: boolean
  clearFeedbackActive?: boolean
  clearFeedbackArchives?: boolean
  clearTestHistory?: boolean
}): CleanupResult {
  if (typeof localStorage === 'undefined') {
    return { ok: false, cleared: [], kept: [], detail: 'no localStorage' }
  }
  const cleared: string[] = []
  const kept: string[] = []
  const o = {
    clearFailures: true,
    clearSuccess: false,
    clearFeedbackActive: false,
    clearFeedbackArchives: false,
    clearTestHistory: false,
    ...opts
  }

  const maybe = (key: string, doClear: boolean) => {
    if (!localStorage.getItem(key)) {
      kept.push(key + ' (absent)')
      return
    }
    if (doClear) {
      localStorage.removeItem(key)
      cleared.push(key)
    } else kept.push(key)
  }

  maybe('kawaii-gpt-harness-failures', o.clearFailures)
  maybe('kawaii-gpt-harness-success', o.clearSuccess)
  maybe('kawaii-gpt-feedback-v1', o.clearFeedbackActive)
  maybe('kawaii-gpt-feedback-archives-v1', o.clearFeedbackArchives)
  maybe('kawaii-gpt-system-test-history-v1', o.clearTestHistory)
  maybe('kawaii-gpt-system-test-last-v1', o.clearTestHistory)

  return {
    ok: true,
    cleared,
    kept,
    detail: `cleared=${cleared.length} kept=${kept.length}`
  }
}

export function clearAllKawaiiLocalData(): CleanupResult {
  if (typeof localStorage === 'undefined') {
    return { ok: false, cleared: [], kept: [], detail: 'no localStorage' }
  }
  const cleared: string[] = []
  for (const k of listAppDataKeys()) {
    localStorage.removeItem(k)
    cleared.push(k)
  }
  return { ok: true, cleared, kept: [], detail: `removed ${cleared.length} keys` }
}
