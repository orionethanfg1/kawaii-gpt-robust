import { cutAtSecondRestart, collapseRepeatedOpeners } from "./collapse-openers"

/**
 * Collapse loop-y assistant text from small local models
 * (same idea / canned phrase repeated 2-4x in one bubble).
 */

function keyOf(s: string, n = 96): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .trim()
    .slice(0, n)
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Drop near-duplicate paragraphs (order preserved). */
export function collapseRepeatedParagraphs(text: string): string {
  const raw = String(text || '')
  if (raw.length < 40) return raw
  let paras = raw.split(/\n{2,}/)
  if (paras.length < 2) {
    const lines = raw
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length >= 2) paras = lines
  }
  if (paras.length < 2) return collapseRepeatedSentences(raw)

  const seen = new Set<string>()
  const kept: string[] = []
  for (const p of paras) {
    const k = keyOf(p)
    if (k.length < 20 && !/hola|hey|amor|buenas/i.test(k)) {
      kept.push(p)
      continue
    }
    let dup = seen.has(k)
    if (!dup) {
      for (const prev of seen) {
        if (k.includes(prev.slice(0, 40)) || prev.includes(k.slice(0, 40))) {
          dup = true
          break
        }
        if (k.slice(0, 18) === prev.slice(0, 18) && k.length >= 18) {
          dup = true
          break
        }
      }
    }
    if (dup) continue
    seen.add(k)
    kept.push(p)
  }
  return collapseRepeatedSentences(kept.join('\n\n'))
}

/** Drop near-duplicate sentences inside a block. */
export function collapseRepeatedSentences(text: string): string {
  const raw = String(text || '')
  if (raw.length < 80) return raw
  const parts = raw.split(/(?<=[.!?…])\s+/)
  if (parts.length < 3) return raw

  const seen = new Set<string>()
  const kept: string[] = []
  for (const s of parts) {
    const k = keyOf(s, 72)
    if (k.length < 20 && !/hola|amor|hey/i.test(k)) {
      kept.push(s)
      continue
    }
    if (seen.has(k)) continue
    let dup = false
    for (const prev of seen) {
      if (k.slice(0, 28) === prev.slice(0, 28)) {
        dup = true
        break
      }
    }
    if (dup) continue
    seen.add(k)
    kept.push(s)
  }
  return kept.join(' ')
}

/**
 * Remove mid-message Name: restarts (model pretending to start a new turn).
 */
export function collapseSpeakerRestarts(text: string, name?: string): string {
  let t = String(text || '')
  if (!t.trim()) return t
  const n = (name || '').trim()
  if (n.length >= 2) {
    const re = new RegExp(
      '(?:^|\n)\\s*(?:\\*\\*)?' + escapeReg(n) + '(?:\\*\\*)?\\s*:\\s*',
      'gi'
    )
    let count = 0
    t = t.replace(re, (m) => {
      count += 1
      return count === 1 ? m : '\n'
    })
  }
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Aggressively cut mid-bubble greeting restarts.
 * Handles: "…juntos.¡Hola de nuevo, Nahum!" (no newline).
 * Strategy: if ≥2 greeting openings, keep only text before the 2nd.
 */
export function collapseRepeatedHolaBlocks(text: string): string {
  let t = String(text || '')
  if (t.length < 30) return t

  // Normalize: force a boundary before mid-text "¡Hola" / "Hola de nuevo"
  t = t.replace(/([^\n\s])(¡\s*Hola\b)/gi, '$1\n$2')
  t = t.replace(/([.!?…»])\s*(¡?\s*Hola\b)/gi, '$1\n$2')

  // Greeting openings: Hola / Hola de nuevo / ¡Hola …
  const greetRe = /¡?\s*Hola(?:\s+de\s+nuevo)?\b/gi
  const matches: { index: number; len: number }[] = []
  let m: RegExpExecArray | null
  while ((m = greetRe.exec(t)) !== null) {
    matches.push({ index: m.index, len: m[0].length })
  }
  if (matches.length < 2) return t.replace(/\n{3,}/g, '\n\n').trim()

  // Keep everything before the second greeting
  const cut = matches[1].index
  if (cut > 15) {
    t = t.slice(0, cut).trim()
  }
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

/** Full cleanup for a finished assistant bubble. */
export function collapseLoopAssistantText(
  text: string,
  name?: string,
  maxSentences?: number
): string {
  let t = cutAtSecondRestart(text)
  t = collapseSpeakerRestarts(t, name)
  // Hola first — catches concatenated restarts before paragraph logic
  t = collapseRepeatedHolaBlocks(t)
  t = collapseRepeatedParagraphs(t)
  t = collapseRepeatedHolaBlocks(t)

  // Keep at most one invitation / soft-CTA question
  const invRe =
    /¿\s*(?:Quieres|Te gustaría|Tú tienes|Hay algo que(?:\s+\w+){0,6}\s+guste)[^?]{0,160}\?/gi
  let seenInv = 0
  t = t.replace(invRe, (m) => {
    seenInv += 1
    return seenInv === 1 ? m : ""
  })

  const howRe = /¿\s*Cómo estás\??/gi
  let seenHow = 0
  t = t.replace(howRe, (m) => {
    seenHow += 1
    return seenHow === 1 ? m : ""
  })

  const graciasRe = /Gracias[,\s]+[A-ZÁÉÍÓÚÑa-záéíóúñ]{2,24}/gi
  const gHits = [...t.matchAll(graciasRe)]
  if (gHits.length >= 2 && (gHits[1]?.index ?? 0) > 40) {
    t = t.slice(0, gHits[1]!.index).trim()
  }

  const lines = t.split('\n')
  const lineKeys = new Set<string>()
  const greetingKeys = new Set<string>()
  const keptLines: string[] = []
  for (const line of lines) {
    const normalized = line
      .replace(/\s+/g, ' ')
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
      .trim()
      .toLowerCase()
    const k = normalized.slice(0, 60)
    const isGreet = /^(¡?\s*)?(hola|hey|buenas)/i.test(normalized)
    const greetKey = isGreet
      ? normalized.replace(/[^a-záéíóúñ\s]/gi, '').slice(0, 40)
      : ''
    if (greetKey && greetingKeys.has(greetKey)) continue
    if (greetKey) greetingKeys.add(greetKey)
    if (k.length >= 22 && lineKeys.has(k)) continue
    let fuzzy = false
    if (k.length >= 16) {
      for (const prev of lineKeys) {
        if (prev.slice(0, 16) === k.slice(0, 16)) {
          fuzzy = true
          break
        }
      }
    }
    if (fuzzy) continue
    if (k.length >= 22) lineKeys.add(k)
    keptLines.push(line)
  }
  t = keptLines.join('\n')

  if (name && name.trim().length >= 2) {
    const nm = escapeReg(name.trim())
    const re = new RegExp('(?:\\n|^)\\s*' + nm + '\\s*(?:♥|❤|💙)?\\s*(?:\\n|$)', 'gi')
    let nSeen = 0
    t = t.replace(re, (m) => {
      nSeen += 1
      return nSeen === 1 ? m : '\n'
    })
  }

  if (maxSentences && maxSentences > 0) {
    const parts = t.split(/(?<=[.!?…])\s+/)
    if (parts.length > maxSentences) t = parts.slice(0, maxSentences).join(' ')
  }

  return t.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}
