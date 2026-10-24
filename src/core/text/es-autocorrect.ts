/**
 * Lightweight Spanish (es-MX) autocorrect for chat composer.
 * Best practices:
 * - Prefer suggestions over silent rewrites while typing
 * - Safe dictionary + accent fixes; no aggressive grammar rewrite
 * - applyOnSend for low-risk fixes the user almost always wants
 */

export type AutocorrectSuggestion = {
  from: string
  to: string
  /** character index in original text where the token starts */
  index: number
  reason: 'accent' | 'typo' | 'swap'
}

/** Common es-MX typos / missing accents (whole-word, case-insensitive). */
const WORD_MAP: Record<string, string> = {
  // accents / orthography
  que: 'qué', // only when applied carefully — see contextual
  porque: 'porque', // leave; porque/por qué is contextual
  asi: 'así',
  tambien: 'también',
  mas: 'más', // contextual: "mas" can be "but" rare in MX
  aqui: 'aquí',
  alli: 'allí',
  alla: 'allá',
  despues: 'después',
  rapido: 'rápido',
  facil: 'fácil',
  dificil: 'difícil',
  numero: 'número',
  telefono: 'teléfono',
  corazon: 'corazón',
  estan: 'están',
  esta: 'está', // contextual: esta vs está
  estas: 'estás',
  tu: 'tú', // contextual
  el: 'él', // contextual — skip in applyOnSend for el/él
  solo: 'sólo', // optional RAE; keep solo in MX modern — skip
  // s/z and common swaps
  acer: 'hacer',
  aser: 'hacer',
  aora: 'ahora',
  digiste: 'dijiste',
  digisteis: 'dijiste',
  proque: 'porque',
  porq: 'porque',
  xq: 'porque',
  kiero: 'quiero',
  kieres: 'quieres',
  ke: 'qué',
  qe: 'qué',
  tbn: 'también',
  tb: 'también',
  xa: 'para',
  pa: 'para',
  naa: 'nada',
  nunka: 'nunca',
  iwal: 'igual',
  pos: 'pues',
  toy: 'estoy',
  tas: 'estás',
  ta: 'está',
  tamos: 'estamos',
  visite: 'visite', // leave
  // intimacy / companion frequent
  beso: 'beso',
  amooo: 'amo',
  holaa: 'hola',
  holii: 'hola',
  graacias: 'gracias',
  grcias: 'gracias',
  porfa: 'por favor',
  pf: 'por favor',
  erores: 'errores',
  eror: 'error',
  errror: 'error',
  problemaa: 'problema',
  nesesito: 'necesito',
  nesecito: 'necesito',
  necisito: 'necesito',
  abeses: 'a veces',
  abeces: 'a veces',
  ahi: 'ahí',
  hayy: 'hay',
  qiero: 'quiero',
  qieres: 'quieres',
  qiere: 'quiere',
  mui: 'muy',
  serca: 'cerca',
  lueego: 'luego',
  entonses: 'entonces',
  entonse: 'entonces',
  talves: 'tal vez',
  talvez: 'tal vez',
  quizas: 'quizás',
  demaciado: 'demasiado',
  demaciados: 'demasiados',
  peqeno: 'pequeño',
  pequenio: 'pequeño',
  llendo: 'yendo',
  haora: 'ahora',
  atraz: 'atrás',
  enpesar: 'empezar',
  enpezo: 'empezó',
  empeso: 'empezó',
  corrector: 'corrector',
  detecion: 'detección',
  deteccion: 'detección',
  funcionara: 'funcionará',
  funcion: 'función',
  utlidad: 'utilidad',
  utilida: 'utilidad',
  suficente: 'suficiente',
  sufiente: 'suficiente',
  sitema: 'sistema',
  sistem: 'sistema',
  ejempllo: 'ejemplo',
  ejenplo: 'ejemplo',
  ejmplo: 'ejemplo',
}

/** Tokens we only fix with accents when sentence looks interrogative or mid-phrase safe. */
const CONTEXTUAL_ACCENT: Record<string, string> = {
  que: 'qué',
  como: 'cómo',
  cuando: 'cuándo',
  donde: 'dónde',
  cuanto: 'cuánto',
  quien: 'quién',
  si: 'sí'
}

function tokenizeWithIndex(text: string): Array<{ word: string; index: number; raw: string }> {
  const out: Array<{ word: string; index: number; raw: string }> = []
  const re = /[A-Za-zÁÉÍÓÚÜáéíóúüÑñ]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    out.push({ word: m[0], index: m.index, raw: m[0] })
  }
  return out
}

