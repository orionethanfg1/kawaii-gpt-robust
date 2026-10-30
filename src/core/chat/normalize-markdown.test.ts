/**
 * Pure checks for in-app Tester. Vitest: import runMarkdownNormalizeChecks from a separate suite if needed.
 * Do NOT import vitest here (breaks Electron renderer).
 */
import { preserveMdBreaks } from './normalize-markdown'
import { normalizeMarkdownForBubble } from './normalize-markdown-bubble'

export type MdCheck = { id: string; ok: boolean; detail: string }

export function runMarkdownNormalizeChecks(): MdCheck[] {
  const out: MdCheck[] = []
  try {
    const s = preserveMdBreaks('Hola **mundo** y *cursiva* aquí')
    out.push({
      id: 'preserve-bold-italic',
      ok: /\*\*mundo\*\*/.test(s) && /\*cursiva\*/.test(s),
      detail: s.slice(0, 80)
    })
  } catch (e) {
    out.push({
      id: 'preserve-bold-italic',
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    })
  }
  try {
    const s = normalizeMarkdownForBubble('Texto **fuerte** y *suave*')
    out.push({
      id: 'bubble-keeps-emphasis',
      ok: s.includes('**fuerte**') && (s.includes('*suave*') || s.includes('suave')),
      detail: s.slice(0, 80)
    })
  } catch (e) {
    out.push({
      id: 'bubble-keeps-emphasis',
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    })
  }
  try {
    const s = normalizeMarkdownForBubble('*abierto sin cierre y más texto')
    out.push({
      id: 'unbalanced-asterisk',
      ok: s.includes('abierto') && s.includes('texto'),
      detail: s.slice(0, 80)
    })
  } catch (e) {
    out.push({
      id: 'unbalanced-asterisk',
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    })
  }
  return out
}
