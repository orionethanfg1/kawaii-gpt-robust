/**
 * Collapse concatenated reply restarts inside a single bubble.
 * Local models often paste 2–4 variants of the same reply.
 */

function normKey(s: string, n = 28): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[^a-z0-9áéíóúñü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n)
}

/** Insert breaks before common Spanish reply restarts. */
export function splitGluedRestarts(text: string): string {
  let t = String(text || "")
  t = t.replace(/([.!?…¿¡])\s*(?=[A-ZÁÉÍÓÚÑ¡¿])/g, "$1 ")
  t = t.replace(
    /([\u{1F300}-\u{1FAFF}])\s*(?=(?:Me|Gracias)\b)/gu,
    "$1 "
  )
  t = t.replace(
    /([a-záéíóúñ])(?=(?:Me|A m[ií])\s+(?:encanta|gusta|gustar[ií]a|fascina|apasiona))/g,
    "$1. "
  )
  t = t.replace(/([a-záéíóúñ.!?…])(?=Gracias[,\s])/g, "$1 ")
  t = t.replace(
    /([\u{1F300}-\u{1FAFF}])(?=Me\s+(?:encanta|gusta))/gu,
    "$1 "
  )
  return t
}

/**
 * Hard cut only on clear full-reply restarts:
 * second "Gracias, Name" or second "Me encanta/gusta…" after a long first block.
 * Does NOT cut on "También" / "Y claro" (normal continuation).
 */
export function cutAtSecondRestart(text: string): string {
  let t = splitGluedRestarts(String(text || ""))
  if (t.length < 60) return t

  // Gracias, Name — classic multi-variant loop (same social restart)
  const graciasRe = /Gracias[,\s]+[A-ZÁÉÍÓÚÑa-záéíóúñ]{2,24}/gi
  const gHits = [...t.matchAll(graciasRe)]
  if (gHits.length >= 2 && (gHits[1]?.index ?? 0) > 40) {
    return t.slice(0, gHits[1]!.index).trim()
  }

  // B1: cut second "Me encanta/gusta…" only if near-duplicate of the first block.
  // Distinct preferences (astronomía vs cocinar) must be kept.
  const meRe =
    /(?:^|[.!?…]\s+)((?:A m[ií] )?Me (?:encanta(?:n)?|gusta(?:ría)?|fascina|apasiona)\b)/gi
  const meHits: number[] = []
  let m: RegExpExecArray | null
  while ((m = meRe.exec(t)) !== null) {
    meHits.push(m.index)
    if (meHits.length >= 2) break
  }
  if (meHits.length >= 2 && meHits[1]! > 80) {
    const first = t.slice(meHits[0], meHits[1]).trim()
    const second = t.slice(meHits[1]).trim()
    const k1 = normKey(first, 40)
    const k2 = normKey(second, 40)
    const near =
      Boolean(k1 && k2) &&
      (k1 === k2 ||
        (k1.length >= 16 && k2.startsWith(k1.slice(0, 16))) ||
        (k2.length >= 16 && k1.startsWith(k2.slice(0, 16))) ||
        (k1.length >= 24 && k2.length >= 24 && k1.slice(0, 24) === k2.slice(0, 24)))
    if (near) return t.slice(0, meHits[1]).trim()
  }

  return t
}

export function collapseRepeatedOpeners(text: string): string {
  let t = cutAtSecondRestart(String(text || ""))
  t = splitGluedRestarts(t)
  if (t.length < 40) return t

  const chunks = t.split(
    /(?<=[.!?…])\s+|(?=\b(?:Me encanta|Me gusta|Me gustaría|A m[ií] me encanta|Gracias[,\s]))/gi
  )
  if (chunks.length < 2) return t.trim()

  const seen = new Set<string>()
  const kept: string[] = []
  for (const raw of chunks) {
    const c = raw.trim()
    if (!c) continue
    const k = normKey(c, 40)
    if (k.length < 12) {
      kept.push(c)
      continue
    }
    const words = k.split(" ").filter(Boolean)
    const opener = words.slice(0, words[0] === "me" || words[0] === "a" ? 8 : 5).join(" ")
    let dup = seen.has(opener)
    if (!dup) {
      for (const prev of seen) {
        const a = opener.slice(0, 16)
        const b = prev.slice(0, 16)
        if (a.length >= 12 && (prev.startsWith(a) || opener.startsWith(b))) {
          dup = true
          break
        }
        if (k.length >= 28 && prev.length >= 28 && k.slice(0, 28) === prev.slice(0, 28)) {
          dup = true
          break
        }
      }
    }
    if (dup) continue
    seen.add(opener)
    seen.add(k.slice(0, 36))
    kept.push(c)
  }

  return kept
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.!?…,;])/g, "$1")
    .trim()
}


