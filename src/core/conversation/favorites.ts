/**
 * Cosas favoritas — first-class memory for user + assistant.
 * Separate from generic "likes" so "mi color favorito es el verde" is explicit.
 */
export type FavoriteEntry = {
  /** Human value e.g. "verde", "moka" */
  value: string
  /** Optional category: color, comida, lugar, música, … */
  category?: string
}

const CAT =
  'color|colores|comida|platillo|bebida|caf[eé]|t[eé]|lugar|sitio|ciudad|pa[ií]s|m[uú]sica|canci[oó]n|pel[ií]cula|serie|libro|animal|flor|estaci[oó]n|hobby|pasatiempo|deporte|estilo|n[uú]mero|d[ií]a'

/** Stop capture at clause boundaries */
function clipValue(raw: string): string {
  let s = String(raw || '')
    .replace(/\s*[—–\-]\s*.*$/, '')
    .replace(/\s*[.!?].*$/, '')
    .replace(/\s*(?:y|pero|porque|que|representa|significa)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  s = s.replace(/^(el|la|los|las|un|una|unos|unas)\s+/i, '').trim()
  if (s.length < 2 || s.length > 48) return ''
  // drop pure pronouns
  if (/^(yo|tú|tu|te|me|nos|lo|la|eso|esto)$/i.test(s)) return ''
  return s
}

/**
 * Extract favorite things from Spanish text (user or assistant, first person).
 */
export function extractFavorites(text: string): FavoriteEntry[] {
  const t = String(text || '')
  if (!t.trim()) return []
  const out: FavoriteEntry[] = []
  const seen = new Set<string>()

  const push = (value: string, category?: string) => {
    const v = clipValue(value)
    if (!v) return
    const key = (category || '') + ':' + v.toLowerCase()
    if (seen.has(key) || seen.has(':' + v.toLowerCase())) return
    seen.add(key)
    out.push(category ? { value: v, category } : { value: v })
  }

  // "Mi color favorito es el verde"
  const reCat =
    new RegExp(
      `(?:mi|mis)\\s+(${CAT})\\s+favorit[oa]s?(?:\\s+es|\\s+son)?\\s+(?:el|la|los|las|un|una)?\\s*(.{2,40})`,
      'gi'
    )
  let m: RegExpExecArray | null
  while ((m = reCat.exec(t)) !== null) {
    push(m[2], normalizeCategory(m[1]))
  }

  // "El verde es mi color favorito" / "El verde es mi favorito"
  const reSubj = new RegExp(
    `([A-ZÁÉÍÓÚÑa-záéíóúñ][\\wáéíóúñ\\s]{1,35}?)\\s+es\\s+(?:mi|mis)\\s+(?:(${CAT})\\s+)?favorit[oa]s?`,
    'gi'
  )
  while ((m = reSubj.exec(t)) !== null) {
    push(m[1], m[2] ? normalizeCategory(m[2]) : undefined)
  }

  // "Mi favorito es el café" / "Mi favorita es la playa"
  const rePlain =
    /(?:mi|mis)\s+favorit[oa]s?(?:\s+es|\s+son)?\s+(?:el|la|los|las|un|una)?\s*(.{2,40})/gi
  while ((m = rePlain.exec(t)) !== null) {
    push(m[1])
  }

  // "favorito: verde" loose
  const reColon = /favorit[oa]s?\s*[:\-]\s*(.{2,40})/gi
  while ((m = reColon.exec(t)) !== null) {
    push(m[1])
  }

  return out.slice(0, 8)
}

function normalizeCategory(c: string): string {
  const x = c.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  if (/color/.test(x)) return 'color'
  if (/comida|platillo/.test(x)) return 'comida'
  if (/bebida|cafe|te\b/.test(x)) return 'bebida'
  if (/lugar|sitio|ciudad|pais/.test(x)) return 'lugar'
  if (/musica|cancion/.test(x)) return 'musica'
  if (/peli|serie/.test(x)) return 'cine'
  if (/libro/.test(x)) return 'libro'
  if (/animal/.test(x)) return 'animal'
  if (/deporte|hobby|pasatiempo/.test(x)) return 'hobby'
  return x.slice(0, 20)
}

/** Format for storage / chips: "color: verde" or "verde" */
export function formatFavorite(f: FavoriteEntry): string {
  const v = clipValue(f.value)
  if (!v) return ''
  if (f.category) return `${f.category}: ${v}`
  return v
}

export function favoritesToStrings(entries: FavoriteEntry[]): string[] {
  return [...new Set(entries.map(formatFavorite).filter(Boolean))].slice(0, 10)
}

export function mergeFavoriteStrings(
  prev: string[] | undefined,
  incoming: string[] | undefined,
  cap = 10
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of [...(prev || []), ...(incoming || [])]) {
    const s = String(x || '').trim()
    if (!s) continue
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    // prefer more specific "color: verde" over bare "verde"
    const bare = k.includes(':') ? k.split(':').pop()?.trim() : k
    if (bare && seen.has(bare) && k.includes(':')) {
      // replace bare with categorized
      const idx = out.findIndex((o) => o.toLowerCase() === bare)
      if (idx >= 0) out[idx] = s
      seen.add(k)
      continue
    }
    if (bare && !k.includes(':') && [...seen].some((s2) => s2.endsWith(': ' + bare) || s2.endsWith(':' + bare))) {
      continue
    }
    seen.add(k)
    out.push(s)
  }
  return out.slice(0, cap)
}
