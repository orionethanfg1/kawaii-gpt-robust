/**
 * Separate model reasoning from user-visible answer (Ollama / Qwen / OpenAI practice).
 * - Ollama: message.thinking vs message.content (think: true)
 * - OpenAI-compat / LM Studio: reasoning_content | reasoning vs content
 * - Fallback: <think>…</think> or CJK/EN CoT leaked into content
 *
 * Best practice: show thinking in a collapsible UI; only put `content` in multi-turn history.
 * @see https://docs.ollama.com/capabilities/thinking
 */

import { stripCjkReasoningLeak, stripThinkingLeak } from './strip-thinking'

export type SplitThinking = {
  content: string
  thinking: string
}

const THINK_BLOCK =
  /<\s*(?:think|thinking|reasoning|redacted_reasoning)\s*>([\s\S]*?)<\s*\/\s*(?:think|thinking|reasoning|redacted_reasoning)\s*>/gi

/** Prefer API fields; else peel tags / leaked CoT from content. */
export function splitThinkingFromParts(parts: {
  content?: string | null
  thinking?: string | null
  reasoning?: string | null
  reasoning_content?: string | null
}): SplitThinking {
  let thinking = String(
    parts.thinking || parts.reasoning_content || parts.reasoning || ''
  ).trim()
  let content = String(parts.content || '').trim()

  // Tags inside content → move to thinking
  if (/<\/?think/i.test(content) || /<\/?thinking/i.test(content)) {
    const blocks: string[] = []
    content = content.replace(THINK_BLOCK, (_m, inner: string) => {
      const t = String(inner || '').trim()
      if (t) blocks.push(t)
      return ''
    })
    // unclosed <think>…eof
    content = content.replace(
      /<\s*(?:think|thinking|reasoning)\s*>([\s\S]*)$/i,
      (_m, inner: string) => {
        const t = String(inner || '').trim()
        if (t) blocks.push(t)
        return ''
      }
    )
    if (blocks.length) {
      thinking = [thinking, ...blocks].filter(Boolean).join('\n\n').trim()
    }
    content = content.trim()
  }

  // CJK / EN CoT still glued to answer
  if (!thinking) {
    const cleaned = stripThinkingLeak(content)
    if (cleaned !== content && cleaned.length < content.length) {
      // approximate: what was removed is "thinking-ish"
      const removed = content.replace(cleaned, '').trim()
      if (removed.length > 20) thinking = removed
      content = cleaned
    } else {
      content = stripCjkReasoningLeak(content)
      const again = stripThinkingLeak(content)
      if (again.length < content.length) {
        const rem = content.replace(again, '').trim()
        if (rem.length > 20) thinking = rem
        content = again
      }
    }
  } else {
    // API already split — still clean content of residual leak
    content = stripCjkReasoningLeak(stripThinkingLeak(content))
  }

  return { content: content.trim(), thinking: thinking.trim() }
}
