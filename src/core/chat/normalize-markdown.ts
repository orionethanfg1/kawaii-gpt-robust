/**
 * Soft-normalize model / user markdown so chat bubbles render italics, bold
 * and RP actions instead of raw asterisks (Gemma / roleplay style).
 */

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}❤️💕💋🔥✨🌹🥰😊😉😍🤗]/u

/**
 * Pair emphasis markers (* or _) without breaking **bold** or code fences.
 * Unpaired openers are removed; valid pairs become markdown italics.
 */
function balanceMarker(text: string, marker: '*' | '_'): string {
  const parts = text.split(/(```[\s\S]*?```)/)
  return parts
    .map((chunk) => {
      if (chunk.startsWith('```')) return chunk
      // Protect **bold** when balancing *
      const boldHold: string[] = []
      let body = chunk
      if (marker === '*') {
        body = body.replace(/\*\*([^*]+)\*\*/g, (_, inner: string) => {
          const key = `\u0000B${boldHold.length}\u0000`
          boldHold.push(`**${inner}**`)
          return key
        })
      }
      const chars = [...body]
      const out: string[] = []
      let openIdx = -1
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i]
        if (ch !== marker) {
          out.push(ch)
          continue
        }
        // Avoid matching snake_case: letter_marker_letter for _
        if (marker === '_') {
          const prev = out.length ? out[out.length - 1] : ''
          const next = i + 1 < chars.length ? chars[i + 1] : ''
          if (openIdx < 0 && /[\w]/.test(prev) && /[\w]/.test(next)) {
            out.push(ch)
            continue
          }
        }
        if (openIdx < 0) {
          openIdx = out.length
          out.push(marker)
        } else {
          out.push(marker)
          openIdx = -1
        }
      }
      if (openIdx >= 0) {
        out.splice(openIdx, 1)
      }
      let joined = out.join('')
      boldHold.forEach((b, i) => {
        joined = joined.replace(`\u0000B${i}\u0000`, b)
      })
      return joined
    })
    .join('')
}

/**
 * Heuristic: turn common RP patterns into balanced *actions*
 * e.g. lines that start with * and end without closer on the same "beat".
 */
function closeObviousActionSpans(text: string): string {
  // *action* already ok. *action at end of line without close → leave for balance strip
  // " *texto...*" with space before open is fine
  return text
}

/**
 * Strip * glued only to emoji / bare punctuation (Gemma RP noise).
 */
function stripEmojiStarNoise(s: string): string {
  let out = s
  out = out.replace(new RegExp(`\\*(\\s*)(${EMOJI_RE.source})`, 'gu'), '$1$2')
  out = out.replace(new RegExp(`(${EMOJI_RE.source})(\\s*)\\*`, 'gu'), '$1$2')
  // mí.*  or  .*Hola
  out = out.replace(/([^\s*])\*(?=[.!?…,;:])/g, '$1')
  out = out.replace(/([.!?…,;:])\*(?=\s|$|[^\w*])/g, '$1')
  return out
}

export function balanceSingleAsterisks(text: string): string {
  let s = String(text || '').replace(/\r\n/g, '\n')
  s = stripEmojiStarNoise(s)
  s = closeObviousActionSpans(s)
  // Underscore italics → asterisks (markdown-friendly) except snake_case
  s = s.replace(/(^|[^\w])_([^_\n]{1,500})_(?=[^\w]|$)/g, '$1*$2*')
  s = balanceMarker(s, '*')
  return s
}

/**
 * Full pipeline for bubble display: balance emphasis + soft line breaks + headings.
 */
export function preserveMdBreaks(text: string): string {
  let s = balanceSingleAsterisks(String(text || '').replace(/\r\n/g, '\n'))

  // Ensure space around **bold** edges if model jammed text
  s = s.replace(/([^\s*])\*\*/g, '$1 **')
  s = s.replace(/\*\*([^\s*])/g, '** $1')
  s = s.replace(/\*\* \s+/g, '**')
  s = s.replace(/\s+ \*\*/g, '**')

  // Headings: force blank line before ### so GFM picks them up
  s = s.replace(/\s*#{3,6}\s+/g, (m) => {
    const hashes = (m.match(/#/g) || []).length
    return '\n\n' + '#'.repeat(Math.min(6, Math.max(3, hashes))) + ' '
  })
  s = s.replace(/\s*#{1,2}\s+(?=[A-ZÁÉÍÓÚÑ¡¿*✨])/g, (m) => {
    const hashes = (m.match(/#/g) || []).length
    return '\n\n' + '#'.repeat(hashes) + ' '
  })

  s = s.replace(/\n{3,}/g, '\n\n')
  // Soft breaks for single newlines (markdown needs two spaces or blank line)
  s = s.replace(/([^\n])\n(?!\n|#|\||\s*[-*+]\s|\s*\d+\.\s)/g, '$1  \n')
  return s.trim()
}

/** Toolbar helper: wrap selection with markdown markers */
export function wrapMarkdownSelection(
  full: string,
  start: number,
  end: number,
  marker: '*' | '**' | '_'
): { text: string; selStart: number; selEnd: number } {
  const a = Math.max(0, Math.min(start, end))
  const b = Math.max(0, Math.max(start, end))
  const selected = full.slice(a, b)
  if (!selected) {
    const insert = marker + marker
    const text = full.slice(0, a) + insert + full.slice(b)
    return { text, selStart: a + marker.length, selEnd: a + marker.length }
  }
  if (
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    selected.length > marker.length * 2
  ) {
    const inner = selected.slice(marker.length, selected.length - marker.length)
    const text = full.slice(0, a) + inner + full.slice(b)
    return { text, selStart: a, selEnd: a + inner.length }
  }
  const wrapped = marker + selected + marker
  const text = full.slice(0, a) + wrapped + full.slice(b)
  return { text, selStart: a, selEnd: a + wrapped.length }
}
