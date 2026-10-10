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
