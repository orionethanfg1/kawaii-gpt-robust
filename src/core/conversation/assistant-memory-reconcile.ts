/**
 * B3 — Pure reconciliation for assistant memory.
 * No store / no React — safe to unit-test.
 */

import {
  type AssistantMemory,
  type AssistantExtracted,
  emptyAssistantMemory,
  isAssistantMemoryEmpty,
  partitionAssistantLikes,
  classifyAssistantLikePhrase
} from './assistant-memory'

/** Schema version written on every successful persist */
export const ASSISTANT_MEMORY_VERSION = 1

export type MemoryOpKind = 'noop' | 'add' | 'update' | 'remove' | 'reject'

export type MemoryOp = {
  kind: MemoryOpKind
  field: keyof AssistantMemory
  value?: string
  previous?: string
  reason?: string
}

export type ReconcileResult = {
  memory: AssistantMemory
  ops: MemoryOp[]
  changed: boolean
}

/** Near-dup without importing private — mirror assistant-memory logic */
function normKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9áéíóúñü\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isNearDuplicate(a: string, b: string): boolean {
  const aa = normKey(a)
  const bb = normKey(b)
  if (!aa || !bb) return true
  if (aa === bb) return true
  if (aa.length >= 4 && bb.length >= 4 && (aa.includes(bb) || bb.includes(aa))) return true
  const wa = aa.split(' ').filter((w) => w.length > 2)
  const wb = bb.split(' ').filter((w) => w.length > 2)
  if (wa.length >= 2 && wb.length >= 2) {
    if (wa.slice(0, 2).join(' ') === wb.slice(0, 2).join(' ')) return true
  }
  return false
}

function dedupe(list: string[], max: number): string[] {
  const out: string[] = []
  for (const x of list) {
    const t = String(x || '').trim()
    if (!t) continue
    if (out.some((prev) => isNearDuplicate(prev, t))) continue
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

const LIST_FIELDS: Array<{
  key: keyof AssistantMemory
  max: number
}> = [
  { key: 'likes', max: 12 },
  { key: 'dislikes', max: 10 },
  { key: 'habits', max: 10 },
  { key: 'boundaries', max: 8 },
  { key: 'voiceNotes', max: 8 },
  { key: 'relational', max: 12 }
]

/**
 * Migrate legacy / partial objects without wiping valid data.
 * Unknown keys are preserved on the returned object when possible.
 */
export function migrateAssistantMemory(
  raw: unknown
): { memory: AssistantMemory; migrated: boolean; warnings: string[] } {
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object') {
    return { memory: emptyAssistantMemory(), migrated: false, warnings: ['empty'] }
  }
  const o = raw as Record<string, unknown>
  let migrated = false
  const mem: AssistantMemory = emptyAssistantMemory()

  for (const { key } of LIST_FIELDS) {
    const v = o[key]
    if (Array.isArray(v)) {
      mem[key] = v.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim()) as never
    } else if (v != null) {
      warnings.push(`invalid-${String(key)}`)
    }
  }
  if (typeof o.updatedAt === 'number') mem.updatedAt = o.updatedAt
  else {
    mem.updatedAt = Date.now()
    migrated = true
  }

  const ver = typeof o.version === 'number' ? o.version : 0
  if (ver < ASSISTANT_MEMORY_VERSION) {
    migrated = true
  }
  ;(mem as AssistantMemory & { version?: number }).version = ASSISTANT_MEMORY_VERSION

  // B2 partition on migrate
  const part = partitionAssistantLikes(mem)
  if ((part.relational?.length || 0) !== (mem.relational?.length || 0)) {
    migrated = true
  }
  part.version = ASSISTANT_MEMORY_VERSION
  return { memory: part, migrated, warnings }
}

/**
 * Detect user instructions to forget / correct assistant likes.
 * «ya no te gusta X», «olvida que te gusta X», «no te gusta el café»
 */
export function extractForgetOpsFromUser(userText: string): MemoryOp[] {
  const t = String(userText || '').trim()
  if (!t || t.length < 6) return []
  const ops: MemoryOp[] = []

  const patterns: Array<{ re: RegExp; field: keyof AssistantMemory }> = [
    {
      re: /(?:ya no te gusta|olvida(?:\s+que)?(?:\s+te gusta)?|no te gusta(?:\s+más)?|borra(?:\s+de\s+tu\s+memoria)?)\s+(.{2,48})/gi,
      field: 'likes'
    },
    {
      re: /(?:olvida(?:\s+lo\s+de)?|ya no)\s+(.{2,40})/gi,
      field: 'likes'
    }
  ]

  for (const { re, field } of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(t)) !== null) {
      let val = String(m[1] || '')
        .split(/[.;!?]/)[0]
        .replace(/^(el|la|los|las|un|una)\s+/i, '')
        .trim()
      if (val.length < 2 || val.length > 48) continue
      // skip if clearly about user
      if (/\b(me gusta|a m[ií])\b/i.test(val)) continue
      ops.push({ kind: 'remove', field, value: val, reason: 'user-forget' })
    }
  }
  return ops
}

