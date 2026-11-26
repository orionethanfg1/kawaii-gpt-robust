/**
 * D1 — Durable-in-state document entity index (characters / places).
 * Pure: no localStorage, no Zustand. Survives when embedded on DocReadingState
 * and persisted via documentReadingStore.
 */

import { isPlausibleDocProperName } from './document-query-intent'

export type DocEntityCharacter = {
  name: string
  /** Normalized key for merge */
  key: string
  aliases: string[]
  /** Short evidence snippets (capped) */
  evidence: string[]
  chapterHints: string[]
  /** 0..1 heuristic */
  confidence: number
  mentions: number
}

export type DocEntityPlace = {
  name: string
  key: string
  mentions: number
  chapterHints: string[]
}

export type DocEntityIndex = {
  characters: DocEntityCharacter[]
  places: DocEntityPlace[]
  updatedAt: number
}

export function emptyDocEntityIndex(): DocEntityIndex {
  return { characters: [], places: [], updatedAt: Date.now() }
}

export function normalizeEntityKey(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü\s'-]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Bare toponyms / place-only labels (not people near a place word). */
const PLACE_NAME_RE =
  /^(ciudad|pueblo|bosque|castillo|reino|isla|montaña|montana|valle|templo|palacio|aldea|desierto|mar|río|rio|lago|calle|plaza|torre|fortaleza|academia|escuela|universidad)(\s+.+)?$/i

const PERSON_VERB_RE =
  /\b(dijo|pregunt[oó]|respondi[oó]|susurr[oó]|grit[oó]|mir[oó]|pens[oó]|sonri[oó]|camin[oó]|salud[oó]|encontr[oó]|esperaba|corri[oó]|lleg[oó]|entr[oó]|sali[oó]|habl[oó]|toc[oó]|abraz[oó])\b/i

function looksLikePlaceName(raw: string, evidence: string): boolean {
  if (PLACE_NAME_RE.test(raw.trim())) return true
  // "en el Valle Oscuro" / "hacia el Castillo" where candidate is the place head
  if (
    new RegExp(
      `(?:en|hacia|desde|del?|por)\s+(?:el |la |los |las )?${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'i'
    ).test(evidence) &&
    !PERSON_VERB_RE.test(evidence)
  ) {
    // Only if no clear person action in the window — still prefer character if verb present
    return !PERSON_VERB_RE.test(evidence)
  }
  return false
}

/** Extract character-like candidates from a slice (no LLM). */
export function extractEntitiesFromSlice(
  sliceBody: string,
  chapterTitles: string[] = []
): { characters: Array<{ name: string; evidence: string }>; places: Array<{ name: string }> } {
  const cleaned = (sliceBody || '').replace(/\s+/g, ' ').trim()
  const characters: Array<{ name: string; evidence: string }> = []
  const places: Array<{ name: string }> = []
  if (!cleaned) return { characters, places }

  const seen = new Set<string>()
  // Allow accented capitals in the first letter class; body letters include ó
  const nameRe =
    /\b[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+(?:\s+[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+){0,2}\b/g
  let m: RegExpExecArray | null
  while ((m = nameRe.exec(cleaned)) !== null) {
    const raw = m[0].trim()
    if (!isPlausibleDocProperName(raw)) continue
    const key = normalizeEntityKey(raw)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const start = Math.max(0, m.index - 40)
    const end = Math.min(cleaned.length, m.index + raw.length + 60)
    const evidence = cleaned.slice(start, end).trim()
    // Default to character. Place only on strong toponym signal — never
    // because "bosque/plaza" appears near a person name (D1 test regression).
    if (looksLikePlaceName(raw, evidence) && !PERSON_VERB_RE.test(evidence)) {
      places.push({ name: raw })
    } else {
      characters.push({ name: raw, evidence })
    }
  }

  // Dialogue speakers: dijo Name
  const saidRe =
    /(?:dijo|pregunt[oó]|respondi[oó]|susurr[oó]|grit[oó])\s+([A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+)/gi
  let s: RegExpExecArray | null
  while ((s = saidRe.exec(cleaned)) !== null) {
    const raw = s[1]
    if (!isPlausibleDocProperName(raw)) continue
    const key = normalizeEntityKey(raw)
    if (seen.has(key)) {
      // Boost: ensure in characters not only places
      if (!characters.some((c) => normalizeEntityKey(c.name) === key)) {
        characters.push({
          name: raw,
          evidence: cleaned.slice(Math.max(0, s.index - 20), s.index + 40)
        })
      }
      continue
    }
    seen.add(key)
    characters.push({ name: raw, evidence: cleaned.slice(Math.max(0, s.index - 20), s.index + 40) })
  }

  void chapterTitles
  return {
    characters: characters.slice(0, 24),
    places: places.slice(0, 12)
  }
}

const MAX_CHARS = 48
const MAX_EVIDENCE = 4
const MAX_EVIDENCE_LEN = 120
const MAX_HINTS = 6

export function mergeDocEntityIndex(
  prev: DocEntityIndex | null | undefined,
  opts: {
    sliceBody: string
    chapterTitles?: string[]
  }
): DocEntityIndex {
  const base = prev && Array.isArray(prev.characters) ? prev : emptyDocEntityIndex()
  const extracted = extractEntitiesFromSlice(opts.sliceBody, opts.chapterTitles || [])
  const byKey = new Map<string, DocEntityCharacter>()
  for (const c of base.characters) {
    byKey.set(c.key || normalizeEntityKey(c.name), { ...c, aliases: [...(c.aliases || [])], evidence: [...(c.evidence || [])], chapterHints: [...(c.chapterHints || [])] })
  }
  const titles = (opts.chapterTitles || []).filter(Boolean)

  for (const cand of extracted.characters) {
    const key = normalizeEntityKey(cand.name)
    if (!key) continue
    const existing = byKey.get(key)
    if (existing) {
      existing.mentions = (existing.mentions || 1) + 1
      existing.confidence = Math.min(1, (existing.confidence || 0.4) + 0.08)
      if (cand.evidence) {
        const ev = cand.evidence.slice(0, MAX_EVIDENCE_LEN)
        if (!existing.evidence.some((e) => e.slice(0, 40) === ev.slice(0, 40))) {
          existing.evidence = [...existing.evidence, ev].slice(-MAX_EVIDENCE)
        }
      }
      for (const t of titles) {
        if (t && !existing.chapterHints.includes(t)) {
          existing.chapterHints = [...existing.chapterHints, t].slice(-MAX_HINTS)
        }
      }
      if (cand.name !== existing.name && !existing.aliases.includes(cand.name)) {
        existing.aliases = [...existing.aliases, cand.name].slice(0, 6)
      }
    } else {
      byKey.set(key, {
        name: cand.name,
        key,
        aliases: [],
        evidence: cand.evidence ? [cand.evidence.slice(0, MAX_EVIDENCE_LEN)] : [],
        chapterHints: titles.slice(0, MAX_HINTS),
        confidence: 0.45,
        mentions: 1
      })
    }
  }

  const placeByKey = new Map<string, DocEntityPlace>()
  for (const p of base.places || []) {
    placeByKey.set(p.key || normalizeEntityKey(p.name), { ...p, chapterHints: [...(p.chapterHints || [])] })
  }
  for (const cand of extracted.places) {
    const key = normalizeEntityKey(cand.name)
    if (!key) continue
    const existing = placeByKey.get(key)
    if (existing) {
      existing.mentions = (existing.mentions || 1) + 1
      for (const t of titles) {
        if (t && !existing.chapterHints.includes(t)) {
          existing.chapterHints = [...existing.chapterHints, t].slice(-MAX_HINTS)
        }
      }
    } else {
      placeByKey.set(key, {
        name: cand.name,
        key,
        mentions: 1,
        chapterHints: titles.slice(0, MAX_HINTS)
      })
    }
  }

  const characters = [...byKey.values()]
    .sort((a, b) => b.mentions - a.mentions || b.confidence - a.confidence)
    .slice(0, MAX_CHARS)

  const places = [...placeByKey.values()]
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 24)

  return {
    characters,
    places,
    updatedAt: Date.now()
  }
}

/** Prompt block for roster recall — no full book dump. */
export function buildDocEntityPromptBlock(
  index: DocEntityIndex | null | undefined,
  maxChars = 900
): string {
  if (!index?.characters?.length && !index?.places?.length) return ''
  const lines: string[] = []
  lines.push(
    '[ELENCO_DOCUMENTO] Nombres vistos en tramos leídos (usa estos; no inventes elenco alternativo):'
  )
  const chars = (index.characters || []).slice(0, 20)
  for (const c of chars) {
    const hint = c.chapterHints?.slice(-2).join(', ')
    const bit =
      `- ${c.name}` +
      (c.aliases?.length ? ` (también: ${c.aliases.slice(0, 2).join(', ')})` : '') +
      (hint ? ` · tramos: ${hint}` : '') +
      (c.evidence?.[0] ? ` · ej.: «${c.evidence[0].slice(0, 80)}»` : '')
    lines.push(bit)
  }
  if (index.places?.length) {
    lines.push(
      'Lugares mencionados: ' +
        index.places
          .slice(0, 8)
          .map((p) => p.name)
          .join(', ')
    )
  }
  const text = lines.join('\n')
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1) + '…'
}

/** Merge index from an existing mapSliceToFacts "nombres:" line (recovery). */
export function mergeIndexFromMappedFactsLine(
  prev: DocEntityIndex | null | undefined,
  mappedLine: string,
  chapterTitles: string[] = []
): DocEntityIndex {
  const m = String(mappedLine || '').match(/nombres:\s*([^\n]+)/i)
  if (!m) return prev && Array.isArray(prev.characters) ? prev : emptyDocEntityIndex()
  const names = m[1]
    .split(/,/)
    .map((x) => x.trim())
    .filter((n) => isPlausibleDocProperName(n))
  if (!names.length) return prev && Array.isArray(prev.characters) ? prev : emptyDocEntityIndex()
  // Synthetic body so extract/merge path stays single
  const fake = names.map((n) => `${n} apareció en la escena.`).join(' ')
  return mergeDocEntityIndex(prev, { sliceBody: fake, chapterTitles })
}
