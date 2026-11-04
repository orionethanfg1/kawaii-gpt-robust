/**
 * LMS / JSON parsers reject lone UTF-16 surrogates (e.g. "\\ud83d" without low pair).
 * Strip or replace them before JSON.stringify to the local server.
 */

export function sanitizeLoneSurrogates(input: string): string {
  if (!input) return input
  let out = ''
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    // High surrogate
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i] + input[i + 1]
        i++
      } else {
        // lone high — drop
        out += ''
      }
      continue
    }
    // Lone low surrogate
    if (c >= 0xdc00 && c <= 0xdfff) {
      continue
    }
    out += input[i]
  }
  return out
}

export function sanitizeJsonValueDeep<T>(value: T): T {
  if (typeof value === 'string') return sanitizeLoneSurrogates(value) as T
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeJsonValueDeep(v)) as T
  }
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      o[k] = sanitizeJsonValueDeep(v)
    }
    return o as T
  }
  return value
}

/** Emoji field: only keep if valid complete code points */
export function sanitizeEmojiField(raw: string | undefined | null): string {
  if (!raw) return ''
  const s = sanitizeLoneSurrogates(String(raw).trim())
  if (!s) return ''
  // Reject if any remaining lone-surrogate pattern slipped through
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)) {
    return ''
  }
  return s.slice(0, 8)
}
