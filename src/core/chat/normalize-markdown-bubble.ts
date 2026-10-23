/**
 * Normalize model text so ReactMarkdown / GFM renders bold, italic, lists reliably.
 * Does not invent structure — only repairs common local-LLM quirks.
 */

/**
 * Soft-normalize markdown for chat bubbles (Spanish + roleplay friendly).
 */
export function normalizeMarkdownForBubble(src: string): string {
  let t = String(src || '')
  if (!t.trim()) return t

  // Normalize line endings
  t = t.replace(/\r\n/g, '\n')

  // ** bold ** → **bold**
  t = t.replace(/\*\*\s+([^*]+?)\s+\*\*/g, '**$1**')
  // __ bold __ → **bold**
  t = t.replace(/__\s*([^_]+?)\s*__/g, '**$1**')

  // Unbalanced trailing ** at EOL after opening
  t = t.replace(/\*\*([^*\n]+)\*$/gm, '**$1**')

  // * italic * with spaces → *italic*
  t = t.replace(/(^|[^*\w])\*\s+([^*\n]+?)\s+\*(?=[^*\w]|$)/g, '$1*$2*')

  // Ensure blank line before headings that models stick to previous paragraph
  t = t.replace(/([^\n])\n(#{1,3}\s)/g, '$1\n\n$2')

  // Lists: "-item" → "- item"
  t = t.replace(/^(\s*[-*+])(\S)/gm, '$1 $2')
  t = t.replace(/^(\s*\d+\.)(\S)/gm, '$1 $2')

  // Convert lone ### headers glued without space
  t = t.replace(/^(#{1,6})([^\s#])/gm, '$1 $2')

  return t
}

/**
 * True if text has markdown emphasis markers worth running through ReactMarkdown.
 */
export function hasMarkdownMarkers(src: string): boolean {
  const t = String(src || '')
  return /(\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_|^#{1,3}\s|^\s*[-*+]\s|^\s*\d+\.\s|```)/m.test(
    t
  )
}
