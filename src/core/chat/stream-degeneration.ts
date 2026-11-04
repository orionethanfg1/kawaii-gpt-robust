/**
 * R0 — Client-side stream degeneration / plan-leak detector.
 * Abort early so LMS token loops and instruction dumps never stick in the bubble.
 */

export type DegenerateReason =
  | 'char_loop'
  | 'ngram_loop'
  | 'plan_leak'
  | 'reasoning_dump'
  | 'empty_after_strip'

export type DegenerateVerdict =
  | { ok: true }
  | { ok: false; reason: DegenerateReason; detail?: string }

/** Same printable char repeated many times (/////, ????, …). */
export function detectCharLoop(text: string, minRun = 48): DegenerateVerdict {
  const t = String(text || '')
  if (t.length < minRun) return { ok: true }
  // Fast path: last window is almost one character
  const tail = t.slice(-Math.min(200, t.length))
  const m = tail.match(/(.)\1{40,}/)
  if (m) {
    return { ok: false, reason: 'char_loop', detail: `run of '${m[1]}'` }
  }
  // Whole-text ratio: one char dominates
  if (t.length >= 80) {
    const counts = new Map<string, number>()
    for (const ch of t) {
      if (/\s/.test(ch)) continue
      counts.set(ch, (counts.get(ch) || 0) + 1)
    }
    let best = 0
    let bestCh = ''
    for (const [ch, n] of counts) {
      if (n > best) {
        best = n
        bestCh = ch
      }
    }
    const nonSpace = t.replace(/\s/g, '').length
    if (nonSpace >= 60 && best / nonSpace >= 0.55 && /[\/\\|?·.•*_=#-]/.test(bestCh)) {
      return { ok: false, reason: 'char_loop', detail: `dominated by '${bestCh}'` }
    }
  }
  return { ok: true }
}

/** Short n-gram repeated (token stutter). */
export function detectNgramLoop(text: string): DegenerateVerdict {
  const t = String(text || '')
  if (t.length < 60) return { ok: true }
  const tail = t.slice(-Math.min(400, t.length))
  for (const n of [12, 16, 24, 32]) {
    if (tail.length < n * 4) continue
    const gram = tail.slice(-n)
    if (!gram.trim() || /^[\s/\\|*._-]+$/.test(gram)) continue
    let hits = 0
    let idx = 0
    while (idx <= tail.length - n) {
      if (tail.slice(idx, idx + n) === gram) {
        hits++
        idx += n
      } else {
        idx++
      }
    }
    if (hits >= 4) {
      return { ok: false, reason: 'ngram_loop', detail: `n=${n}×${hits}` }
    }
  }
  return { ok: true }
}

/**
 * Model dumping English planner / system rules into the user-visible channel
 * (seen with Gemma + LMS when thinking leaks or context is overloaded).
 */
export function detectPlanLeak(text: string): DegenerateVerdict {
  const t = String(text || '')
  if (t.length < 40) return { ok: true }

  const planPatterns: RegExp[] = [
    /\bAsk what (did you|do you)\b/i,
    /\bShow curiosity\b/i,
    /\bAlso maybe respond with\b/i,
    /\bOk produce response in\b/i,
    /\bproduce response in Spanish\b/i,
    /\bUse ["']tú["']\b/i,
    /\bBut instructions say never\b/i,
    /\binstructions say never\b/i,
    /\bwe are singular female\b/i,
    /\bMexican Spanish style\b/i,
    /\bConstraint Check\b/i,
    /\bCurrent Document\b/i,
    /\bI need to look for the\b/i,
    /\bKeeping my personality\b/i,
    /\bthe system (message|prompt|instructions)\b/i,
    /\bFirst,?\s+I (should|need|must)\b/i,
    /\bAlright,?\s+the user\b/i,
    /\bOkay,?\s+the user\b/i,
    /\bAs (?:an? )?\w+,?\s+I need to respond\b/i
  ]

  let hits = 0
  for (const re of planPatterns) {
    if (re.test(t)) hits++
  }
  // Strong single signals
  if (
    /\bOk produce response in\b/i.test(t) ||
    /\bShow curiosity and admiration\b/i.test(t) ||
    (/\bAsk what did you do\b/i.test(t) && /\bUse ["']tú["']/i.test(t))
  ) {
    return { ok: false, reason: 'plan_leak', detail: 'strong planner dump' }
  }
  if (hits >= 2) {
    return { ok: false, reason: 'plan_leak', detail: `patterns=${hits}` }
  }
  // English meta block with almost no Spanish dialogue
  const engMeta =
    /\b(the user asked|I need to respond|personality traits|system message|produce response|instructions say)\b/i.test(
      t
    )
  const hasEs =
    /[¿¡]/.test(t) ||
    /\b(hola|amor|gracias|estoy|también|aquí|me alegra|princesa|cariño)\b/i.test(t)
  if (engMeta && !hasEs && t.length > 80 && hits >= 1) {
    return { ok: false, reason: 'plan_leak', detail: 'english meta without ES reply' }
  }
  return { ok: true }
}

/** Full check used mid-stream and on finalize. */
export function detectStreamDegeneration(text: string): DegenerateVerdict {
  const t = String(text || '')
  if (!t.trim()) return { ok: true }

  const a = detectCharLoop(t)
  if (!a.ok) return a
  const b = detectNgramLoop(t)
  if (!b.ok) return b
  const c = detectPlanLeak(t)
  if (!c.ok) return c

  return { ok: true }
}

/** True when visible text after strip is unusable for the user. */
export function isUnusableAssistantVisible(
  raw: string,
  stripped: string
): DegenerateVerdict {
  const r = String(raw || '')
  const s = String(stripped || '').trim()
  const deg = detectStreamDegeneration(r)
  if (!deg.ok) return deg
  const degS = detectStreamDegeneration(s)
  if (!degS.ok) return degS
  // Raw was long but strip removed almost everything → reasoning dump
  if (r.trim().length >= 80 && s.length < 12) {
    return { ok: false, reason: 'empty_after_strip', detail: `raw=${r.length} stripped=${s.length}` }
  }
  return { ok: true }
}
