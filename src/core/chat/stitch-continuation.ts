/**
 * Merge a model "continue writing" fragment onto an incomplete assistant reply.
 * Avoids mid-word splits and duplicated tails / repeated paragraphs.
 */
export function looksIncompleteAssistantText(text: string): boolean {
  const t = String(text || '').trim()
  if (!t) return false
  // Judge only the ending (last non-empty line) — mid-message «…» is stylistic, not a cut.
  const lastLine = (t.split(/\n/).filter((x) => x.trim()).pop() || t).trim()
  // Strip trailing emoji-ish / spaces without Unicode property escapes
  let core = lastLine.replace(/\s+$/u, '')
  while (core.length) {
    const cp = core.codePointAt(core.length - 1)!
    // emoji blocks + variation selectors
    if (
      cp === 0xfe0f ||
      cp === 0x200d ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x1f600 && cp <= 0x1f64f)
    ) {
      core = core.slice(0, cp > 0xffff ? -2 : -1)
      continue
    }
    if (/\s/u.test(core.slice(-1))) {
      core = core.slice(0, -1)
      continue
    }
    break
  }
  core = core.trim()
  // Trailing ellipsis / dash = cut mid-thought (must run BEFORE «complete sentence»)
  if (/\.{2,}$|…$|—$|-$/u.test(core)) return true
  if (/[,:;]$/u.test(core)) return true
  // Complete sentence (period/question/exclaim only — NOT ellipsis)
  if (/[.!?]["'»”’)\]]*$/u.test(core)) return false
  const tail = t.slice(-400)
  if (((tail.match(/"/g) || []).length % 2) === 1) return true
  if ((t.match(/«/g) || []).length > (t.match(/»/g) || []).length) return true
  if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]$/u.test(core) && !/[.!?…»"')\]]$/u.test(core)) {
    const last = core.split(/\s+/).pop() || ''
    if (last.length > 0 && last.length < 14 && !/[.!?]$/u.test(last)) return true
  }
  return false
}

/**
 * UI / auto-continue gate: only offer «Continuar escribiendo» when the cut is real.
 * Short replies that end with a soft «,» or «:» (estilo hablado) are NOT treated as
 * truncated — continuing them causes repetition and a second incoherent bubble.
 */
export function shouldOfferContinueWriting(
  text: string,
  opts?: { finishReason?: string | null; minChars?: number }
): boolean {
  const t = String(text || '').trim()
  if (!t) return false
  const minChars = opts?.minChars ?? 120
  if (t.length < minChars) return false
  if (!looksIncompleteAssistantText(t)) return false

  const lastLine = (t.split(/\n/).filter((x) => x.trim()).pop() || t).trim()
  let core = lastLine.replace(/\s+$/u, '')
  // strip trailing emoji for end check
  while (core.length) {
    const cp = core.codePointAt(core.length - 1)!
    if (
      cp === 0xfe0f ||
      cp === 0x200d ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf)
    ) {
      core = core.slice(0, cp > 0xffff ? -2 : -1)
      continue
    }
    break
  }
  core = core.trim()

  const hardCut =
    /\.{2,}$|…$/u.test(core) ||
    (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]$/u.test(core) && !/[.!?…»"')\]]$/u.test(core))
  const softCommaOnly = /[,:;]$/u.test(core) && !hardCut
  const providerLength = String(opts?.finishReason || '').toLowerCase() === 'length'

  // Soft spoken ending on a short/medium bubble → do not force a second turn
  if (softCommaOnly && !providerLength && t.length < 420) return false
  // Mid-word / ellipsis / provider length always qualify when incomplete
  if (hardCut || providerLength) return true
  // Longer incomplete (open quote, etc.)
  return t.length >= 280
}

/** Longest overlap of suffix(prev) with prefix(next), chars */
function overlapLen(a: string, b: string, max = 800): number {
  const n = Math.min(max, a.length, b.length)
  for (let len = n; len >= 8; len--) {
    if (a.slice(-len) === b.slice(0, len)) return len
  }
  const ac = a.slice(-max).replace(/\s+/g, ' ').trimEnd()
  const bc = b.slice(0, max).replace(/\s+/g, ' ').trimStart()
  for (let len = Math.min(ac.length, bc.length, max); len >= 12; len--) {
    if (ac.slice(-len).toLowerCase() === bc.slice(0, len).toLowerCase()) return len
  }
  return 0
}

/** If fragment restarts a paragraph already in prior, drop the repeated head. */
function stripRepeatedParagraphHead(prior: string, fragment: string): string {
  let f = fragment
  const paras = prior
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 40)
  for (const para of paras.slice(-4)) {
    const idx = f.indexOf(para)
    if (idx >= 0 && idx < 80) {
      f = f.slice(idx + para.length).replace(/^\s+/, '')
    }
    // fuzzy: first 60 chars of paragraph
    const head = para.slice(0, 60)
    if (head.length >= 30 && f.includes(head)) {
      const at = f.indexOf(head)
      if (at >= 0 && at < 100) {
        // jump to end of matching paragraph in fragment if possible
        const rest = f.slice(at)
        const endPara = rest.search(/\n\n/)
        if (endPara > head.length) {
          f = rest.slice(endPara).replace(/^\s+/, '')
        }
      }
    }
  }
  return f
}

/**
 * Append continuation to prior assistant text.
 */
export function stitchContinuation(prior: string, fragment: string): string {
  const p = String(prior || '')
  let f = String(fragment || '').trim()
  if (!f) return p
  f = f
    .replace(/^\[APP\][^\n]*\n?/i, '')
    .replace(/^Continuando la respuesta[^\n]*\n?/i, '')
    .replace(/^---\s*FINAL YA ESCRITO[\s\S]*?---\s*/i, '')
    .trim()
  if (!f) return p

  // Model sometimes echoes the entire prior reply
  if (p && f.startsWith(p.slice(0, Math.min(80, p.length))) && f.length >= p.length) {
    const maybe = f.slice(p.length).trim()
    if (maybe) f = maybe
  }

  f = stripRepeatedParagraphHead(p, f)

  const ov = overlapLen(p, f, Math.min(1200, Math.max(80, Math.floor(p.length / 2))))
  if (ov > 0) {
    f = f.slice(ov)
  }

  f = f.trim()
  if (!f) return p

  let pTrimEnd = p.replace(/\s+$/, '')
  // Trailing cut markers often left when the stream died mid-clause
  pTrimEnd = pTrimEnd.replace(/[,:;]\s*\.{2,}\s*\??$/u, '…').replace(/\s*\.{3,}\s*$/u, '…')

  const endsWithPartial =
    /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]$/.test(pTrimEnd) && !/[.!?…»"')\]]$/.test(pTrimEnd)
  let fragStartsLower = /^[a-záéíóúüñ]/.test(f)

  if (endsWithPartial && fragStartsLower) {
    return pTrimEnd + f
  }

  // After a closed sentence, start continuation with capital if model sent lowercase
  if (/[.!?…]\s*$/u.test(pTrimEnd) && fragStartsLower) {
    f = f.charAt(0).toUpperCase() + f.slice(1)
    fragStartsLower = false
  }

  if (/[.!?…»"')\]]$/.test(pTrimEnd)) {
    return pTrimEnd + (/^\n/.test(f) ? '' : '\n\n') + f.replace(/^\s+/, '')
  }
  if (/\s$/.test(p) || p.endsWith('\n')) {
    return p.replace(/\s+$/, p.endsWith('\n') ? '\n' : ' ') + f.replace(/^\s+/, '')
  }
  if (pTrimEnd && f) {
    if (/^[.,;:!?]/.test(f)) return pTrimEnd + f
    return pTrimEnd + (endsWithPartial ? '' : ' ') + f
  }
  return pTrimEnd + f
}

export function continuationTail(prior: string, maxChars = 700): string {
  const t = String(prior || '').trim()
  if (t.length <= maxChars) return t
  const slice = t.slice(-maxChars)
  // Prefer starting at a paragraph or sentence boundary inside the window
  const para = slice.indexOf('\n\n')
  if (para > 0 && para < maxChars / 2) {
    return slice.slice(para + 2).trim()
  }
  const m = slice.match(/[.!?…]\s+[^.?]*$/)
  if (m && m.index != null && m.index > 40) {
    // include previous sentence too when the last one is very short/incomplete
    const lastBit = slice.slice(m.index + 1).trim()
    if (lastBit.length < 80) {
      const before = slice.slice(0, m.index + 1)
      const prev = before.match(/[.!?…]\s+([^.!?…]{20,})$/)
      if (prev) return (prev[1] + ' ' + lastBit).trim()
    }
    return lastBit
  }
  const sp = slice.indexOf(' ')
  return (sp > 0 && sp < 40 ? slice.slice(sp + 1) : slice).trim()
}

/**
 * Modular continue API — single owner of continue-bubble invariants.
 * Call sites (orchestration onDone, stream paint, useChat belt, finalize)
 * MUST go through these helpers so ad-hoc string logic cannot regress again.
 */

/** Strip a frozen prior head from model output if the stream already painted it. */
export function stripPriorHead(prior: string, text: string): string {
  const p = String(prior || '').trim()
  let t = String(text || '').trim()
  if (!p || !t) return t
  const head = p.slice(0, Math.min(48, p.length))
  if (t.startsWith(head)) {
    t = t.slice(p.length).replace(/^\s+/, '')
  }
  return t
}

/**
 * Choose the pure continuation fragment from stream sources.
 * Priority: stream acc → meta content → visible UI body (after stripping prior).
 */
export function extractContinueFragment(
  prior: string,
  sources: { acc?: string; metaContent?: string; visible?: string }
): string {
  const p = String(prior || '').trim()
  const candidates = [sources.acc, sources.metaContent, sources.visible]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
  for (const c of candidates) {
    const frag = stripPriorHead(p, c)
    if (frag) return frag
  }
  return ''
}

/**
 * Build the final continued bubble content.
 * Invariant: result always starts with `prior` (or equals prior if no fragment).
 */
export function buildContinuedContent(prior: string, fragment: string): string {
  const p = String(prior || '').trim()
  const frag = stripPriorHead(p, String(fragment || ''))
  if (!p) return frag
  if (!frag) return p
  try {
    const merged = stitchContinuation(p, frag)
    if (merged.startsWith(p.slice(0, Math.min(24, p.length)))) {
      return merged.length >= p.length ? merged : p + (frag ? '\n\n' + frag : '')
    }
  } catch {
    /* fall through */
  }
  return p.replace(/\s+$/, '') + (frag ? '\n\n' + frag : '')
}

/**
 * After continueWriting completes: ensure the bubble still starts with prior
 * and grew when a fragment was produced.
 */
export function recoverContinuedBubble(
  prior: string,
  finalContent: string
): { content: string; continuedOk: boolean } {
  const p = String(prior || '').trim()
  const final = String(finalContent || '').trim()
  if (!p) return { content: final, continuedOk: final.length > 0 }
  if (!final) return { content: p, continuedOk: false }
  const head = p.slice(0, Math.min(40, p.length))
  if (!final.startsWith(head)) {
    const content = buildContinuedContent(p, final)
    return { content, continuedOk: content.length > p.length + 8 }
  }
  if (final.length < p.length + 8) {
    return { content: p, continuedOk: false }
  }
  return { content: final, continuedOk: true }
}

/**
 * postReplyFinalize guard: never replace a continuing bubble with a shorter/naked fragment.
 */
export function protectContinuedContent(
  existing: string,
  candidate: string,
  continuing: boolean
): string {
  const ex = String(existing || '').trim()
  const cand = String(candidate || '').trim()
  if (!cand) return ex || cand
  if (!ex) return cand
  if (continuing && ex.length > 40) {
    if (
      cand.length < ex.length ||
      !cand.startsWith(ex.slice(0, Math.min(24, ex.length)))
    ) {
      return ex
    }
  } else if (
    ex.length > 80 &&
    cand.length < ex.length * 0.65 &&
    !cand.startsWith(ex.slice(0, Math.min(32, ex.length)))
  ) {
    return ex
  }
  return cand
}
