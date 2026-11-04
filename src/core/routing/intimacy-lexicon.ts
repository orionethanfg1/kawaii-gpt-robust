/**
 * Diccionario de intimidad / cercanía física y erótica (ES + EN).
 * Usado por classifyChatTask → ruta Auto «intimacy» (modelos abliterated / menos censura).
 *
 * Niveles:
 * - soft: cariño físico / romance cercano (abrazo, beso, labios…)
 * - mid: deseo, cuerpo, cama, desnudez implícita
 * - strong: explícito sexual (solo con adultIntimacyOptIn)
 */

export type IntimacyLexLevel = 'soft' | 'mid' | 'strong'

/** Términos y raíces (se combinan en un único regex). */
export const INTIMACY_SOFT_TERMS: string[] = [
  // Beso / labios
  'bes(?:ar|arte|arme|arnos|arse|o|a|os|as|itos?)',
  'labios?',
  'kiss(?:es|ed|ing)?',
  'pecks?',
  // Abrazo / contacto tierno
  'abraz(?:ar|arte|arme|arnos|o|ame)?',
  'abrazo',
  'hug(?:s|ged|ging)?',
  'acarici(?:ar|arte|arme|o|as)?',
  'caricias?',
  'mimos?',
  'mimarte',
  'snuggl(?:e|es|ing)',
  'cuddle(?:s|d|ing)?',
  // Cercanía romántica
  'cerca(?:n[ií]a)?',
  'acurruc(?:ar|arte|arme|ados?)?',
  'entre (?:mis|tus|sus) brazos',
  'junto a (?:m[ií]|ti)',
  'mano en (?:la )?cintura',
  'tomar(?:te|me)? de la mano',
  'entrelaz(?:ar|adas?)? (?:las )?manos',
]

export const INTIMACY_MID_TERMS: string[] = [
  'íntim[oa]s?',
  'intim[oa]s?',
  'intimidad',
  'deseo',
  'desear(?:te|me)?',
  'te deseo',
  'me deseas',
  'atracci[oó]n f[ií]sica',
  'atracci[oó]n',
  'excit(?:ar|arte|arme|aci[oó]n|ado|ada)?',
  'caliente',
  'ardiente',
  'pasional',
  'pasión',
  'en (?:la )?cama',
  'a la cama',
  'dormir juntos',
  'pasar la noche',
  'desnud(?:o|a|arte|arme|ez)?',
  'sin ropa',
  'en ropa interior',
  'cuello',
  'nuca',
  'clav[ií]cula',
  'pecho',
  'cintura',
  'caderas?',
  'muslos?',
  'piel',
  'susurr(?:ar|o|ame)',
  'al o[ií]do',
  'morder(?:te|me)? (?:el )?labio',
  'seduc(?:ir|ci[oó]n|tora)?',
  'provoc(?:ar|arte)?',
  'flirte(?:ar|o)',
  'flirt(?:ing)?',
  'make out',
  'outmake',
  'bedroom',
  'naked',
  'undress(?:ed|ing)?',
  'turn(?:ed)? on',
  'aroused?',
  'horny',
]

export const INTIMACY_STRONG_TERMS: string[] = [
  'sexo',
  'sexual(?:es|mente)?',
  'hacer el amor',
  'haz el amor',
  'hagamos el amor',
  'make love',
  'lovemaking',
  'follar',
  'cog(?:er|erte|erme)',
  'penetr(?:ar|aci[oó]n)',
  'oral',
  'orgasmo',
  'cl[ií]toris',
  'vagina',
  'pene',
  'polla',
  'erecci[oó]n',
  'masturb(?:ar|arte|arme|aci[oó]n)?',
  'tocarte',
  't[oó]came',
  'abajo del ombligo',
  'entre las piernas',
  'mojad[oa]',
  'hardcore',
  'nsfw',
  'er[oó]tic[oa]s?',
  'porn(?:o|ografía)?',
]

/** Frases multi-palabra (se prueban aparte, case-insensitive). */
export const INTIMACY_PHRASES: Array<{ re: RegExp; level: IntimacyLexLevel }> = [
  { level: 'soft', re: /quiero (?:un )?beso/i },
  { level: 'soft', re: /(?:dame|quiero) un abrazo/i },
  { level: 'soft', re: /bes(?:ame|arme)|abraz(?:ame|arme)/i },
  { level: 'soft', re: /s[eé] m[aá]s cari[nñ]os[oa]/i },
  { level: 'soft', re: /m[aá]s cerca (?:de m[ií]|m[ií]o)/i },
  { level: 'mid', re: /seamos m[aá]s [ií]ntimos/i },
  { level: 'mid', re: /quiero cercan[ií]a (?:f[ií]sica|adulta)/i },
  { level: 'mid', re: /modo [ií]ntimo/i },
  { level: 'mid', re: /quiero (?:sentirte|tocarte|abrazarte fuerte)/i },
  { level: 'mid', re: /pasar(?:nos)? (?:la )?noche juntos/i },
  { level: 'mid', re: /quiero (?:verte|estar) desnud/i },
  { level: 'mid', re: /encende(?:r|me|rte)|me enciendes/i },
  { level: 'strong', re: /hagamos el amor|hacer el amor|haz el amor/i },
  { level: 'strong', re: /quiero (?:hacer|tener) sexo/i },
  { level: 'strong', re: /sexo oral|sexo anal/i },
  { level: 'strong', re: /te quiero dentro|dentro de (?:m[ií]|ti)/i },
]

let _softRe: RegExp | null = null
let _midRe: RegExp | null = null
let _strongRe: RegExp | null = null

function buildAlt(terms: string[]): RegExp {
  return new RegExp('\\b(?:' + terms.join('|') + ')\\b', 'i')
}

export function intimacySoftRe(): RegExp {
  return (_softRe ||= buildAlt(INTIMACY_SOFT_TERMS))
}
export function intimacyMidRe(): RegExp {
  return (_midRe ||= buildAlt(INTIMACY_MID_TERMS))
}
export function intimacyStrongRe(): RegExp {
  return (_strongRe ||= buildAlt(INTIMACY_STRONG_TERMS))
}

export type IntimacyDetect = {
  hit: boolean
  level: IntimacyLexLevel | null
  /** Fragment matched (for logs) */
  matched?: string
}

/**
 * Detect intimacy language. strong ⊂ mid ⊂ soft for routing purposes:
 * any hit ⇒ candidate for intimacy task (caller applies adultOptIn / stage).
 */
export function detectIntimacyLanguage(text: string): IntimacyDetect {
  const t = (text || '').trim()
  if (!t) return { hit: false, level: null }

  for (const { re, level } of INTIMACY_PHRASES) {
    const m = t.match(re)
    if (m) return { hit: true, level, matched: m[0] }
  }
  if (intimacyStrongRe().test(t)) {
    const m = t.match(intimacyStrongRe())
    return { hit: true, level: 'strong', matched: m?.[0] }
  }
  if (intimacyMidRe().test(t)) {
    const m = t.match(intimacyMidRe())
    return { hit: true, level: 'mid', matched: m?.[0] }
  }
  if (intimacySoftRe().test(t)) {
    const m = t.match(intimacySoftRe())
    return { hit: true, level: 'soft', matched: m?.[0] }
  }
  return { hit: false, level: null }
}

/** @deprecated prefer detectIntimacyLanguage — kept for existing imports */
export const INTIMACY_LANG_RE = new RegExp(
  '\\b(?:' +
    [...INTIMACY_SOFT_TERMS, ...INTIMACY_MID_TERMS, ...INTIMACY_STRONG_TERMS].join('|') +
    ')\\b',
  'i'
)
