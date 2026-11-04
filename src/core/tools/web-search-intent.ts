/**
 * A1 — shared web-search intent + result contract (host tool).
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

/** Explicit user asks to search the web (Spanish México + English). */
export function wantsWebSearch(text: string): boolean {
  const uc = (text || '').toLowerCase()
  if (!uc.trim()) return false
  if (
    /\b(busca|buscar|búsqueda|busqueda|googlea|google|investiga|averigu[ae]|consulta|checa|revisa en)\b/.test(
      uc
    ) ||
    /\b(en internet|en la web|en la red|de la web|por internet|online|en línea|en linea)\b/.test(
      uc
    ) ||
    /\b(search the web|look up online|google this|web search)\b/.test(uc)
  )
    return true
  if (
    /\b(noticias? (de )?hoy|precio actual|clima (hoy|ahora)|pron[oó]stico|temperatura)\b/.test(
      uc
    ) ||
    /\b(qui[eé]n gan[oó]|resultado del partido|cotizaci[oó]n|tipo de cambio)\b/.test(uc)
  )
    return true
  if (
    /\b(qu[eé] (es|pasa con|se sabe de)|cu[aá]nto (cuesta|vale)|d[oó]nde queda)\b/.test(uc) &&
    /\b(202[4-9]|hoy|ahora|actual|reci[eé]n|lanzamiento|estreno)\b/.test(uc)
  )
    return true
  if (
    /\b(estreno|trailer|tráiler|pel[ií]cula|serie de|temporada|cap[ií]tulo)\b/.test(uc) &&
    /\b(cu[aá]ndo|nueva|nuevo|sali[oó]|sale|hoy|esta semana|202[4-9])\b/.test(uc)
  )
    return true
  if (/\b(qui[eé]n (es|fue|dirige|protagoniza)|en qu[eé] a[nñ]o)\b/.test(uc)) return true
  return false
}

/**
 * Soft auto-search for the *user turn* (not initiative).
 */
export function shouldAutoWebSearch(text: string): boolean {
  if (wantsWebSearch(text)) return true
  const uc = (text || '').toLowerCase()
  if (!uc.trim() || uc.length < 8) return false
  if (
    /\b(hoy|ahora|esta semana|este mes|reci[eé]n|actualidad|tendencia|viral)\b/.test(uc) &&
    /\b(noticia|pasa|pasó|paso|dijeron|anunci|lanz|estren|precio|clima|partido|elecciones)\b/.test(
      uc
    )
  )
    return true
  if (
    /\b(2025|2026|2027)\b/.test(uc) &&
    /\b(qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|qui[eé]n)\b/.test(uc)
  )
    return true
  return false
}

export function focusSearchQuery(raw: string, maxLen = 240): string {
  return (raw || '')
    .replace(/^(ya actualic[eé].{0,80}?,\s*)/i, '')
    .replace(/\b(por favor|podr[ií]as?|puedes?|me gustaría que|intenta de nuevo)\b/gi, ' ')
    .replace(
      /\b(busca|buscar|búsqueda|busqueda)\s+(en\s+)?(la\s+)?(web|internet|google)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

/**
 * Initiative web: ONLY when recent *user* lines clearly ask for or discuss a named topic
 * that benefits from fresh facts. No search from generic likes («me gusta el cine»).
 * This is the “se le ocurrió buscar sobre esa película que mencionaste” path — not spam.
 */
export function suggestInitiativeSearchQuery(input: {
  recentLines?: string[]
  focus?: string
  likes?: string[]
  favorites?: string[]
}): string | null {
  const userLines = (input.recentLines || [])
    .map((l) => l.replace(/^[^:]+:\s*/, '').trim())
    .filter(Boolean)
  // Prefer last 3 user-looking lines (heuristic: shorter speaker labels)
  const recentUserBlob = userLines.slice(-4).join('\n').toLowerCase()
  if (!recentUserBlob || recentUserBlob.length < 12) return null

  // Named title after media word
  const named =
    recentUserBlob.match(
      /\b(?:pel[ií]cula|serie|anime|juego|libro)\s+(?:de\s+|llamad[oa]\s+)?[«"']?([a-záéíóúñ0-9][\wáéíóúñ0-9\s:'-]{2,40})/i
    ) ||
    recentUserBlob.match(
      /\b(?:estreno|trailer|tráiler)\s+(?:de\s+)?[«"']?([a-záéíóúñ][\wáéíóúñ\s:'-]{2,40})/i
    )
  if (named?.[1]) {
    const title = named[1].replace(/\s+/g, ' ').trim().slice(0, 48)
    if (title.length >= 3) return focusSearchQuery(title + ' película serie 2025 2026')
  }

  // Explicit news / weather in recent user text
  if (/\b(noticias?|actualidad)\b/.test(recentUserBlob) && /\b(hoy|ahora|semana)\b/.test(recentUserBlob)) {
    return focusSearchQuery('noticias hoy ' + (input.focus || '').slice(0, 30))
  }
  if (/\b(clima|temperatura)\b/.test(recentUserBlob) && /\b(hoy|mañana|ahora)\b/.test(recentUserBlob)) {
    return focusSearchQuery('clima hoy')
  }

  // User explicitly wanted web earlier in the thread
  if (userLines.some((l) => wantsWebSearch(l))) {
    const last = [...userLines].reverse().find((l) => wantsWebSearch(l) || shouldAutoWebSearch(l))
    if (last) return focusSearchQuery(last.slice(0, 120))
  }

  // Do NOT search from static likes/favorites alone (that caused random movie searches)
  return null
}
