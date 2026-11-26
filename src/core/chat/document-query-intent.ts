/**
 * D0 — Pure intent signals for document / story queries.
 * Shared by decision-packet, user-memory injection, and orchestration.
 * Does not touch stores or mutate memory.
 */

/** Classic doc/file reading language */
export const DOC_FILE_QUERY_RE =
  /\b(lee|lectura|libro|cap[ií]tulo|documento|pdf|docx|tramo|contin[uú]a(r)? (leyendo|la lectura)|sigue leyendo|adjunto|rese[nñ]a)\b/i

/**
 * Character / plot recall without requiring the word "libro".
 * Covers: nombra los personajes, quién es X, elenco, protagonista…
 */
export const DOC_STORY_ENTITY_QUERY_RE =
  /\b(personajes?|protagonistas?|antagonistas?|elenco|c[oó]mo se llama[n]?|qui[eé]n(?:es)? (?:es|son|era|eran)|nombra(?:r)? (?:los |las )?(?:personajes?|protagonistas?)|nombres? (?:del|de la|de los|de las) (?:libro|historia|novela|cuento|obra)|de (?:qu[eé|ie]n|quién) habla|sobre (?:el|la|los|las) personajes?)\b/i

export const DOC_PROGRESS_QUERY_RE =
  /\b(cap[ií]tulo|capítulos|cu[aá]ntos? cap|en qu[eé] cap|d[oó]nde (te )?quedaste|hasta d[oó]nde|progreso (de )?lectura|has le[ií]do)\b/i

/** Union: any reason to treat the turn as document-grounded. */
export const DOC_OR_STORY_QUERY_RE = new RegExp(
  `(?:${DOC_FILE_QUERY_RE.source})|(?:${DOC_STORY_ENTITY_QUERY_RE.source})|(?:${DOC_PROGRESS_QUERY_RE.source})`,
  'i'
)

export function wantsDocumentFileQuery(text: string): boolean {
  return DOC_FILE_QUERY_RE.test(String(text || ''))
}

export function wantsDocumentStoryEntityQuery(text: string): boolean {
  return DOC_STORY_ENTITY_QUERY_RE.test(String(text || ''))
}

export function wantsDocumentProgressQuery(text: string): boolean {
  return DOC_PROGRESS_QUERY_RE.test(String(text || ''))
}

/** True when the user is asking about the book, its people, or reading progress. */
export function wantsDocumentOrStoryQuery(text: string): boolean {
  const t = String(text || '')
  if (!t.trim()) return false
  return (
    wantsDocumentFileQuery(t) ||
    wantsDocumentStoryEntityQuery(t) ||
    wantsDocumentProgressQuery(t)
  )
}

/**
 * Spanish / narrative tokens that look like "names" after sentence capitals
 * but must never enter the entity map from mapSliceToFacts.
 */
export const DOC_NAME_STOPWORDS = new Set(
  [
    'El',
    'La',
    'Los',
    'Las',
    'Un',
    'Una',
    'Uno',
    'The',
    'A',
    'An',
    'Y',
    'O',
    'De',
    'Del',
    'En',
    'Por',
    'Con',
    'Para',
    'Sin',
    'Sobre',
    'Chapter',
    'Capítulo',
    'Capitulo',
    'Pues',
    'Pero',
    'Aunque',
    'Cuando',
    'Entonces',
    'Mientras',
    'Después',
    'Despues',
    'Antes',
    'Ahora',
    'Luego',
    'Además',
    'Ademas',
    'También',
    'Tambien',
    'Solo',
    'Sólo',
    'Así',
    'Asi',
    'Bien',
    'Mal',
    'Muy',
    'Ya',
    'Si',
    'Sí',
    'No',
    'Que',
    'Qué',
    'Como',
    'Cómo',
    'Donde',
    'Dónde',
    'Este',
    'Esta',
    'Estos',
    'Estas',
    'Ese',
    'Esa',
    'Aquella',
    'Aquello',
    'Todo',
    'Toda',
    'Todos',
    'Todas',
    'Otro',
    'Otra',
    'Otros',
    'Otras',
    'Alguien',
    'Nadie',
    'Nada',
    'Algo',
    'Hoy',
    'Ayer',
    'Mañana',
    'Manana'
  ].map((w) => w.toLowerCase())
)

export function isPlausibleDocProperName(raw: string): boolean {
  const n = String(raw || '').trim()
  if (n.length < 3 || n.length > 48) return false
  if (DOC_NAME_STOPWORDS.has(n.toLowerCase())) return false
  // Reject pure function words / single short tokens that are stopwords
  if (/^(el|la|los|las|de|del|y|o|u|a|en)$/i.test(n)) return false
  // Prefer tokens that are not entire-sentence starters only: at least one lowercase letter inside multi-word
  if (/\s/.test(n)) {
    const parts = n.split(/\s+/)
    if (parts.every((p) => DOC_NAME_STOPWORDS.has(p.toLowerCase()))) return false
  }
  return true
}
