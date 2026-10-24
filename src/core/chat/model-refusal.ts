/**
 * Soft detection of policy / safety refusals from local or cloud chat models.
 * Heuristic only — used for optional UX tips (catalog), not hard blocks.
 */

export type ModelRefusalHit = {
  refused: boolean
  /** Confidence 0–1 from pattern strength */
  confidence: number
  reason: string
}

const STRONG = [
  /\bno puedo (ayudar|asistir|continuar|cumplir|generar|escribir|hablar)\b/i,
  /\bno estoy (autorizad[oa]|permitid[oa]|diseñad[oa])\b/i,
  /\bas an ai\b/i,
  /\bi('m| am) (an ai|not able|unable|sorry,? but i can'?t)\b/i,
  /\bi cannot (assist|help|provide|comply)\b/i,
  /\bagainst (my|our) (guidelines|policies|programming)\b/i,
  /\bpol[ií]ticas? de (uso|seguridad|contenido)\b/i,
  /\bcontenido (no permitido|prohibido|inapropiado)\b/i,
  /\bme temo que no puedo\b/i,
  /\blo siento,? pero no puedo\b/i,
  /\brefuse(d)? to (answer|comply|engage)\b/i
]

const SOFT = [
  /\bno es apropiado\b/i,
  /\bfuera de (mis|los) l[ií]mites\b/i,
  /\bpreferir[ií]a no\b/i,
  /\bcambio de tema\b/i,
  /\bi must decline\b/i,
  /\bnot appropriate\b/i
]

export function detectModelRefusal(text: string): ModelRefusalHit {
  const t = String(text || '').trim()
  if (t.length < 12) return { refused: false, confidence: 0, reason: 'too_short' }

  let hits = 0
  for (const re of STRONG) {
    if (re.test(t)) hits += 2
  }
  for (const re of SOFT) {
    if (re.test(t)) hits += 1
  }

  // Long helpful answers with a mild phrase are not refusals
  if (t.length > 600 && hits < 3) {
    return { refused: false, confidence: 0.1, reason: 'long_mixed' }
  }

  if (hits >= 2) {
    return {
      refused: true,
      confidence: Math.min(1, hits / 4),
      reason: 'pattern'
    }
  }
  return { refused: false, confidence: hits / 4, reason: 'none' }
}