function matchCase(sample: string, replacement: string): string {
  if (!sample) return replacement
  if (sample === sample.toUpperCase()) return replacement.toUpperCase()
  if (sample[0] === sample[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  }
  return replacement
}



/** Frequent correct Spanish tokens for fuzzy near-match (distance 1). */
const KNOWN_GOOD = new Set(
  Object.values(WORD_MAP)
    .concat(Object.values(CONTEXTUAL_ACCENT))
    .concat([
      'error', 'errores', 'ejemplo', 'sistema', 'utilidad', 'suficiente', 'detección',
      'función', 'corrector', 'necesito', 'también', 'después', 'aquí', 'allí', 'ahora',
      'porque', 'cuando', 'donde', 'cómo', 'quién', 'entonces', 'quizás', 'demasiado',
      'pequeño', 'gracias', 'hola', 'quiero', 'quieres', 'estoy', 'estás', 'está',
      'mensaje', 'respuesta', 'modelo', 'imagen', 'chat', 'usuario', 'persona',
      'corazón', 'amor', 'beso', 'noche', 'día', 'mañana', 'tarde', 'siempre',
      'nunca', 'nada', 'todo', 'bien', 'mal', 'bueno', 'buena', 'mejor', 'peor',
      'hacer', 'tener', 'poder', 'decir', 'estar', 'ser', 'ir', 'ver', 'saber',
      'español', 'méxico', 'mexico', 'aplicación', 'aplicacion', 'configuración'
    ])
    .map((w) => w.toLowerCase())
)

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    let prev = i
    for (let j = 0; j < b.length; j++) {
      const cur = row[j + 1]
      const cost = a[i] === b[j] ? 0 : 1
      row[j + 1] = Math.min(row[j + 1] + 1, row[j] + 1, prev + cost)
      prev = cur
    }
  }
  return row[b.length]
}

function fuzzySuggest(word: string): string | null {
  const low = word.toLowerCase()
  if (low.length < 4 || low.length > 24) return null
  if (KNOWN_GOOD.has(low)) return null
  if (WORD_MAP[low]) return null
  let best: string | null = null
  let bestD = 3
  for (const cand of KNOWN_GOOD) {
    if (Math.abs(cand.length - low.length) > 2) continue
    const d = levenshtein(low, cand)
    if (d > 0 && d < bestD) {
      bestD = d
      best = cand
      if (d === 1) break
    }
  }
  // Only accept distance 1 (safe) or 2 if same first letter and length close
  if (!best) return null
  if (bestD === 1) return best
  if (bestD === 2 && best[0] === low[0] && Math.abs(best.length - low.length) <= 1) return best
  return null
}

/**
 * List suggestions without mutating (for UI chips).
 */
export function suggestSpanishAutocorrect(text: string): AutocorrectSuggestion[] {
  const suggestions: AutocorrectSuggestion[] = []
  const tokens = tokenizeWithIndex(text)
  const lowerFull = text.toLowerCase()
  const looksQuestion = /\?|¿/.test(text) || /^(qué|que|cómo|como|dónde|donde)\b/i.test(text.trim())

  for (const tok of tokens) {
    const low = tok.word.toLowerCase()
    // Skip very short after dictionary check
    if (WORD_MAP[low] && WORD_MAP[low] !== low) {
      const to = matchCase(tok.word, WORD_MAP[low])
      if (to !== tok.word) {
        // Skip aggressive "mas" → "más" when clearly "mas" as conjunction (rare)
        if (low === 'mas' && /\bmas\s+(no|sin|bien)\b/i.test(lowerFull)) continue
        suggestions.push({
          from: tok.word,
          to,
          index: tok.index,
          reason: /[áéíóúüñ]/i.test(to) && !/[áéíóúüñ]/i.test(tok.word) ? 'accent' : 'typo'
        })
      }
    } else if (CONTEXTUAL_ACCENT[low] && looksQuestion) {
      const to = matchCase(tok.word, CONTEXTUAL_ACCENT[low])
      if (to !== tok.word) {
        suggestions.push({
          from: tok.word,
          to,
          index: tok.index,
          reason: 'accent'
        })
      }
    } else {
      const fuzzy = fuzzySuggest(tok.word)
      if (fuzzy) {
        suggestions.push({
          from: tok.word,
          to: matchCase(tok.word, fuzzy),
          index: tok.index,
          reason: 'typo'
        })
      }
    }
  }
  // de-dupe same from→to
  const seen = new Set<string>()
  return suggestions.filter((s) => {
    const k = `${s.from}→${s.to}@${s.index}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Apply low-risk fixes (typos + clear accents). Safer for on-send.
 * Does not change "el"/"tu"/"esta" without context (too ambiguous).
 */
export function applySpanishAutocorrectLight(text: string): string {
  const skip = new Set(['el', 'tu', 'esta', 'estas', 'solo', 'mas', 'si', 'que'])
  let out = text
  const tokens = tokenizeWithIndex(text).reverse() // replace from end
  for (const tok of tokens) {
    const low = tok.word.toLowerCase()
    if (skip.has(low)) continue
    const mapped = WORD_MAP[low]
    if (!mapped || mapped === low) continue
    const to = matchCase(tok.word, mapped)
    if (to === tok.word) continue
    out = out.slice(0, tok.index) + to + out.slice(tok.index + tok.word.length)
  }
  // ¿ at start of questions without opening mark
  if (/\?\s*$/.test(out) && !/¿/.test(out) && out.length < 200) {
    const t = out.trimStart()
    if (/^(qué|que|cómo|como|dónde|donde|cuándo|cuando|quién|quien|por qué|por que)\b/i.test(t)) {
      out = out.replace(/^(\s*)/, '$1¿')
    }
  }
  return out
}

/** Apply a single suggestion by index. */
export function applySuggestion(text: string, s: AutocorrectSuggestion): string {
  const slice = text.slice(s.index, s.index + s.from.length)
  if (slice.toLowerCase() !== s.from.toLowerCase()) {
    // fallback global first occurrence
    const re = new RegExp(`\\b${escapeRe(s.from)}\\b`, 'i')
    return text.replace(re, s.to)
  }
  return text.slice(0, s.index) + s.to + text.slice(s.index + s.from.length)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
