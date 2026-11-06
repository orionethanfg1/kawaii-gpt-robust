/**
 * E3 — Episodic memory (dated contexts).
 * Stable facts stay in userMemory; episodes hold "when we talked about X".
 * Never mutates userMemory facts. Cap in-settings; overflow can live in archive.
 */

export type MemoryEpisode = {
  id: string
  /** Unix ms when the episode was recorded / occurred */
  at: number
  /** Local calendar day YYYY-MM-DD (optional but preferred) */
  day?: string
  /** Coarse time: mañana | tarde | noche | HH:mm */
  approxTime?: string
  summary: string
  tags: string[]
  people?: string[]
  conversationId?: string
  conversationTitle?: string
  /** live | migrated | manual | system */
  source?: 'live' | 'migrated' | 'manual' | 'system'
}

export type EpisodeStore = {
  episodes: MemoryEpisode[]
  updatedAt?: number
  /** One-shot migration from legacy facts/people completed */
  migratedFromLegacyAt?: number
}

export type AppendEpisodeInput = {
  summary: string
  tags?: string[]
  people?: string[]
  at?: number
  day?: string
  approxTime?: string
  conversationId?: string
  conversationTitle?: string
  source?: MemoryEpisode['source']
}

export const MAX_EPISODES_IN_SETTINGS = 40

export function emptyEpisodeStore(): EpisodeStore {
  return { episodes: [], updatedAt: Date.now() }
}

export function dayFromMs(ms: number, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString().slice(0, 10)
  }
}

export function approxTimeFromMs(ms: number, timeZone?: string): string {
  try {
    const h = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timeZone || undefined,
        hour: 'numeric',
        hour12: false
      }).format(new Date(ms))
    )
    if (h >= 5 && h < 12) return 'mañana'
    if (h >= 12 && h < 19) return 'tarde'
    return 'noche'
  } catch {
    const h = new Date(ms).getHours()
    if (h >= 5 && h < 12) return 'mañana'
    if (h >= 12 && h < 19) return 'tarde'
    return 'noche'
  }
}

function normalizeSummary(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

function newId(at: number): string {
  return 'ep_' + at.toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}

export function normalizeEpisodeStore(raw?: EpisodeStore | null): EpisodeStore {
  if (!raw || !Array.isArray(raw.episodes)) return emptyEpisodeStore()
  const episodes: MemoryEpisode[] = []
  const seen = new Set<string>()
  for (const e of raw.episodes) {
    if (!e || typeof e !== 'object') continue
    const summary = String(e.summary || '').trim().slice(0, 320)
    if (summary.length < 8) continue
    const at = typeof e.at === 'number' && e.at > 0 ? e.at : Date.now()
    const key = normalizeSummary(summary)
    if (seen.has(key)) continue
    seen.add(key)
    episodes.push({
      id: String(e.id || newId(at)),
      at,
      day: e.day || dayFromMs(at),
      approxTime: e.approxTime,
      summary,
      tags: Array.isArray(e.tags) ? e.tags.map(String).slice(0, 8) : [],
      people: Array.isArray(e.people) ? e.people.map(String).slice(0, 6) : undefined,
      conversationId: e.conversationId,
      conversationTitle: e.conversationTitle,
      source: e.source
    })
  }
  episodes.sort((a, b) => b.at - a.at)
  return {
    episodes: episodes.slice(0, MAX_EPISODES_IN_SETTINGS),
    updatedAt: raw.updatedAt || Date.now(),
    migratedFromLegacyAt: raw.migratedFromLegacyAt
  }
}

export function appendEpisode(
  store: EpisodeStore | null | undefined,
  input: AppendEpisodeInput
): EpisodeStore {
  const base = normalizeEpisodeStore(store)
  const summary = String(input.summary || '').trim().slice(0, 320)
  if (summary.length < 8) return base
  const at = input.at && input.at > 0 ? input.at : Date.now()
  const key = normalizeSummary(summary)
  if (base.episodes.some((e) => normalizeSummary(e.summary) === key)) {
    return base
  }
  const ep: MemoryEpisode = {
    id: newId(at),
    at,
    day: input.day || dayFromMs(at),
    approxTime: input.approxTime,
    summary,
    tags: (input.tags || []).map(String).filter(Boolean).slice(0, 8),
    people: input.people?.map(String).filter(Boolean).slice(0, 6),
    conversationId: input.conversationId,
    conversationTitle: input.conversationTitle,
    source: input.source || 'live'
  }
  const episodes = [ep, ...base.episodes].slice(0, MAX_EPISODES_IN_SETTINGS)
  return {
    ...base,
    episodes,
    updatedAt: Date.now()
  }
}

function scoreEpisode(ep: MemoryEpisode, userText: string, now: number): number {
  const q = normalizeSummary(userText)
  if (!q) return 0
  let score = 0
  const sum = normalizeSummary(ep.summary)
  const tags = (ep.tags || []).map((t) => normalizeSummary(t))
  const people = (ep.people || []).map((p) => normalizeSummary(p))

  const tokens = q.split(/[^a-z0-9áéíóúüñ]+/i).filter((w) => w.length >= 4)
  for (const w of tokens) {
    if (sum.includes(w)) score += 2
    if (tags.some((t) => t.includes(w) || w.includes(t))) score += 1.5
    if (people.some((p) => p.includes(w) || w.includes(p))) score += 3
  }

  if (/\b(ayer|anoche|la otra vez|hace\s+unos\s+d[ií]as|recuerdas|te\s+acuerdas)\b/i.test(userText)) {
    const ageDays = (now - ep.at) / (24 * 3600_000)
    if (ageDays < 14) score += 1.5
    if (ageDays < 3) score += 1
  }
  if (/\bhoy|esta\s+noche|esta\s+mañana\b/i.test(userText) && ep.day === dayFromMs(now)) {
    score += 2
  }

  const ageH = (now - ep.at) / 3600_000
  if (ageH < 48) score += 0.5

  return score
}

export function selectEpisodesForTurn(
  store: EpisodeStore | null | undefined,
  userText: string,
  opts?: { max?: number; now?: number }
): MemoryEpisode[] {
  const base = normalizeEpisodeStore(store)
  const max = Math.max(1, Math.min(6, opts?.max ?? 3))
  const now = opts?.now ?? Date.now()
  const q = String(userText || '').trim()
  if (!q || q.length < 3) {
    return base.episodes.filter((e) => now - e.at < 36 * 3600_000).slice(0, 1)
  }
  const ranked = base.episodes
    .map((e) => ({ e, s: scoreEpisode(e, q, now) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s || b.e.at - a.e.at)
  return ranked.slice(0, max).map((x) => x.e)
}

export function formatEpisodesForPrompt(episodes: MemoryEpisode[]): string {
  if (!episodes?.length) return ''
  const lines = episodes.map((e) => {
    const when =
      [e.day, e.approxTime].filter(Boolean).join(' · ') ||
      new Date(e.at).toISOString().slice(0, 10)
    const who = e.people?.length ? ' · personas: ' + e.people.join(', ') : ''
    const tags = e.tags?.length ? ' · #' + e.tags.slice(0, 4).join(' #') : ''
    return '- (' + when + ')' + who + tags + ': ' + e.summary
  })
  return (
    '[EPISODIOS — contextos fechados; no inventes otros]\n' +
    lines.join('\n') +
    '\nSi el usuario pregunta "¿recuerdas…?", apóyate en estos hechos; no digas que no sabes si aparece aquí.'
  )
}
