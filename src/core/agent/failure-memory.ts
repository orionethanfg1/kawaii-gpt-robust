/**
 * Harness failure memory — remember tool failures so plans don't repeat
 * the same failing action blindly within a cool-down window.
 */

export type FailureEntry = {
  tool: string
  errorKey: string
  count: number
  lastFailAt: number
  lastOkAt?: number
  lastSummary?: string
}

const STORAGE_KEY = 'kawaii-gpt-harness-failures'
const MAX_ENTRIES = 40
/** Don't retry the exact same failing tool within this window unless forced */
const COOLDOWN_MS = 3 * 60 * 1000

function load(): FailureEntry[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as FailureEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function save(entries: FailureEntry[]) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    /* ignore quota */
  }
}

function normError(err?: string): string {
  return String(err || 'unknown')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 120)
}

export function recordToolFailure(tool: string, summary?: string): void {
  const errorKey = normError(summary)
  const now = Date.now()
  const list = load()
  const idx = list.findIndex((e) => e.tool === tool && e.errorKey === errorKey)
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      count: list[idx].count + 1,
      lastFailAt: now,
      lastSummary: summary?.slice(0, 200)
    }
  } else {
    list.push({
      tool,
      errorKey,
      count: 1,
      lastFailAt: now,
      lastSummary: summary?.slice(0, 200)
    })
  }
  save(list)
}

export function recordToolSuccess(tool: string): void {
  const list = load()
  let changed = false
  for (const e of list) {
    if (e.tool === tool) {
      e.lastOkAt = Date.now()
      changed = true
    }
  }
  if (changed) save(list)
}

export function shouldSkipTool(tool: string, opts?: { force?: boolean }): {
  skip: boolean
  reason?: string
  entry?: FailureEntry
} {
  if (opts?.force) return { skip: false }
  const list = load()
  const now = Date.now()
  const recent = list
    .filter((e) => e.tool === tool && now - e.lastFailAt < COOLDOWN_MS)
    .sort((a, b) => b.lastFailAt - a.lastFailAt)[0]
  if (!recent) return { skip: false }
  // If succeeded after last fail, allow
  if (recent.lastOkAt && recent.lastOkAt > recent.lastFailAt) return { skip: false }
  // After 2+ failures in cooldown, skip repeat
  if (recent.count >= 2) {
    return {
      skip: true,
      reason: `Omitido: ${tool} falló ${recent.count}× hace poco (${recent.lastSummary || recent.errorKey}). Prueba diagnóstico o espera unos minutos.`,
      entry: recent
    }
  }
  return { skip: false, entry: recent }
}

/** Compact block for system prompt / observation */
export function formatFailureMemoryForPrompt(): string {
  const list = load()
  const now = Date.now()
  const hot = list
    .filter((e) => now - e.lastFailAt < 15 * 60 * 1000)
    .sort((a, b) => b.lastFailAt - a.lastFailAt)
    .slice(0, 6)
  if (!hot.length) return ''
  return (
    '[MEMORIA_FALLOS_HARNESS] No repitas a ciegas estas acciones si acaban de fallar:\n' +
    hot
      .map(
        (e) =>
          `- ${e.tool} ×${e.count}: ${e.lastSummary || e.errorKey}` +
          (e.lastOkAt && e.lastOkAt > e.lastFailAt ? ' (luego OK)' : '')
      )
      .join('\n')
  )
}

export function clearFailureMemory(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
