/**
 * Convert a weak/English vision sheet into dense Spanish (es-MX) without an LLM.
 * Used when looksEnglishVisualDescription is true and polish LLM is unavailable.
 */

import { looksEnglishVisualDescription, sanitizeVisualDescription } from './avatar-describe'

const PHRASE: Array<[RegExp, string]> = [
  [/\bred hair\b/gi, 'cabello rojo'],
  [/\blong red hair\b/gi, 'cabello rojo largo'],
  [/\blong hair\b/gi, 'cabello largo'],
  [/\bshort hair\b/gi, 'cabello corto'],
  [/\bblack hair\b/gi, 'cabello negro'],
  [/\bbrown hair\b/gi, 'cabello castaño'],
  [/\bblonde hair\b|\bblond hair\b/gi, 'cabello rubio'],
  [/\bgreen eyes\b/gi, 'ojos verdes'],
  [/\bblue eyes\b/gi, 'ojos azules'],
  [/\bbrown eyes\b/gi, 'ojos cafés'],
  [/\bhaze?l eyes\b/gi, 'ojos avellana'],
  [/\bpale skin\b/gi, 'piel clara'],
  [/\bfair skin\b/gi, 'piel clara'],
  [/\bolive skin\b/gi, 'piel morena clara'],
  [/\bblack dress\b/gi, 'vestido negro'],
  [/\bwhite dress\b/gi, 'vestido blanco'],
  [/\bred dress\b/gi, 'vestido rojo'],
  [/\bgold brooch\b/gi, 'broche dorado'],
  [/\blooking (directly )?at the camera\b/gi, 'mirando a la cámara'],
  [/\bserious expression\b/gi, 'expresión seria'],
  [/\bsmile\b/gi, 'sonrisa'],
  [/\bupper body\b/gi, 'plano medio'],
  [/\bportrait\b/gi, 'retrato'],
  [/\bwearing\b/gi, 'lleva'],
  [/\bhas\b/gi, 'tiene'],
  [/\bshe is\b/gi, 'es'],
  [/\bshe has\b/gi, 'tiene'],
  [/\band is\b/gi, 'y'],
  [/\bon her shoulder\b/gi, 'en el hombro'],
  [/\bon her face\b/gi, 'en el rostro'],
  [/\byoung woman\b/gi, 'mujer joven'],
  [/\bwoman\b/gi, 'mujer']
]

export function englishVisualToSpanishHeuristic(
  text: string | undefined | null,
  characterName?: string
): string {
  let t = sanitizeVisualDescription(text)
  if (!t) return ''
  if (!looksEnglishVisualDescription(t) && /[áéíóúñ]/i.test(t)) {
    return t // already Spanish-ish
  }
  for (const [re, rep] of PHRASE) {
    t = t.replace(re, rep)
  }
  // Clean leftover English glue
  t = t
    .replace(/\b(the|a|an|of|with|and)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim()
  const name = (characterName || '').trim()
  if (name && !t.toLowerCase().includes(name.toLowerCase())) {
    t = `${name}: ${t}`
  }
  // Ensure minimum structure
  if (t.length < 24) return t
  if (!/[.!?]$/.test(t)) t += '.'
  return t.slice(0, 900)
}
