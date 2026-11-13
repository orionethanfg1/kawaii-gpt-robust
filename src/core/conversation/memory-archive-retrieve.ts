/**
 * Retrieve lines from on-disk memory archive (overflow). Fail-soft.
 */

export type ArchiveBlob = {
  lines?: Array<string | { text?: string; at?: number; tags?: string[] }>
  text?: string
  updatedAt?: number
}

export function pickArchiveLinesForTurn(
  blob: ArchiveBlob | null | undefined,
  userText: string,
  opts?: { max?: number }
): string[] {
  if (!blob) return []
  const max = Math.max(1, Math.min(12, opts?.max ?? 5))
  const q = String(userText || '').toLowerCase()
  const tokens = q.split(/[^a-z0-9áéíóúüñ]+/i).filter((w) => w.length >= 4)
  const raw: string[] = []
  if (Array.isArray(blob.lines)) {
    for (const L of blob.lines) {
      if (typeof L === 'string') raw.push(L)
      else if (L && typeof L === 'object' && L.text) raw.push(String(L.text))
    }
  } else if (blob.text) {
    raw.push(...String(blob.text).split(/\n+/).map((x) => x.trim()).filter(Boolean))
  }
  if (!raw.length) return []
  const asksRecall =
    /\b(recuerdas|te acuerdas|qu[eé] sabes de m[ií]|retomemos|continuemos con|lo que hablamos de)\b/i.test(
      userText
    )
  if (!tokens.length) return asksRecall ? raw.slice(-Math.min(2, max)) : []

  const scored = raw
    .map((line) => {
      const low = line.toLowerCase()
      let s = 0
      for (const w of tokens) if (low.includes(w)) s += 1
      return { line, s }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)

  const out = scored.slice(0, max).map((x) => x.line)
  if (out.length) return out
  return asksRecall ? raw.slice(-Math.min(2, max)) : []
}

export function formatArchiveLinesForPrompt(lines: string[]): string {
  if (!lines?.length) return ''
  return (
    '[ARCHIVO DE MEMORIA — fragmentos recuperados]\n' +
    lines.map((l) => '- ' + String(l).slice(0, 220)).join('\n')
  )
}
