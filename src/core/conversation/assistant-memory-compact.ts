/**
 * B7 — Compact assistant memory: merge near-duplicates, prefer shorter canonical phrases.
 */

import type { AssistantMemory } from './assistant-memory'
import { emptyAssistantMemory } from './assistant-memory'

function normKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): Set<string> {
  return new Set(
    normKey(s)
      .split(' ')
      .filter((w) => w.length > 2)
      .filter((w) => !/^(que|los|las|una|uno|unos|unas|del|con|por|para|como|sobre|desde|cuando|donde|este|esta|esos|esas|muy|mas|pero|porque)$/.test(w))
  )
}

export function phraseSimilarity(a: string, b: string): number {
  const aa = normKey(a)
  const bb = normKey(b)
  if (!aa || !bb) return 1
  if (aa === bb) return 1
  if (aa.length >= 5 && bb.length >= 5 && (aa.includes(bb) || bb.includes(aa))) return 0.92
  const sa = tokens(a)
  const sb = tokens(b)
  if (!sa.size || !sb.size) return 0
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const union = sa.size + sb.size - inter
  return union ? inter / union : 0
}

export function isNearDuplicatePhrase(a: string, b: string, threshold = 0.5): boolean {
  return phraseSimilarity(a, b) >= threshold
}

/**
 * Prefer the shorter, cleaner phrase when two are near-duplicates.
 */
export function compactStringList(list: string[] | undefined | null, max: number): string[] {
  const raw = (list || []).map((x) => String(x || '').trim()).filter(Boolean)
  const clusters: string[] = []
  for (const item of raw) {
    let merged = false
    for (let i = 0; i < clusters.length; i++) {
      if (isNearDuplicatePhrase(clusters[i], item, 0.5)) {
        // Keep shorter (or equal length with fewer commas)
        const cur = clusters[i]
        const prefer =
          item.length < cur.length - 8
            ? item
            : item.length <= cur.length && (item.split(',').length <= cur.split(',').length)
              ? item
              : cur
        clusters[i] = prefer
        merged = true
        break
      }
    }
    if (!merged) clusters.push(item)
  }
  // Second pass: drop very long noisy tails
  const cleaned = clusters
    .map((s) => {
      let t = s.replace(/\s+/g, ' ').trim()
      // cut at second sentence-ish
      const parts = t.split(/(?<=[.!?…])\s+/)
      if (parts.length > 1 && parts[0].length >= 12) t = parts[0].replace(/[.!?…]+$/, '').trim()
      if (t.length > 72) t = t.slice(0, 72).replace(/\s+\S*$/, '').trim()
      return t
    })
    .filter(Boolean)
  // Final near-dedupe after clean
  const out: string[] = []
  for (const x of cleaned) {
    if (out.some((p) => isNearDuplicatePhrase(p, x, 0.55))) continue
    out.push(x)
    if (out.length >= max) break
  }
  return out
}

const LIMITS = {
  likes: 8,
  dislikes: 6,
  habits: 6,
  boundaries: 6,
  voiceNotes: 6,
  relational: 8
} as const

/** B7 — full memory compact; returns same ref if nothing changed */
export function compactAssistantMemory(mem: AssistantMemory | null | undefined): AssistantMemory {
  const base = mem || emptyAssistantMemory()
  const next: AssistantMemory = {
    ...base,
    likes: compactStringList(base.likes, LIMITS.likes),
    dislikes: compactStringList(base.dislikes, LIMITS.dislikes),
    habits: compactStringList(base.habits, LIMITS.habits),
    boundaries: compactStringList(base.boundaries, LIMITS.boundaries),
    voiceNotes: compactStringList(base.voiceNotes, LIMITS.voiceNotes),
    relational: compactStringList(base.relational, LIMITS.relational),
    updatedAt: base.updatedAt || Date.now()
  }
  return next
}

export function memoryListsChanged(a: AssistantMemory, b: AssistantMemory): boolean {
  const keys = ['likes', 'dislikes', 'habits', 'boundaries', 'voiceNotes', 'relational'] as const
  for (const k of keys) {
    const aa = (a[k] || []).join('\n')
    const bb = (b[k] || []).join('\n')
    if (aa !== bb) return true
  }
  return false
}