function applyRemoves(
  mem: AssistantMemory,
  ops: MemoryOp[]
): { memory: AssistantMemory; applied: MemoryOp[] } {
  const applied: MemoryOp[] = []
  const next: AssistantMemory = {
    ...mem,
    likes: [...(mem.likes || [])],
    dislikes: [...(mem.dislikes || [])],
    habits: [...(mem.habits || [])],
    boundaries: [...(mem.boundaries || [])],
    voiceNotes: [...(mem.voiceNotes || [])],
    relational: [...(mem.relational || [])]
  }

  for (const op of ops) {
    if (op.kind !== 'remove' || !op.value) continue
    const key = op.field
    const list = (next[key] as string[] | undefined) || []
    if (!Array.isArray(list)) continue
    const filtered = list.filter((x) => !isNearDuplicate(x, op.value!))
    if (filtered.length < list.length) {
      ;(next as Record<string, unknown>)[key] = filtered
      applied.push({ ...op, previous: list.find((x) => isNearDuplicate(x, op.value!)) })
    } else {
      applied.push({ ...op, kind: 'reject', reason: 'not-found' })
    }
  }
  return { memory: next, applied }
}

/**
 * Reconcile previous memory + extracted candidates (+ optional forget ops).
 */
export function reconcileAssistantMemory(
  prev: AssistantMemory | null | undefined,
  candidates: AssistantExtracted | Partial<AssistantMemory>,
  opts?: { userText?: string }
): ReconcileResult {
  const base = migrateAssistantMemory(prev || emptyAssistantMemory()).memory
  const ops: MemoryOp[] = []

  // 1) User forget / correct
  if (opts?.userText) {
    const forgetOps = extractForgetOpsFromUser(opts.userText)
    if (forgetOps.length) {
      const { memory: afterRm, applied } = applyRemoves(base, forgetOps)
      ops.push(...applied)
      Object.assign(base, afterRm)
    }
  }

  // 2) Add candidates with dedupe / update (longer more precise phrase wins)
  for (const { key, max } of LIST_FIELDS) {
    const incoming = (candidates as Record<string, unknown>)[key]
    if (!Array.isArray(incoming) || !incoming.length) continue
    const cur = [...((base[key] as string[]) || [])]
    for (const raw of incoming) {
      const val = String(raw || '').trim()
      if (!val || val.length < 2) {
        ops.push({ kind: 'reject', field: key, value: val, reason: 'too-short' })
        continue
      }
      // classify likes into relational if needed
      if (key === 'likes') {
        const kind = classifyAssistantLikePhrase(val)
        if (kind === 'skip') {
          ops.push({ kind: 'reject', field: key, value: val, reason: 'skip-class' })
          continue
        }
        if (kind === 'relational') {
          const rel = [...(base.relational || [])]
          const dup = rel.find((x) => isNearDuplicate(x, val))
          if (dup) {
            if (val.length > dup.length + 4) {
              const i = rel.indexOf(dup)
              rel[i] = val
              base.relational = dedupe(rel, 12)
              ops.push({ kind: 'update', field: 'relational', value: val, previous: dup })
            } else {
              ops.push({ kind: 'noop', field: 'relational', value: val, reason: 'duplicate' })
            }
          } else {
            rel.push(val)
            base.relational = dedupe(rel, 12)
            ops.push({ kind: 'add', field: 'relational', value: val })
          }
          continue
        }
      }
      const dup = cur.find((x) => isNearDuplicate(x, val))
      if (dup) {
        if (val.length > dup.length + 4) {
          const i = cur.indexOf(dup)
          cur[i] = val
          ops.push({ kind: 'update', field: key, value: val, previous: dup })
        } else {
          ops.push({ kind: 'noop', field: key, value: val, reason: 'duplicate' })
        }
      } else {
        cur.push(val)
        ops.push({ kind: 'add', field: key, value: val })
      }
    }
    ;(base as Record<string, unknown>)[key] = dedupe(cur, max)
  }

  base.updatedAt = Date.now()
  ;(base as AssistantMemory & { version?: number }).version = ASSISTANT_MEMORY_VERSION

  const changed = ops.some((o) => o.kind === 'add' || o.kind === 'update' || o.kind === 'remove')
  return { memory: base, ops, changed }
}

/**
 * Mirror vs store: prefer newer updatedAt; if tie, prefer non-empty richer record
 * without inventing data.
 */
export function resolveMirrorVsStore(
  store: AssistantMemory | null | undefined,
  mirror: AssistantMemory | null | undefined
): { memory: AssistantMemory; source: 'store' | 'mirror' | 'empty' | 'merged' } {
  const s = store && !isAssistantMemoryEmpty(store) ? migrateAssistantMemory(store).memory : null
  const m = mirror && !isAssistantMemoryEmpty(mirror) ? migrateAssistantMemory(mirror).memory : null
  if (!s && !m) return { memory: emptyAssistantMemory(), source: 'empty' }
  if (s && !m) return { memory: s, source: 'store' }
  if (m && !s) return { memory: m, source: 'mirror' }
  const st = s!.updatedAt || 0
  const mt = m!.updatedAt || 0
  if (st > mt + 1000) return { memory: s!, source: 'store' }
  if (mt > st + 1000) return { memory: m!, source: 'mirror' }
  // Same age: merge lists conservatively
  const merged = reconcileAssistantMemory(s!, {
    likes: m!.likes,
    dislikes: m!.dislikes,
    habits: m!.habits,
    boundaries: m!.boundaries,
    voiceNotes: m!.voiceNotes,
    relational: m!.relational
  }).memory
  return { memory: merged, source: 'merged' }
}