/**
 * Soften repeated "¡Ay, Name!" openers within one bubble (keep first, drop later same).
 */
export function collapseAyNameOpeners(text: string, name?: string): string {
  const t = String(text || '')
  if (t.length < 20) return t
  const n = (name || '').trim()
  const re = n
    ? new RegExp(
        `(?:^|\\n)\\s*¡?\\s*Ay[,\\s]+${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[!！]?\\s*`,
        'gi'
      )
    : /(?:^|\n)\s*¡?\s*Ay[,\s]+[A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]{1,24}\s*[!！]?\s*/gi
  let count = 0
  return t.replace(re, (m) => {
    count += 1
    if (count === 1) return m
    return m.replace(/¡?\s*Ay[,\s]+[\wáéíóúñ'-]+\s*[!！]?\s*/i, '')
  })
}



/** Any leading ¡Ay, Name! / Ay, Name! (user name, not character) */
export function matchLeadingAyName(text: string, _name?: string): RegExpMatchArray | null {
  // Character name is irrelevant — models say "¡Ay, Nahum!" (user), not the avatar name.
  const re =
    /^\s*¡?\s*Ay[,\s]+[A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]{1,28}\s*[!！]?\s*(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*)?/iu
  return String(text || '').match(re)
}

/**
 * If this reply AND the previous assistant both open with ¡Ay, Name!,
 * strip the opener from this one so the chat does not feel scripted.
 */
export function dedupeAyOpenersAcrossTurns(
  text: string,
  opts?: {
    characterName?: string
    previousAssistant?: string
    /** Up to a few prior assistant texts (newest first) */
    recentAssistants?: string[]
    userName?: string
  }
): string {
  let t = String(text || '')
  const prev = String(opts?.previousAssistant || '')
  const thisLead = matchLeadingAyName(t)
  const prevLead = matchLeadingAyName(prev)
  const recent = opts?.recentAssistants || []
  let recentAy = 0
  for (const r of recent.slice(0, 4)) {
    if (matchLeadingAyName(r)) recentAy += 1
  }
  // CV1: if previous opened with Ay, or 2+ of last replies did, strip this opener
  if (thisLead && (prevLead || recentAy >= 2)) {
    t = t.slice(thisLead[0].length)
    t = t.replace(/^\s*([a-záéíóúñ])/, (_m, c: string) => c.toUpperCase())
  }
  // Also collapse repeated ¡Ay inside the same bubble
  return collapseAyNameOpeners(t, opts?.userName || opts?.characterName)
}


/** Convivencia 14B — if this reply starts with the same sentence as the previous, drop it. */
export function dedupeLeadingSentenceAcrossTurns(
  text: string,
  previousAssistant?: string
): string {
  let t = String(text || '').trim()
  const prev = String(previousAssistant || '').trim()
  if (!t || !prev) return t
  const first = (s: string) => {
    const m = s.match(/^(.{12,120}?[.!?…])(?:\s|$)/)
    return (m ? m[1] : s.slice(0, 80))
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[¡!¿?]/g, '')
      .trim()
  }
  const a = first(t)
  const b = first(prev)
  if (a.length >= 16 && b.length >= 16 && (a === b || a.startsWith(b.slice(0, 24)) || b.startsWith(a.slice(0, 24)))) {
    // drop first sentence
    const cut = t.search(/[.!?…](\s|$)/)
    if (cut > 12 && cut < t.length - 8) {
      t = t.slice(cut + 1).trim()
      t = t.replace(/^([a-záéíóúñ])/, (_m, c: string) => c.toUpperCase())
    }
  }
  return t
}
