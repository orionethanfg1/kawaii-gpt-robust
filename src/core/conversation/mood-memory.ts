/**
 * B2b — Mood entries with timestamps (user sensitive / assistant optional).
 * Never invent "ayer" without `at`. TTL keeps transient feelings from becoming permanent biography.
 */

export type MoodPolarity = 'up' | 'down' | 'mixed' | 'neutral'
export type MoodSensitivity = 'normal' | 'sensitive'
export type MoodSource = 'user' | 'assistant'

export type MoodEntry = {
  text: string
  polarity?: MoodPolarity
  at: number
  expiresAt?: number
  source: MoodSource
  sensitivity?: MoodSensitivity
}

const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000 // 48h
const SENSITIVE_TTL_MS = 72 * 60 * 60 * 1000

export function emptyMoodList(): MoodEntry[] {
  return []
}

export function isMoodExpired(m: MoodEntry, now = Date.now()): boolean {
  if (m.expiresAt != null) return now > m.expiresAt
  // fallback: 48h from at
  return now - (m.at || 0) > DEFAULT_TTL_MS
}

export function activeMoods(list?: MoodEntry[] | null, now = Date.now()): MoodEntry[] {
  return (list || []).filter((m) => m && m.text && !isMoodExpired(m, now))
}

function cleanMoodText(raw: string): string {
  let s = String(raw || '').trim()
  s = s.split(/[.;!?\n]/)[0] || s
  s = s.replace(/[.,;!?…]+$/g, '').trim()
  if (s.length > 96) s = s.slice(0, 96).replace(/\s+\S*$/, '').trim()
  return s
}

function detectPolarity(s: string): MoodPolarity {
  const t = s.toLowerCase()
  if (/mal|triste|ansios|ansiedad|agotad|cansad|enojad|molest|preocup|fatal|horrible|baj[oó]/.test(t))
    return 'down'
  if (/bien|feliz|content|genial|emocionad|tranquila|tranquilo|esperanz|mejor/.test(t)) return 'up'
  if (/raro|mezcla|encontrad|no s[eé]/.test(t)) return 'mixed'
  return 'neutral'
}

function isSensitiveTopic(s: string): boolean {
  return /depres|suicid|duelo|luto|abuso|trauma|ansiedad fuerte|p[aá]nico|terapia|duelo/.test(
    s.toLowerCase()
  )
}

/** First-person mood from assistant reply */
export function extractAssistantMood(text: string, now = Date.now()): MoodEntry | null {
  const t = String(text || '')
  const m =
    t.match(
      /\b(?:hoy\s+)?me\s+siento\s+([^.;!?\n]{3,80})/i
    ) ||
    t.match(/\bestoy\s+(un\s+poco\s+|muy\s+)?(triste|feliz|cansad[oa]|ansios[oa]|tranquila|tranquilo|mejor|mal)\b/i)
  if (!m) return null
  const phrase = cleanMoodText(m[1] ? `me siento ${m[1]}` : m[0])
  if (phrase.length < 5) return null
  const sensitive = isSensitiveTopic(phrase)
  return {
    text: phrase,
    polarity: detectPolarity(phrase),
    at: now,
    expiresAt: now + (sensitive ? SENSITIVE_TTL_MS : DEFAULT_TTL_MS),
    source: 'assistant',
    sensitivity: sensitive ? 'sensitive' : 'normal'
  }
}

/** User message mood */
export function extractUserMood(text: string, now = Date.now()): MoodEntry | null {
  const t = String(text || '')
  const m =
    t.match(/\b(?:hoy\s+)?me\s+siento\s+([^.;!?\n]{3,80})/i) ||
    t.match(/\bestoy\s+(un\s+poco\s+|muy\s+)?(triste|feliz|cansad[oa]|ansios[oa]|enojad[oa]|mal|bien|fatal)\b/i) ||
    t.match(/\bando\s+(triste|mal|bajonead[oa]|deca[ií]d[oa])\b/i)
  if (!m) return null
  const phrase = cleanMoodText(
    m[1] && !/^(triste|feliz|cansad|ansios|enojad|mal|bien|fatal)/i.test(m[1])
      ? `me siento ${m[1]}`
      : m[0]
  )
  if (phrase.length < 4) return null
  const sensitive = isSensitiveTopic(phrase) || detectPolarity(phrase) === 'down'
  return {
    text: phrase,
    polarity: detectPolarity(phrase),
    at: now,
    expiresAt: now + (sensitive ? SENSITIVE_TTL_MS : DEFAULT_TTL_MS),
    source: 'user',
    sensitivity: sensitive ? 'sensitive' : 'normal'
  }
}

/** Keep newest first, max N, drop expired */
export function mergeMoodEntry(
  prev: MoodEntry[] | undefined,
  entry: MoodEntry | null,
  max = 8,
  now = Date.now()
): MoodEntry[] {
  if (!entry) return activeMoods(prev, now).slice(0, max)
  const rest = activeMoods(prev, now).filter(
    (x) => x.text.toLowerCase() !== entry.text.toLowerCase()
  )
  return [entry, ...rest].slice(0, max)
}

/** Relative time in es-MX (honest; requires at) */
export function formatRelativeTime(at: number, now = Date.now()): string {
  const ms = Math.max(0, now - at)
  const min = Math.floor(ms / 60000)
  if (min < 2) return 'hace un momento'
  if (min < 60) return `hace ${min} minutos`
  const h = Math.floor(min / 60)
  if (h < 24) return h === 1 ? 'hace una hora' : `hace ${h} horas`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ayer'
  if (d < 7) return `hace ${d} días`
  return `el ${new Date(at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`
}

/**
 * System snippet: at most one active mood. Never claim time without at.
 */
export function buildMoodPromptBlock(
  userMoods?: MoodEntry[] | null,
  assistantMoods?: MoodEntry[] | null,
  opts?: { userText?: string; now?: number }
): string {
  const now = opts?.now ?? Date.now()
  const q = String(opts?.userText || '').toLowerCase()
  const aboutMood = /\b(sientes|sientes|ánimo|animo|como est|cómo est|te sientes|me siento)\b/i.test(q)
  const lines: string[] = []

  const u = activeMoods(userMoods, now)[0]
  if (u && (aboutMood || now - u.at < 6 * 60 * 60 * 1000)) {
    lines.push(
      `Ánimo reciente del USUARIO (${formatRelativeTime(u.at, now)}; no inventes otra fecha): ${u.text}` +
        (u.sensitivity === 'sensitive' ? ' [tema sensible: tono cuidadoso, sin insistir]' : '')
    )
  }
  const a = activeMoods(assistantMoods, now)[0]
  if (a && aboutMood) {
    lines.push(
      `Tu ánimo reciente (${formatRelativeTime(a.at, now)}): ${a.text} — solo si encaja; no lo listes.`
    )
  }
  if (!lines.length) return ''
  return (
    'Tiempo y ánimo (solo si aplica; NUNCA digas «ayer» u otra fecha sin el dato de arriba):\n- ' +
    lines.join('\n- ')
  )
}
