/**
 * Strip model "thinking" / chain-of-thought that leaked into visible content.
 * Common with Qwen3 / reasoning models when enable_thinking is ignored by the server.
 * Also strips Chinese/Japanese reasoning tails (Qwen often leaks 用户/可以/继续 in the same bubble).
 */

const THINK_TAG_RE =
  /<\s*(?:think|thinking|reasoning|reflection|redacted_reasoning)\s*>[\s\S]*?<\s*\/\s*(?:think|thinking|reasoning|reflection|redacted_reasoning)\s*>/gi

/** English (and mixed) meta-reasoning openers */
const COT_LINE_START =
  /^(okay,?\s+the user|alright,?\s+the user|the user (?:asked|wants|said|mentioned)|as \w+,?\s+i (?:need|should|must)|first,?\s+i (?:should|need|must)|let me (?:think|see|check)|hmm,?\s|wait,?\s+the (?:system|user)|i need to (?:respond|make sure|avoid)|looking at the (?:system|prompt)|based on the (?:system|instructions))/i

const COT_LINE_MID =
  /^(also,?\s+i (?:need|should)|but (?:the user|i) |wait,?\s+|so i (?:should|need)|the system message|i should make sure|keeping my personality|from my perspective as)/i

/** Chinese / CJK meta-reasoning cues (Qwen internal notes) */
const CJK_COT =
  /(?:用户|可以|继续|与他交流|给他|一些|积极|建议|提到|希望|应用|友谊|价值|观念|日常|生活|进一步|引导|思考|具体|方法|比如|分享|例子|或者|鼓励|设定|目标|请继续|根据|系统|提示)/

const CJK_CHAR = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/

/**
 * True if a paragraph looks like internal planning, not the in-character reply.
 */
export function looksLikeChainOfThought(para: string): boolean {
  const t = String(para || '').trim()
  if (!t) return false
  if (COT_LINE_START.test(t) || COT_LINE_MID.test(t)) return true
  // Structured planner dumps (Gemma / LMS reasoning as bullet "Input:/Context:")
  if (
    /^\*?\s*(Input|Context\/?State|Constraint Check|Current Document|Looking at|Instruction)\s*:/i.test(
      t
    ) ||
    /\*\s*(Input|Context\/?State|Constraint Check)\s*:/i.test(t) ||
    /\bConstraint Check\s*\(Instruction\)/i.test(t) ||
    /\bI need to look for the \*?next\*? part/i.test(t) ||
    /\[LECTURA_PROGRESIVA\]|\[DOCUMENTOS_ADJUNTS\]|\[DOCUMENTOS_ADJUNTOS\]/i.test(t)
  ) {
    return true
  }
  // Heavy English meta + no Spanish dialogue markers
  const engMeta =
    /\b(the user asked|I need to respond|personality traits|system message|chain of thought|in character|the provided snippet|already read up to)\b/i.test(
      t
    )
  const hasEs =
    /[¿¡]|(\b(hola|amor|gust[oa]|encanta|quiero|estoy|también|aquí|gracias|me alegra)\b)/i.test(t)
  if (engMeta && !hasEs && t.length > 40) return true
  // Mostly CJK = leaked reasoning from Qwen
  const cjk = (t.match(new RegExp(CJK_CHAR.source, 'g')) || []).length
  if (cjk >= 8 && CJK_COT.test(t)) return true
  if (cjk >= 12 && cjk > t.length * 0.35) return true
  return false
}

/**
 * Cut trailing or mid-bubble CJK reasoning while keeping Spanish reply.
 */
export function stripCjkReasoningLeak(text: string): string {
  let t = String(text || '')
  if (!t.trim()) return t
  // If a clear Spanish segment is followed by a CJK block, drop the CJK tail
  const idx = t.search(CJK_CHAR)
  if (idx <= 0) return t
  const before = t.slice(0, idx)
  const after = t.slice(idx)
  const cjkCount = (after.match(new RegExp(CJK_CHAR.source, 'g')) || []).length
  const hasEsBefore =
    /[¿¡áéíóúñü]/i.test(before) ||
    /\b(hola|gracias|me alegra|amor|gust[oa]|encanta|estoy|también|aquí)\b/i.test(before)
  if (hasEsBefore && cjkCount >= 6) {
    return before.replace(/[\s,;:…\-–—]+$/u, '').trim()
  }
  // Whole text dominated by CJK after a short Spanish opener
  if (cjkCount >= 10 && after.length > before.length * 0.5) {
    return before.replace(/[\s,;:…\-–—]+$/u, '').trim() || t
  }
  return t
}

/** Whole-bubble structured reasoning dump (not a companion reply). */
export function looksLikeStructuredReasoningDump(text: string): boolean {
  const t = String(text || '').trim()
  if (t.length < 40) return false
  const markers = (
    t.match(
      /(?:^|\n)\s*\*?\s*(Input|Context\/?State|Constraint Check|Current Document|Looking at)\s*:/gi
    ) || []
  ).length
  if (markers >= 2) return true
  if (markers >= 1 && /\bI need to\b/i.test(t) && !/[¿¡]/.test(t)) return true
  return false
}

/**
 * Remove thinking tags and discard CoT paragraphs; keep the real reply.
 */
export function stripThinkingLeak(text: string): string {
  let t = String(text || '')
  if (!t.trim()) return t

  if (looksLikeStructuredReasoningDump(t)) {
    // Keep nothing visible — caller should park full text in meta.thinking
    return ''
  }

  // XML-style think blocks
  t = t.replace(THINK_TAG_RE, '').trim()
  // Unclosed <think> … end
  t = t.replace(/<\s*(?:think|thinking|reasoning|redacted_reasoning)\s*>[\s\S]*$/i, '').trim()

  // CJK reasoning tail (before paragraph filter)
  t = stripCjkReasoningLeak(t)

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

  // Again after filters (CoT may have been mid-paragraph)
  t = stripCjkReasoningLeak(t)

  // If still pure English CoT, try to find first Spanish-looking segment
  if (looksLikeChainOfThought(t.slice(0, 160)) && t.length > 100) {
    const esIdx = t.search(
      /(?:^|\n)(?:¡|¿|[A-ZÁÉÍÓÚÑ][a-záéíóúñ].{8,}(?:\.|!|\?|…))/m
    )
    const speech = t.search(
      /(?:^|\n)(?:¡Hola|Hola|Ay |Bueno,|Mira,|Te cuento|Me gusta|Me encanta|Muchas gracias)/im
    )
    const cut = speech >= 0 ? speech : esIdx
    if (cut > 20) t = t.slice(cut).replace(/^\n+/, '').trim()
  }

  // Final: if still only CoT, return empty so UI can show nothing rather than the plan
  if (
    looksLikeChainOfThought(t) &&
    !/[¿¡]|\b(me gusta|me encanta|hola|amor|gracias)\b/i.test(t)
  ) {
    return ''
  }

  return t.replace(/\n{3,}/g, '\n\n').trim()
}
