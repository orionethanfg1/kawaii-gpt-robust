/**
 * Final identity prompt gate — one hair color/style family, DNA wins.
 * Call immediately before Forge so LLM + tags cannot ship contradictions.
 */
import {
  appearanceToIdentityTags,
  stripConflictingIdentityFromPrompt
} from './identity-profile'

export type IdentityPromptAssertResult = {
  ok: boolean
  positive: string
  issues: string[]
}

function normalizeColor(tag: string): string {
  const t = tag.toLowerCase()
  if (/blonde|blond|platinum/.test(t)) return 'blonde hair'
  if (/brown|brunette/.test(t)) return 'brown hair'
  if (/black/.test(t)) return 'black hair'
  if (/red|redhead/.test(t)) return 'red hair'
  if (/white|gray|grey|silver/.test(t)) return 'gray hair'
  return t.replace(/\blong\s+/g, '').trim()
}

function normalizeStyle(tag: string): string {
  const t = tag.toLowerCase()
  if (/curly/.test(t)) return 'curly hair'
  if (/straight/.test(t)) return 'straight hair'
  if (/wavy/.test(t)) return 'wavy hair'
  return t
}

const COLOR_WORDS = ['blonde', 'blond', 'brown', 'black', 'red', 'brunette', 'platinum', 'silver']
const STYLE_WORDS = ['curly', 'straight', 'wavy']

/** Prefer DNA tags; drop every other hair color/style mention in the final positive. */
export function assertIdentityPromptConsistency(
  positive: string,
  appearanceSummary?: string | null,
  hairNotes?: string | null
): IdentityPromptAssertResult {
  const issues: string[] = []
  let s = String(positive || '')
  const dna = appearanceToIdentityTags(
    [appearanceSummary || '', hairNotes || ''].filter(Boolean).join(', ')
  )
  const lockedColor = dna
    .map(normalizeColor)
    .find((t) => /hair$/.test(t) && !/curly|straight|wavy/.test(t))
  const lockedStyle = dna
    .map(normalizeStyle)
    .find((t) => /^(curly|straight|wavy)\s+hair$/.test(t))

  if (dna.length) {
    const { cleaned, stripped } = stripConflictingIdentityFromPrompt(s, dna)
    if (stripped.length) {
      issues.push(...stripped.map((x) => 'strip:' + x))
      s = cleaned
    }
  }

  // Drop every hair-color token that is not the locked DNA color
  if (lockedColor) {
    const keep = lockedColor.split(/\s+/)[0] // brown / blonde / black…
    for (const w of COLOR_WORDS) {
      if (w === keep || (keep === 'blonde' && w === 'blond')) continue
      if (keep === 'brown' && w === 'brunette') continue
      const plain = new RegExp('\\b' + w + '\\s+hair\\b', 'gi')
      const weighted = new RegExp(
        '\\(\\s*(?:long\\s+)?' + w + '\\s+hair\\s*:[^)]+\\)',
        'gi'
      )
      const before = s
      s = s.replace(weighted, ' ').replace(plain, ' ')
      if (s !== before) issues.push('hair_color_conflict:' + w)
    }
    if (!new RegExp(lockedColor.replace(/\s+/g, '\\s+'), 'i').test(s)) {
      s = '(' + lockedColor + ':1.45), ' + s
      issues.push('injected:' + lockedColor)
    }
  }

  if (lockedStyle) {
    const keep = lockedStyle.split(/\s+/)[0]
    for (const w of STYLE_WORDS) {
      if (w === keep) continue
      const plain = new RegExp('\\b' + w + '\\s+hair\\b', 'gi')
      const weighted = new RegExp('\\(\\s*' + w + '\\s+hair\\s*:[^)]+\\)', 'gi')
      const before = s
      s = s.replace(weighted, ' ').replace(plain, ' ')
      if (s !== before) issues.push('hair_style_conflict:' + w)
    }
    if (!new RegExp(lockedStyle.replace(/\s+/g, '\\s+'), 'i').test(s)) {
      s = '(' + lockedStyle + ':1.45), ' + s
      issues.push('injected:' + lockedStyle)
    }
  }

  s = s
    .replace(/\(\s*:[^)]*\)/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^,\s*|,\s*$/g, '')
    .trim()

  const ok = !issues.some((i) => /conflict/.test(i))
  return { ok, positive: s, issues }
}
