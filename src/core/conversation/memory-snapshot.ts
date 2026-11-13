export type MemorySnapshotInput = {
  createdAt?: number
  appVersion: string
  sources: Record<string, unknown>
}

export type MemorySnapshot = {
  schemaVersion: 1
  createdAt: number
  appVersion: string
  sources: Record<string, unknown>
  sha256?: string
}

export type SnapshotIssue = {
  kind: 'duplicate' | 'contradiction' | 'unknown-origin' | 'sparse' | 'other'
  source: string
  path: string
  detail: string
  severity: 'info' | 'warn'
}

export type SnapshotAnalysis = {
  issues: SnapshotIssue[]
  counts: Record<string, number>
  hasDuplicates: boolean
  hasContradictions: boolean
}

export type ImportChange = {
  source: string
  action: 'replace' | 'skip'
  detail: string
}

export type ImportPreview = {
  ok: boolean
  reason?: string
  proposedSources: Record<string, unknown>
  changes: ImportChange[]
}

export async function createMemorySnapshot(input: MemorySnapshotInput): Promise<MemorySnapshot> {
  const snapshot: MemorySnapshot = {
    schemaVersion: 1,
    createdAt: input.createdAt ?? Date.now(),
    appVersion: input.appVersion,
    sources: structuredClone(input.sources) // deep copy, never mutate caller
  }
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    snapshot.sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')
  }
  return snapshot
}

/** Pure analysis: report issues without modifying snapshot or sources. */
export function analyzeMemorySnapshot(snapshot: MemorySnapshot): SnapshotAnalysis {
  const issues: SnapshotIssue[] = []
  const counts: Record<string, number> = {}

  for (const [key, value] of Object.entries(snapshot.sources || {})) {
    counts[key] = countLeaves(value)
    if (value == null) {
      issues.push({
        kind: 'unknown-origin',
        source: key,
        path: key,
        detail: 'Source is null or missing',
        severity: 'info'
      })
      continue
    }
    // Simple duplicate detection on arrays of strings or objects with text
    if (Array.isArray(value)) {
      const seen = new Set<string>()
      value.forEach((item, idx) => {
        const sig = typeof item === 'string' ? item : JSON.stringify(item)
        if (seen.has(sig)) {
          issues.push({
            kind: 'duplicate',
            source: key,
            path: `${key}[${idx}]`,
            detail: 'Exact duplicate entry',
            severity: 'warn'
          })
        } else {
          seen.add(sig)
        }
      })
    }
    // Heuristic: look for common memory arrays
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      for (const arrKey of ['likes', 'dislikes', 'facts', 'factEntries', 'goals', 'people', 'emotionalNotes']) {
        if (Array.isArray(obj[arrKey])) {
          const arr = obj[arrKey] as unknown[]
          const seen = new Set<string>()
          arr.forEach((item, idx) => {
            const sig = typeof item === 'string' ? item.trim().toLowerCase() : JSON.stringify(item)
            if (sig && seen.has(sig)) {
              issues.push({
                kind: 'duplicate',
                source: key,
                path: `${key}.${arrKey}[${idx}]`,
                detail: `Duplicate in ${arrKey}`,
                severity: 'warn'
              })
            } else if (sig) {
              seen.add(sig)
            }
          })
        }
      }
    }
  }

  return {
    issues,
    counts,
    hasDuplicates: issues.some((i) => i.kind === 'duplicate'),
    hasContradictions: issues.some((i) => i.kind === 'contradiction')
  }
}

/** Verify a snapshot can be re-imported: hash matches and structure is intact. Pure, no mutation. */
export async function verifyMemorySnapshot(snapshot: MemorySnapshot): Promise<{ ok: boolean; reason?: string }> {
  if (snapshot.schemaVersion !== 1) return { ok: false, reason: 'unsupported schema' }
  if (!snapshot.sources || typeof snapshot.sources !== 'object') return { ok: false, reason: 'missing sources' }
  if (snapshot.sha256) {
    const { sha256, ...rest } = snapshot
    const bytes = new TextEncoder().encode(JSON.stringify(rest))
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const computed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
      if (computed !== sha256) return { ok: false, reason: 'hash mismatch' }
    }
  }
  return { ok: true }
}

/**
 * Pure preview of importing a snapshot over current sources.
 * Never mutates inputs. Returns proposed sources only after verification.
 * Caller decides whether to apply the proposedSources.
 */
export async function previewMemoryImport(
  currentSources: Record<string, unknown>,
  snapshot: MemorySnapshot
): Promise<ImportPreview> {
  const verify = await verifyMemorySnapshot(snapshot)
  if (!verify.ok) {
    return {
      ok: false,
      reason: verify.reason,
      proposedSources: structuredClone(currentSources),
      changes: []
    }
  }

  const proposed = structuredClone(currentSources)
  const changes: ImportChange[] = []

  for (const [key, snapValue] of Object.entries(snapshot.sources || {})) {
    const currentValue = proposed[key]
    if (JSON.stringify(currentValue) === JSON.stringify(snapValue)) {
      changes.push({ source: key, action: 'skip', detail: 'identical' })
      continue
    }
    proposed[key] = structuredClone(snapValue)
    changes.push({ source: key, action: 'replace', detail: 'replaced with snapshot value' })
  }

  return { ok: true, proposedSources: proposed, changes }
}

function countLeaves(v: unknown): number {
  if (v == null || typeof v !== 'object') return 1
  if (Array.isArray(v)) return v.reduce((n, x) => n + countLeaves(x), 0)
  return Object.values(v).reduce((n, x) => n + countLeaves(x), 0)
}
