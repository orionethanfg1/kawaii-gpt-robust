/**
 * Load overflow memory archive and pick a few lines relevant to the turn.
 * Does not require embeddings — keyword overlap only (local-first, fast).
 */

export type ArchiveBlob = {
  savedAt?: string
  kind?: string
  data?: {
    user?: {
      likes?: string[]
      favorites?: string[]
      facts?: string[]
      dislikes?: string[]
      goals?: string[]
      userName?: string
      preferredName?: string
    }
    assistant?: {
      preferredNames?: string[]
      likes?: string[]
      growthNotes?: string[]
    }
  }
}

function tokenize(q: string): string[] {
  return String(q || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3)
    .slice(0, 30)
}

function scoreLine(line: string, tokens: string[]): number {
  const L = line.toLowerCase()
  let n = 0
  for (const t of tokens) {
    if (L.includes(t)) n++
  }
  return n
}

/**
 * From archive JSON, return short bullet lines for system prompt (max ~6).
 */
export function pickArchiveLinesForTurn(
  archive: ArchiveBlob | null | undefined,
  userText: string,
  opts?: { max?: number }
): string[] {
  const max = opts?.max ?? 6
  const tokens = tokenize(userText)
  if (!archive?.data || tokens.length < 1) return []

  const candidates: { line: string; score: number }[] = []
  const u = archive.data.user || {}
  const a = archive.data.assistant || {}

  const pushAll = (arr: string[] | undefined, prefix: string) => {
    for (const x of arr || []) {
      const line = `${prefix}${x}`
      const sc = scoreLine(line, tokens)
      if (sc > 0) candidates.push({ line, score: sc })
    }
  }

  pushAll(u.likes, 'Usuario le gusta: ')
  pushAll(u.favorites, 'Usuario favorito: ')
  pushAll(u.facts, 'Hecho: ')
  pushAll(u.goals, 'Meta usuario: ')
  pushAll(u.dislikes, 'Usuario no le gusta: ')
  pushAll(a.likes, 'A ti te gusta: ')
  pushAll(a.preferredNames, 'Te llaman: ')
  pushAll(a.growthNotes, 'Evolución: ')

  candidates.sort((x, y) => y.score - x.score)
  const out: string[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    const k = c.line.toLowerCase().slice(0, 60)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c.line.slice(0, 160))
    if (out.length >= max) break
  }
  return out
}

export function formatArchiveLinesForPrompt(lines: string[]): string {
  if (!lines.length) return ''
  return (
    '[ARCHIVO de memoria — solo lo relevante al mensaje; no listes todo]\n' +
    lines.map((l) => `• ${l}`).join('\n')
  )
}
