/**
 * Normalize model text so ReactMarkdown / GFM renders bold, italic, lists reliably.
 */
import { balanceSingleAsterisks, preserveMdBreaks as softBreaks } from './normalize-markdown'

/**
 * Soft-normalize markdown for chat bubbles (Spanish + roleplay friendly).
 */
export function normalizeMarkdownForBubble(src: string): string {
  let t = String(src || '')
  if (!t.trim()) return t

  t = t.replace(/\r\n/g, '\n')

  // ** bold ** → **bold**
  t = t.replace(/\*\*\s+([^*]+?)\s+\*\*/g, '**$1**')
  t = t.replace(/__\s*([^_]+?)\s*__/g, '**$1**')
  t = t.replace(/\*\*([^*\n]+)\*$/gm, '**$1**')

  // * italic * with spaces → *italic*
  t = t.replace(/(^|[^*\w])\*\s+([^*\n]+?)\s+\*(?=[^*\w]|$)/g, '$1*$2*')

  // Balance unpaired * / _ so the whole bubble does not stay italic
  t = balanceSingleAsterisks(t)

  t = t.replace(/([^\n])\n(#{1,3}\s)/g, '$1\n\n$2')
  t = t.replace(/^(\s*[-*+])(\S)/gm, '$1 $2')
  t = t.replace(/^(\s*\d+\.)(\S)/gm, '$1 $2')
  t = t.replace(/^(#{1,6})([^\s#])/gm, '$1 $2')

  return t
}

export function hasMarkdownMarkers(src: string): boolean {
  const t = String(src || '')
  return /(\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_|^#{1,3}\s|^\s*[-*+]\s|^\s*\d+\.\s|```)/m.test(
    t
  )
}

/** Alias for tests / callers that want full soft-break path */
export function normalizeAndPreserveMarkdown(src: string): string {
  return softBreaks(normalizeMarkdownForBubble(src))
}
