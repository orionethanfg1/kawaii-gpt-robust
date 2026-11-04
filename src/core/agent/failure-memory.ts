/**
 * Harness failure memory — remember tool failures so plans don't repeat
 * the same failing action blindly within a cool-down window.
 *
 * E-FAILMEM: Forge family shares recovery — success on start_forge / health
 * clears stale dead-port noise (:7890) so it does not block a healthy :7860.
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

/** Tools that share Forge API state */
const FORGE_FAMILY = new Set([
  'health_forge',
  'start_forge',
  'stop_forge',
  'probe_forge',
  'check_faceid',
  'ensure_faceid'
])

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

/** Normalize error for grouping — strip volatile ports/URLs so :7890 ≠ permanent identity */
function normError(err?: string): string {
  return String(err || 'unknown')
    .toLowerCase()
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .replace(/\b12\.?0\.0\.1:\d{4,5}\b/gi, '[host]')
    .replace(/\blocalhost:\d{4,5}\b/gi, '[host]')
    .replace(/:\d{4,5}\b/g, ':[port]')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
}

function sanitizeSummaryForUser(summary?: string): string {
  return String(summary || '')
    .replace(/fetch failed\s*@\s*https?:\/\/[^\s)]+/gi, 'API no respondió')
    .replace(/https?:\/\/127\.0\.0\.1:7890[^\s)]*/gi, '')
    .replace(/https?:\/\/localhost:7890[^\s)]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

function isDeadPortNoise(summary?: string): boolean {
  const s = String(summary || '').toLowerCase()
  return (
    /:7890\b/.test(s) ||
    /fetch failed/.test(s) ||
    /api no responde/.test(s) ||
    /detenido/.test(s)
  )
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
      lastSummary: sanitizeSummaryForUser(summary)
    }
  } else {
    list.push({
      tool,
      errorKey,
      count: 1,
      lastFailAt: now,
      lastSummary: sanitizeSummaryForUser(summary)
    })
  }
  save(list)
}

/**
 * Mark success and drop cooldown for this tool.
 * For Forge family, clear related failures so a good start_forge unblocks health_forge.
 */
export function recordToolSuccess(tool: string): void {
  const list = load()
  const now = Date.now()
  let next: FailureEntry[]

  if (FORGE_FAMILY.has(tool)) {
    // Drop forge failures entirely on any forge success (esp. start_forge → 7860 after 7890 noise)
    next = list.filter((e) => !FORGE_FAMILY.has(e.tool))
  } else {
    next = list.map((e) =>
      e.tool === tool ? { ...e, lastOkAt: now, count: 0 } : e
    )
  }

  // Always stamp lastOkAt on a synthetic entry so shouldSkip sees recovery
  if (!FORGE_FAMILY.has(tool)) {
    const has = next.some((e) => e.tool === tool)
    if (!has) {
      next.push({
        tool,
        errorKey: 'ok',
        count: 0,
        lastFailAt: 0,
        lastOkAt: now
      })
    }
  } else {
    next.push({
      tool,
      errorKey: 'ok',
      count: 0,
      lastFailAt: 0,
      lastOkAt: now,
      lastSummary: 'ok'
    })
  }

  save(next.slice(-MAX_ENTRIES))
}

/** Explicit clear of Forge-related failure memory (e.g. after API detected on live port) */
export function clearForgeFailureMemory(): void {
  const list = load().filter((e) => !FORGE_FAMILY.has(e.tool))
  save(list)
}

export function shouldSkipTool(
  tool: string,
  opts?: { force?: boolean }
): {
  skip: boolean
  reason?: string
  entry?: FailureEntry
} {
  if (opts?.force) return { skip: false }

  // Explicit start must never be blocked by prior health_forge dead-port noise
  if (tool === 'start_forge' || tool === 'start_ollama' || tool === 'start_music') {
    return { skip: false }
  }

  const list = load()
  const now = Date.now()

  // If any related Forge tool succeeded recently, allow health/probe
  if (FORGE_FAMILY.has(tool)) {
    const forgeOk = list.some(
      (e) =>
        FORGE_FAMILY.has(e.tool) &&
        e.lastOkAt &&
        e.lastOkAt > e.lastFailAt &&
        now - e.lastOkAt < COOLDOWN_MS * 2
    )
    if (forgeOk) return { skip: false }
  }

  const recent = list
    .filter((e) => e.tool === tool && e.count > 0 && now - e.lastFailAt < COOLDOWN_MS)
    .sort((a, b) => b.lastFailAt - a.lastFailAt)[0]
  if (!recent) return { skip: false }

  // If succeeded after last fail, allow
  if (recent.lastOkAt && recent.lastOkAt > recent.lastFailAt) return { skip: false }

  // Dead-port noise: do not skip start-adjacent reads forever — only soft skip health once
  if (tool === 'health_forge' && isDeadPortNoise(recent.lastSummary || recent.errorKey)) {
    // Still skip repeat spam, but reason is clean (no :7890 URL)
    if (recent.count >= 2) {
      return {
        skip: true,
        reason:
          'Omitido: health_forge falló hace poco (API Forge no respondía). Si ya arrancaste Forge, ignora este aviso o di «revisa Forge».',
        entry: recent
      }
    }
    return { skip: false, entry: recent }
  }

  // After 2+ failures in cooldown, skip repeat
  if (recent.count >= 2) {
    const clean = sanitizeSummaryForUser(recent.lastSummary || recent.errorKey)
    return {
      skip: true,
      reason: `Omitido: ${tool} falló ${recent.count}× hace poco (${clean || 'error'}). Prueba diagnóstico o espera unos minutos.`,
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
    .filter((e) => e.count > 0 && now - e.lastFailAt < 15 * 60 * 1000)
    .sort((a, b) => b.lastFailAt - a.lastFailAt)
    .slice(0, 6)
  if (!hot.length) return ''
  return (
    '[MEMORIA_FALLOS_HARNESS] No repitas a ciegas estas acciones si acaban de fallar:\n' +
    hot
      .map((e) => {
        const sum = sanitizeSummaryForUser(e.lastSummary || e.errorKey)
        return (
          `- ${e.tool} ×${e.count}: ${sum}` +
          (e.lastOkAt && e.lastOkAt > e.lastFailAt ? ' (luego OK)' : '')
        )
      })
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
