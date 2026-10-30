/**
 * Prune stale localStorage diagnostics / harness / feedback / test noise.
 * Host-owned; harness can call clear_app_logs with mode soft|hard|smart|all|tests.
 */

const KNOWN_KEYS = [
  'kawaii-gpt-harness-failures',
  'kawaii-gpt-harness-success',
  'kawaii-gpt-feedback-v1',
  'kawaii-gpt-feedback-archives-v1',
  'kawaii-gpt-system-test-history-v1',
  'kawaii-gpt-system-test-last-v1',
  'kawaii_test_runs_v1'
] as const

/** Patterns that smart mode treats as disposable diagnostics/tests/logs */
const OBSOLETE_KEY_PATTERNS: RegExp[] = [
  /^kawaii-gpt-harness-failures/,
  /^kawaii-gpt-system-test/,
  /^kawaii_test_runs/,
  /^kawaii-gpt-feedback-archives/,
  /test-history/i,
  /test-last/i,
  /-log(s)?$/i,
  /diagnostics/i,
  /obsolete/i,
  /\.tmp$/i
]

/** Keys smart mode never touches (settings / identity) */
const PROTECTED_SUBSTRINGS = [
  'settings',
  'character',
  'conversation',
  'chat-store',
  'api-key',
  'provider-key',
  'machine-profile',
  'kawaii-character',
  'settings-backup'
]

export type CleanupResult = {
  ok: boolean
  cleared: string[]
  kept: string[]
  detail: string
  mode?: string
}

export function listAppDataKeys(): string[] {
  if (typeof localStorage === 'undefined') return []
  const out: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && (k.startsWith('kawaii') || k.startsWith('kawaii-gpt') || k.startsWith('kawaii_'))) {
      out.push(k)
    }
  }
  return out.sort()
}

export function isProtectedKey(key: string): boolean {
  const k = key.toLowerCase()
  return PROTECTED_SUBSTRINGS.some((p) => k.includes(p))
}

export function isObsoleteDiagnosticsKey(key: string): boolean {
  if (isProtectedKey(key)) return false
  return OBSOLETE_KEY_PATTERNS.some((re) => re.test(key))
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
    return { ok: false, cleared: [], kept: [], detail: 'no localStorage', mode: 'soft' }
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
  maybe('kawaii_test_runs_v1', o.clearTestHistory)

  return {
    ok: true,
    cleared,
    kept,
    detail: `cleared=${cleared.length} kept=${kept.length}`,
    mode: 'soft'
  }
}

/**
 * Smart cleanup: remove obsolete test history, harness failure logs, and
 * diagnostic keys matching patterns — never touch settings/character/chats.
 */
export function smartCleanupDiagnostics(): CleanupResult {
  if (typeof localStorage === 'undefined') {
    return { ok: false, cleared: [], kept: [], detail: 'no localStorage', mode: 'smart' }
  }
  const cleared: string[] = []
  const kept: string[] = []
  for (const key of listAppDataKeys()) {
    if (isObsoleteDiagnosticsKey(key)) {
      localStorage.removeItem(key)
      cleared.push(key)
    } else {
      kept.push(key)
    }
  }
  // Always ensure known test keys are gone even if list missed them
  for (const k of [
    'kawaii-gpt-system-test-history-v1',
    'kawaii-gpt-system-test-last-v1',
    'kawaii_test_runs_v1',
    'kawaii-gpt-harness-failures'
  ]) {
    if (localStorage.getItem(k) != null && !cleared.includes(k)) {
      localStorage.removeItem(k)
      cleared.push(k)
    }
  }
  return {
    ok: true,
    cleared: [...new Set(cleared)],
    kept,
    detail: `smart: removed ${cleared.length} obsolete log/test key(s), kept ${kept.length}`,
    mode: 'smart'
  }
}

export function clearAllKawaiiLocalData(): CleanupResult {
  if (typeof localStorage === 'undefined') {
    return { ok: false, cleared: [], kept: [], detail: 'no localStorage', mode: 'all' }
  }
  const cleared: string[] = []
  for (const k of listAppDataKeys()) {
    localStorage.removeItem(k)
    cleared.push(k)
  }
  return {
    ok: true,
    cleared,
    kept: [],
    detail: `removed ${cleared.length} keys`,
    mode: 'all'
  }
}

export { KNOWN_KEYS }
