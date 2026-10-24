/**
 * E3 — Episodic memory: short dated notes of what happened together.
 * Stored in settings (capped) + optional disk archive; retrieved by keyword overlap.
 */

export type MemoryEpisode = {
  id: string
  /** Unix ms */
  at: number
  /** Short human summary (1–3 sentences) */
  summary: string
  /** Tags for retrieval: nickname, intimacy, document, relationship, chat */
  tags: string[]
  conversationId?: string
  conversationTitle?: string
}

export type EpisodeStore = {
  episodes: MemoryEpisode[]
  updatedAt?: number
}

const MAX_EPISODES = 40
const MAX_SUMMARY = 280

export function emptyEpisodeStore(): EpisodeStore {
  return { episodes: [], updatedAt: Date.now() }
}

function makeId(): string {
  return `ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function appendEpisode(
  prev: EpisodeStore | null | undefined,
  input: {
    summary: string
    tags?: string[]
    conversationId?: string
    conversationTitle?: string
    at?: number
  }
): EpisodeStore {
  const summary = String(input.summary || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_SUMMARY)
  if (summary.length < 12) {
    return prev && prev.episodes ? prev : emptyEpisodeStore()
  }
  const tags = (input.tags || [])
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 8)
  const ep: MemoryEpisode = {
    id: makeId(),
    at: input.at || Date.now(),
    summary,
    tags,
    conversationId: input.conversationId,
    conversationTitle: input.conversationTitle
  }
  const list = [...(prev?.episodes || []), ep]
  // Dedupe near-identical summaries
  const seen = new Set<string>()
  const deduped: MemoryEpisode[] = []
  for (const e of list.slice().reverse()) {
    const key = e.summary.toLowerCase().slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(e)
  }
  deduped.reverse()
  return {
    episodes: deduped.slice(-MAX_EPISODES),
    updatedAt: Date.now()
  }
}

/** Simple relevance: tag hit + token overlap with user text */
export function scoreEpisode(ep: MemoryEpisode, userText: string): number {
  const q = String(userText || '').toLowerCase()
  if (!q || q.length < 3) return 0.15 // slight recency bias only via caller
  let s = 0
  for (const t of ep.tags) {
    if (t && q.includes(t)) s += 0.35
  }
  const tokens = q
    .split(/[^\p{L}\p{N}]+/u)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4)
  const sum = ep.summary.toLowerCase()
  let hits = 0
  for (const tok of tokens.slice(0, 24)) {
    if (sum.includes(tok)) hits++
  }
  s += Math.min(0.5, hits * 0.08)
  // Soft boost for recall-style questions
  if (/\b(recuerdas|recuerdas cuando|te acuerdas|aquella vez|la vez que)\b/i.test(q)) {
    s += 0.2
  }
  return s
}

/**
 * Top-k episodes for the current turn. Prefer relevance; if none score well, take most recent 1–2.
 */
export function selectEpisodesForTurn(
  store: EpisodeStore | null | undefined,
  userText: string,
  opts?: { max?: number; minScore?: number }
): MemoryEpisode[] {
  const max = opts?.max ?? 3
  const minScore = opts?.minScore ?? 0.25
  const list = store?.episodes || []
  if (!list.length) return []
  const scored = list
    .map((ep) => ({ ep, score: scoreEpisode(ep, userText) }))
    .sort((a, b) => b.score - a.score || b.ep.at - a.ep.at)
  const strong = scored.filter((x) => x.score >= minScore).slice(0, max)
  if (strong.length) return strong.map((x) => x.ep)
  // No strong match: only inject recent if user seems to ask for memory
  if (/\b(recuerdas|te acuerdas|aquella|la vez|hace tiempo|nuestro)\b/i.test(userText)) {
    return list.slice(-2).reverse()
  }
  return []
}

export function formatEpisodesForPrompt(episodes: MemoryEpisode[]): string {
  if (!episodes.length) return ''
  const lines = episodes.map((ep) => {
    const when = new Date(ep.at).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short'
    })
    const where = ep.conversationTitle ? ` · ${ep.conversationTitle.slice(0, 40)}` : ''
    return `• (${when}${where}) ${ep.summary}`
  })
  return (
    '[EPISODIOS relevantes — hechos compartidos; no inventes otros]\n' + lines.join('\n')
  )
}
