/**
 * Strip model "thinking" / chain-of-thought that leaked into visible content.
 * Common with Qwen3 / reasoning models when enable_thinking is ignored by the server.
 */

const THINK_TAG_RE =
  /<\s*(?:think|thinking|reasoning|reflection)\s*>[\s\S]*?<\s*\/\s*(?:think|thinking|reasoning|reflection)\s*>/gi

/** English (and mixed) meta-reasoning openers */
const COT_LINE_START =
  /^(okay,?\s+the user|alright,?\s+the user|the user (?:asked|wants|said|mentioned)|as \w+,?\s+i (?:need|should|must)|first,?\s+i (?:should|need|must)|let me (?:think|see|check)|hmm,?\s|wait,?\s+the (?:system|user)|i need to (?:respond|make sure|avoid)|looking at the (?:system|prompt)|based on the (?:system|instructions))/i

const COT_LINE_MID =
  /^(also,?\s+i (?:need|should)|but (?:the user|i) |wait,?\s+|so i (?:should|need)|the system message|i should make sure|keeping my personality|from my perspective as)/i

/**
 * True if a paragraph looks like internal planning, not the in-character reply.
 */
export function looksLikeChainOfThought(para: string): boolean {
  const t = String(para || '').trim()
  if (!t) return false
  if (COT_LINE_START.test(t) || COT_LINE_MID.test(t)) return true
  // Heavy English meta + no Spanish dialogue markers
  const engMeta =
    /\b(the user asked|I need to respond|personality traits|system message|chain of thought|in character)\b/i.test(
      t
    )
  const hasEs =
    /[¿¡]|(\b(hola|amor|gust[oa]|encanta|quiero|estoy|también|aquí)\b)/i.test(t)
  if (engMeta && !hasEs && t.length > 40) return true
  return false
}

/**
 * Remove thinking tags and discard CoT paragraphs; keep the real reply.
 */
export function stripThinkingLeak(text: string): string {
  let t = String(text || '')
  if (!t.trim()) return t

  // XML-style think blocks
  t = t.replace(THINK_TAG_RE, '').trim()
  // Unclosed <think> … end
  t = t.replace(/<\s*(?:think|thinking|reasoning)\s*>[\s\S]*$/i, '').trim()

  // Split paragraphs
  const parts = t.split(/\n{2,}/)
  if (parts.length >= 2) {
    const kept = parts.filter((p) => !looksLikeChainOfThought(p))
    if (kept.length) t = kept.join('\n\n').trim()
  } else {
    // Single blob: drop leading CoT sentences
    const lines = t.split(/\n/)
    const keptLines: string[] = []
    let sawReal = false
    for (const line of lines) {
      const isCot = looksLikeChainOfThought(line) || looksLikeChainOfThought(line.slice(0, 120))
      if (!sawReal && isCot) continue
      if (!isCot) sawReal = true
      if (sawReal) keptLines.push(line)
    }
    if (keptLines.length) t = keptLines.join('\n').trim()
  }

  // If still pure English CoT, try to find first Spanish-looking segment
  if (looksLikeChainOfThought(t.slice(0, 160)) && t.length > 100) {
    const esIdx = t.search(
      /(?:^|\n)(?:¡|¿|[A-ZÁÉÍÓÚÑ][a-záéíóúñ].{8,}(?:\.|!|\?|…))/m
    )
    // Prefer a line that starts with typical character speech
    const speech = t.search(
      /(?:^|\n)(?:¡Hola|Hola|Ay |Bueno,|Mira,|Te cuento|Me gusta|Me encanta)/im
    )
    const cut = speech >= 0 ? speech : esIdx
    if (cut > 20) t = t.slice(cut).replace(/^\n+/, '').trim()
  }

  // Final: if still only CoT, return empty so UI can show nothing rather than the plan
  if (looksLikeChainOfThought(t) && !/[¿¡]|\b(me gusta|me encanta|hola|amor)\b/i.test(t)) {
    return ''
  }

  return t.replace(/\n{3,}/g, '\n\n').trim()
}
