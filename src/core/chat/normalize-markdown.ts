/**
 * Soft-normalize model / user markdown so chat bubbles render italics, bold
 * and RP actions instead of raw asterisks (Gemma / roleplay style).
 *
 * RP convention (common in companion chats):
 * - *acciones / narración* en cursiva
 * - "diálogo" o — diálogo en texto normal
 * - No mezclar sin cerrar * (rompe todo el resto del mensaje)
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
        if (marker === '_') {
          const prev = out.length ? out[out.length - 1] : ''
          const next = i + 1 < chars.length ? chars[i + 1] : ''
          if (openIdx < 0 && /[\w]/.test(prev) && /[\w]/.test(next)) {
            out.push(ch)
            continue
          }
        }
        // Leftover ** pair (bold not captured): emit both, do not open italic
        if (marker === '*' && chars[i + 1] === '*') {
          out.push('*', '*')
          i++
          continue
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
        // Unclosed: drop the opener so the rest of the bubble is not italic forever
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
 * RP hygiene before balancing:
 * - Close action spans that end before em-dash dialogue
 * - Split glued *action*— "dialogue"
 * - Drop * glued only to emoji
 */
function normalizeRpAsterisks(text: string): string {
  let s = String(text || '').replace(/\r\n/g, '\n')

  // *acción larga.* — diálogo  → ensure closer before em dash
  s = s.replace(/\*([^*\n]{2,800}?)\.\s*\*\s*[—–]\s*/g, '*$1.* — ')
  s = s.replace(/\*([^*\n]{2,800}?)\.\s*[—–]\s*/g, '*$1.* — ')

  // *acción* — "diálogo" already fine; ensure space after —
  s = s.replace(/[—–]\s*"/g, '— "')

  // Line starts with * but never closes before next *action* or blank line
  // (leave to balanceMarker)

  // * glued to emoji only
  s = s.replace(new RegExp(`\\*(\\s*)(${EMOJI_RE.source})`, 'gu'), '$1$2')
  s = s.replace(new RegExp(`(${EMOJI_RE.source})(\\s*)\\*`, 'gu'), '$1$2')

  // Orphan * before punctuation (mí.*  or  .*Hola)
  s = s.replace(/([^\s*])\*(?=[.!?…,;:])/g, '$1')
  s = s.replace(/([.!?…,;:])\*(?=\s|$|[^\w*])/g, '$1')

  // Triple+ asterisks → bold or strip
  s = s.replace(/\*{4,}/g, '**')

  return s
}

/**
 * Balance per paragraph so one broken * does not italicize the whole message.
 */
function balancePerParagraph(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => balanceMarker(balanceMarker(para, '*'), '_'))
    .join('\n\n')
}

export function balanceSingleAsterisks(text: string): string {
  let s = normalizeRpAsterisks(String(text || '').replace(/\r\n/g, '\n'))
  // Underscore italics → asterisks except snake_case
  s = s.replace(/(^|[^\w])_([^_\n]{1,500})_(?=[^\w]|$)/g, '$1*$2*')
  s = balancePerParagraph(s)
  return s
}

/**
 * Full pipeline for bubble display: balance emphasis + soft line breaks + headings.
 */
export function preserveMdBreaks(text: string): string {
  let s = balanceSingleAsterisks(String(text || '').replace(/\r\n/g, '\n'))

  // **bold** must stay tight — inserting spaces around ** breaks GFM
  // Only fix jammed word**word → word **word when clearly outside a pair
  s = s.replace(/([A-Za-zÁÉÍÓÚáéíóúñÑ0-9])\*\*(?=[A-Za-zÁÉÍÓÚáéíóúñÑ])/g, '$1 **')

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
  // Soft breaks for single newlines
  s = s.replace(/([^\n])\n(?!\n|#|\||\s*[-*+]\s|\s*\d+\.\s)/g, '$1  \n')
  // GFM: protect intentional emphasis — ensure *word* has non-space inside
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
  return {
    text,
    selStart: a + marker.length,
    selEnd: a + marker.length + selected.length
  }
}
