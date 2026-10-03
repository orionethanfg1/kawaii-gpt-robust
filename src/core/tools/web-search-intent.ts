/**
 * A1 — shared web-search intent + result contract (host tool).
 * Used by routing, orchestrator, planner — single source of truth.
 */

export type WebSearchHit = {
  title: string
  snippet: string
  url?: string
  source?: string
}

export type WebSearchResult = {
  ok: boolean
  hits: WebSearchHit[]
  query: string
  error?: string
}

/** Explicit user asks to search the web (Spanish + English). */
export function wantsWebSearch(text: string): boolean {
  const uc = (text || '').toLowerCase()
  if (!uc.trim()) return false
  return (
    /\b(busca|buscar|búsqueda|busqueda|googlea|google)\b/.test(uc) ||
    /\b(en internet|en la web|en la red|de la web|por internet)\b/.test(uc) ||
    /\b(noticias? de hoy|precio actual|clima (hoy|ahora))\b/.test(uc) ||
    /\b(search the web|look up online|google this)\b/.test(uc)
  )
}

/** Strip chit-chat for a cleaner search query. */
export function focusSearchQuery(raw: string, maxLen = 240): string {
  return (raw || '')
    .replace(/^(ya actualic[eé].{0,80}?,\s*)/i, '')
    .replace(/\b(por favor|podr[ií]as?|puedes?|me gustaría que|intenta de nuevo)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}
