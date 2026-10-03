/**
 * Light prompt enrichment for cloud/panel paths (Spanish cues → quality tags).
 * Heavy identity composition lives in prompt-compose.ts.
 */
export function enhanceImagePrompt(raw: string, styleHint?: string): string {
  let p = raw.trim().replace(/\s+/g, ' ')
  if (!p) return p
  const lower = p.toLowerCase()
  const isPhoto =
    /\b(foto|photo|realista|realistic|photoreal)\b/i.test(lower) ||
    /\bfoto de\b/i.test(lower)
  const quality = isPhoto
    ? 'photorealistic, natural lighting, detailed skin, high detail, sharp focus'
    : 'masterpiece, best quality, highly detailed, clean lineart, soft lighting'

  const hints: string[] = []
  if (/\bpelirroja\b/i.test(p)) hints.push('red hair')
  if (/\bchica\b|\bmujer\b|\bgirl\b/i.test(p)) hints.push('young woman')
  if (/\bhombre\b|\bchico\b/i.test(p)) hints.push('young man')
  if (/\bgato\b/i.test(p)) hints.push('cat')
  if (/\bperro\b/i.test(p)) hints.push('dog')
  if (/\batardecer\b|\bsunset\b/i.test(p)) hints.push('sunset')

  const parts = [p]
  if (hints.length) parts.push(hints.join(', '))
  parts.push(quality)
  if (styleHint) parts.push(styleHint)
  return parts.join(', ')
}
