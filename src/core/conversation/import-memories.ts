/**
 * K3 — Import LMS / Ollama (or generic chat JSON) as *memories*, not full chat dump.
 * Extracts likes / preferences / facts; skips filler and system noise.
 */

export type ImportedMemoryBundle = {
  likes: string[]
  facts: string[]
  /** How many source messages were scanned */
  scanned: number
  /** Human summary for UI */
  summary: string
}

const LIKE_RE =
  /\b(me gusta[n]?|me encanta[n]?|prefiero|odio|no me gusta|favorite|favourite|i like|i love|i prefer|i hate)\b/i

const SKIP_RE =
  /^(hola|hi|hey|ok|vale|gracias|thanks|sí|si|no|continue|sigue|test)\b/i

function pushUnique(list: string[], line: string, max: number): void {
  const t = line.replace(/\s+/g, ' ').trim().slice(0, 220)
  if (t.length < 8) return
  if (list.some((x) => x.toLowerCase() === t.toLowerCase())) return
  list.push(t)
  if (list.length > max) list.splice(0, list.length - max)
}

function extractFromUserText(text: string, likes: string[], facts: string[]): void {
  const t = (text || '').trim()
  if (!t || t.length < 12) return
  if (SKIP_RE.test(t) && t.length < 40) return
  if (LIKE_RE.test(t)) {
    pushUnique(likes, t, 40)
    return
  }
  // Personal identity / bio statements → soft facts (likes already handled above)
  if (
    t.length >= 20 &&
    /\b(me llamo|mi nombre|trabajo|vivo en|tengo \d|soy |my name|i work|i live|i am )\b/i.test(t)
  ) {
    pushUnique(facts, t, 30)
  }
}

/**
 * Accepts:
 * - LM Studio export: { messages: [{ role, content }] }
 * - Array of messages
 * - Ollama-ish { chat, messages }
 * - Kawaii conversation { messages }
 */
export function extractMemoriesFromChatExport(payload: unknown): ImportedMemoryBundle {
  const likes: string[] = []
  const facts: string[] = []
  let scanned = 0

  const messages = normalizeMessages(payload)
  for (const m of messages) {
    scanned++
    if (m.role !== 'user') continue
    extractFromUserText(m.content, likes, facts)
  }

  const summary =
    scanned === 0
      ? 'No se encontraron mensajes en el archivo.'
      : `Escaneados ${scanned} mensajes → ${likes.length} gustos/preferencias, ${facts.length} datos personales (sin volcar el chat entero).`

  return { likes, facts, scanned, summary }
}

function normalizeMessages(
  payload: unknown
): Array<{ role: string; content: string }> {
  if (!payload) return []
  if (Array.isArray(payload)) {
    return payload
      .map((m) => {
        if (!m || typeof m !== 'object') return null
        const o = m as { role?: string; content?: unknown }
        const content =
          typeof o.content === 'string'
            ? o.content
            : Array.isArray(o.content)
              ? o.content
                  .map((p) =>
                    p && typeof p === 'object' && 'text' in p
                      ? String((p as { text?: string }).text || '')
                      : ''
                  )
                  .join(' ')
              : ''
        return { role: String(o.role || 'user').toLowerCase(), content }
      })
      .filter(Boolean) as Array<{ role: string; content: string }>
  }
  if (typeof payload === 'object') {
    const o = payload as {
      messages?: unknown
      chat?: { messages?: unknown }
      conversation?: { messages?: unknown }
    }
    if (Array.isArray(o.messages)) return normalizeMessages(o.messages)
    if (o.chat && Array.isArray(o.chat.messages)) return normalizeMessages(o.chat.messages)
    if (o.conversation && Array.isArray(o.conversation.messages))
      return normalizeMessages(o.conversation.messages)
  }
  return []
}

/**
 * Merge imported memories into assistant memory shape (deduped).
 */
export function mergeImportedMemories(
  current: { likes?: string[]; facts?: string[]; favorites?: string[] } | null | undefined,
  incoming: ImportedMemoryBundle
): { likes: string[]; facts: string[]; favorites: string[] } {
  const likes = [...(current?.likes || [])]
  const facts = [...(current?.facts || [])]
  const favorites = [...(current?.favorites || [])]
  for (const l of incoming.likes) pushUnique(likes, l, 48)
  for (const f of incoming.facts) pushUnique(facts, f, 40)
  return { likes, facts, favorites }
}
