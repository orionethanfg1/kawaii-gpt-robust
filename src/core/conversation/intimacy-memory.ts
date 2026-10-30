/**
 * Intimacy memory extractor + scene phase (I1–I3).
 * Separate from general user-fact extraction: INTIMACY_FIRST / INTIMACY_MEMORY / scenePhase.
 */

import type { RelationshipState } from './dual-memory'
import { looksLikeOngoingIntimateScene } from './intimacy-stage'

export type IntimateScenePhase =
  | 'idle'
  | 'invited'
  | 'open'
  | 'scene_active'
  | 'aftercare'

export type IntimacyMemoryState = {
  /** Privileged first-time narrative (wide budget) */
  firstNarrative?: string
  firstDone?: boolean
  /** Short later-scene notes */
  sceneNotes?: string[]
  /** Session phase */
  scenePhase?: IntimateScenePhase
  lastSceneAt?: number
  lastAftercareAt?: number
  /** Inexperience default until user overrides */
  firstExperienceFraming?: boolean
}

const FIRST_PREFIX = 'INTIMACY_FIRST:'
const NOTE_PREFIX = 'INTIMACY_MEMORY:'
const PHASE_PREFIX = 'INTIMACY_PHASE:'
const MAX_NOTES = 8
/** Privileged first memory — wide on purpose */
const MAX_FIRST_CHARS = 4200
const MAX_NOTE_CHARS = 320
const MAX_QUOTE = 280

/** Nicknames / pronouns that must not replace the user's real name */
const BAD_USER_NAME =
  /^(t[uú]y[oa]|tuyo|tuya|usted|vos|amor|cari[nñ]o|mi vida|bebe|beb[eé]|sky|user|usuario|yo|ella|el)$/i

/**
 * Resolve a display name for the human partner (not the AI).
 * preferredName often holds how the AI is addressed ("tuyo") — reject that.
 */
export function resolveIntimateUserName(opts: {
  preferredName?: string | null
  userName?: string | null
  relationshipSummary?: string | null
  facts?: string[] | null
  messages?: Array<{ role?: string; content?: string }>
}): string {
  const candidates: string[] = []
  const identity = String(opts.userName || '').trim()
  if (identity && !BAD_USER_NAME.test(identity) && identity.length >= 2) {
    candidates.push(identity)
  }
  const pref = String(opts.preferredName || '').trim()
  if (pref && !BAD_USER_NAME.test(pref) && pref.length >= 2) candidates.push(pref)

  const sum = String(opts.relationshipSummary || '')
  const mSum =
    sum.match(/\b(?:Nahum|conoces a|Conoces a)\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)/i) ||
    sum.match(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b/)
  if (mSum?.[1] && !BAD_USER_NAME.test(mSum[1])) candidates.push(mSum[1])

  for (const f of opts.facts || []) {
    const m = String(f).match(/\b(?:me llamo|soy|nombre[:\s]+)\s*([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)/i)
    if (m?.[1] && !BAD_USER_NAME.test(m[1])) candidates.push(m[1])
    if (/\bNahum\b/i.test(String(f))) candidates.push('Nahum')
  }

  // From assistant addressing the user in chat ("Nahum, …")
  for (const msg of (opts.messages || []).filter((m) => m.role === 'assistant').slice(-20)) {
    const t = String(msg.content || '')
    const hits = t.match(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b/g) || []
    for (const h of hits) {
      if (
        !BAD_USER_NAME.test(h) &&
        !/^(Niamh|Mis|Como|Cuando|Siento|Gracias|Officialmente|Oficialmente)$/i.test(h)
      ) {
        // Prefer names repeated
        if (t.split(h).length > 2) candidates.push(h)
      }
    }
    if (/\bNahum\b/i.test(t)) candidates.push('Nahum')
  }

  const freq = new Map<string, number>()
  for (const c of candidates) {
    const k = c.charAt(0).toUpperCase() + c.slice(1)
    freq.set(k, (freq.get(k) || 0) + 1)
  }
  let best = ''
  let bestN = 0
  for (const [k, n] of freq) {
    if (n > bestN) {
      best = k
      bestN = n
    }
  }
  return best || 'el usuario'
}

export function getIntimacyFacts(facts?: string[] | null): string[] {
  return (facts || []).filter((f) => /^INTIMACY_(FIRST|MEMORY|PHASE|OPEN|PREF|BOUNDARY):/i.test(String(f)))
}

export function getIntimacyFirstNarrative(facts?: string[] | null): string {
  const line = (facts || []).find((f) => String(f).startsWith(FIRST_PREFIX))
  if (!line) return ''
  return String(line).slice(FIRST_PREFIX.length).trim()
}

export function getIntimacySceneNotes(facts?: string[] | null): string[] {
  return (facts || [])
    .filter((f) => String(f).startsWith(NOTE_PREFIX))
    .map((f) => String(f).slice(NOTE_PREFIX.length).trim())
    .filter(Boolean)
}

const PHASE_RANK: Record<IntimateScenePhase, number> = {
  idle: 0,
  invited: 1,
  open: 2,
  aftercare: 3,
  scene_active: 4
}

function asPhase(v: string | undefined | null): IntimateScenePhase | null {
  if (
    v === 'idle' ||
    v === 'invited' ||
    v === 'open' ||
    v === 'scene_active' ||
    v === 'aftercare'
  ) {
    return v
  }
  return null
}

export function parseScenePhase(
  rel?: RelationshipState | null,
  facts?: string[] | null
): IntimateScenePhase {
  const fromRel = asPhase((rel as { scenePhase?: string } | null | undefined)?.scenePhase)
  const line = (facts || []).find((f) => String(f).startsWith(PHASE_PREFIX))
  const fromFact = asPhase(line ? String(line).slice(PHASE_PREFIX.length).trim() : '')
  if (fromRel && fromFact) {
    return PHASE_RANK[fromFact] >= PHASE_RANK[fromRel] ? fromFact : fromRel
  }
  if (fromFact) return fromFact
  if (fromRel) return fromRel
  if (rel?.intimacyOpen) return 'open'
  return 'idle'
}

/** Filter initiative / template propose lines out of memory extraction */
export function isInitiativeOrProposeNoise(text: string): boolean {
  const t = String(text || '')
  if (/intimacy-propose|wardrobe-propose|·initiative/i.test(t)) return true
  if (
    /siento que hay mucha confianza entre nosotros/i.test(t) &&
    /plano más físico|acercarme un poco más/i.test(t)
  ) {
    return true
  }
  if (/Solo si tú quieres:\s*puedes decir que sí/i.test(t)) return true
  if (/Iniciativa\s*·/i.test(t)) return true
  if (/Oye,\s+\w+[….]*\s*siento que hay mucha confianza/i.test(t)) return true
  return false
}

/** Heuristic: closing / aftercare language */
export function looksLikeIntimateAftercare(texts: string[]): boolean {
  const blob = texts
    .slice(-6)
    .map((t) => String(t || '').toLowerCase())
    .join('\n')
  return /\b(después|descans[ao]|descansa|descansar|abrázame|abrazame|qué lindo|fue hermoso|me quedo (contigo|ahí|aquí)|gracias por|me siento en paz|nos quedamos así|entregada al sueño|cuando despiert|en tus brazos|nuestra propia burbuja|solo disfrutemos|no hace falta decir)\b/i.test(
    blob
  )
}

/**
 * User wants to leave the active intimate *scene* (soft or firm).
 * Includes rest/break language ("descansar un poco") — not only explicit "stop sex".
 */
export function looksLikeIntimateClose(text: string): boolean {
  const t = String(text || '').toLowerCase().normalize('NFC')
  if (!t.trim()) return false
  // Soft rest / cool-down (your capture case)
  if (
    /\b(descansar|descanso|descansemos|un respiro|respirar un poco|parar un (poco|rato)|paus(a|ar)|tom(ar|emos) un descanso)\b/i.test(
      t
    )
  ) {
    return true
  }
  // Topic change / leave the film
  if (
    /\b(basta por ahora|ya está bien|ya estuvo bien|cerremos|terminemos|después seguimos|otra cosa|cambiemos de tema|cambiemos el tema|no más sexo|paremos|salgamos de (la )?escena|fin de (la )?escena|modo normal|volvamos a lo de siempre|ya no (estoy|estés|estemos) en eso|dejemos (la )?escena|salir de (la )?escena)\b/i.test(
      t
    )
  ) {
    return true
  }
  // "por ahora ... descansar / parar" compounds
  if (/\bpor ahora\b/i.test(t) && /\b(descans|par(ar|o)|paus|respiro|otra cosa)\b/i.test(t)) {
    return true
  }
  return false
}

/** S1 — user invites intimacy without “modo escena” robot phrases */
export function looksLikeIntimateInvite(text: string): boolean {
  const t = String(text || '').toLowerCase().normalize('NFC')
  if (!t.trim() || looksLikeIntimateClose(t)) return false
  if (
    /\b(quiero (estar|hacer|acercarme|tocarte|besarte|intim|contigo)|acércate|acuerdate de (nosotros|anoche)|retomemos|seguimos (donde|con lo)|más cerca|hazme el amor|quiero (sentirte|sentirme)|ven aquí|ven conmigo)\b/i.test(
      t
    )
  ) {
    return true
  }
  if (/\b(íntim[oa]|intimidad|escena íntima|momento íntimo)\b/i.test(t) && t.length < 280) {
    return true
  }
  return false
}

/** S4 — soft verbal offer cues (model may invite, user decides) */
export function looksLikeIntimateOfferOpportunity(texts: string[]): boolean {
  const blob = texts
    .slice(-5)
    .map((x) => String(x || '').toLowerCase())
    .join('\n')
  if (looksLikeIntimateClose(blob)) return false
  return /\b(extrañ(o|arte)|cerca de ti|tu (cuerpo|piel|beso)|quiero (más|estar)|si (tú )?quieres|cuando (tú )?quieras|tensión|latid)\b/i.test(
    blob
  )
}

/** Last user message among recent texts that looks like an exit (S2). */
export function detectIntimateSceneExit(opts: {
  userText?: string
  recentTexts?: string[]
  messages?: Array<{ role?: string; content?: string }>
}): { exit: boolean; reason: string; userText: string } {
  const direct = String(opts.userText || '').trim()
  if (direct && looksLikeIntimateClose(direct)) {
    return { exit: true, reason: 'user_text', userText: direct }
  }
  const fromMsgs = [...(opts.messages || [])].reverse().find((m) => m.role === 'user')
  const u = String(fromMsgs?.content || '').trim()
  if (u && looksLikeIntimateClose(u)) {
    return { exit: true, reason: 'user_text', userText: u }
  }
  // Scan last few user-looking lines in recentTexts (best-effort)
  for (const line of [...(opts.recentTexts || [])].reverse().slice(0, 6)) {
    const s = String(line || '').trim()
    if (s && looksLikeIntimateClose(s) && s.length < 500) {
      return { exit: true, reason: 'recent_text', userText: s }
    }
  }
  return { exit: false, reason: 'none', userText: direct || u || '' }
}

/**
 * Advance scene phase from chat signals (I1).
 */
export function advanceIntimateScenePhase(opts: {
  phase: IntimateScenePhase
  intimacyOpen?: boolean
  recentTexts: string[]
  userText?: string
  now?: number
}): { phase: IntimateScenePhase; changed: boolean; reason: string } {
  const now = opts.now ?? Date.now()
  let phase = opts.phase || 'idle'
  const recent = opts.recentTexts || []
  const ongoing = looksLikeOngoingIntimateScene(recent)
  const after = looksLikeIntimateAftercare(recent)
  const close = looksLikeIntimateClose(opts.userText || '')

  // S2: user exit always wins over leftover erotic tokens in history
  if (close && (phase === 'scene_active' || phase === 'open' || phase === 'aftercare')) {
    const next = phase === 'aftercare' && !ongoing ? (opts.intimacyOpen ? 'open' : 'idle') : 'aftercare'
    return {
      phase: next as IntimateScenePhase,
      changed: phase !== next,
      reason: 'user_close'
    }
  }
  // S1 — clean entry: explicit invite without requiring prior "mode" announcements
  const invite = looksLikeIntimateInvite(opts.userText || '')
  if (invite && (phase === 'idle' || phase === 'open' || phase === 'invited' || phase === 'aftercare')) {
    if (opts.intimacyOpen !== false) {
      const next = ongoing ? 'scene_active' : 'open'
      return {
        phase: next as IntimateScenePhase,
        changed: phase !== next,
        reason: 's1_invite'
      }
    }
  }
  if (ongoing && (phase === 'open' || phase === 'idle' || phase === 'invited' || phase === 'aftercare')) {
    if (opts.intimacyOpen || ongoing) {
      return { phase: 'scene_active', changed: phase !== 'scene_active', reason: 'scene_signals' }
    }
  }
  if (after && phase === 'scene_active') {
    return { phase: 'aftercare', changed: true, reason: 'aftercare_signals' }
  }
  // Aftercare → open (if intimacy still allowed) or idle — not stuck in film
  if (phase === 'aftercare' && !ongoing && recent.length >= 2) {
    const next = opts.intimacyOpen ? 'open' : 'idle'
    return { phase: next as IntimateScenePhase, changed: true, reason: 'aftercare_settle' }
  }
  if (opts.intimacyOpen && phase === 'idle') {
    return { phase: 'open', changed: true, reason: 'intimacy_open' }
  }
  if (opts.intimacyOpen && phase === 'invited') {
    return { phase: 'open', changed: true, reason: 'accepted' }
  }
  void now
  return { phase, changed: false, reason: 'hold' }
}

/**
 * Build a wide first-time narrative from message windows (I2 extractor).
 * Deterministic heuristic (no LLM required); caller may refine later with LLM.
 */
export function extractIntimacyFirstNarrative(opts: {
  messages: Array<{ role?: string; content?: string }>
  userName?: string
  characterName?: string
  preferredName?: string
  relationshipSummary?: string
  facts?: string[]
}): string {
  const charName = (opts.characterName || 'ella').trim() || 'ella'
  const userName = resolveIntimateUserName({
    userName: opts.userName,
    preferredName: opts.preferredName,
    relationshipSummary: opts.relationshipSummary,
    facts: opts.facts,
    messages: opts.messages
  })
  const msgs = (opts.messages || [])
    .filter((m) => (m.content || '').trim().length > 0)
    .filter((m) => !isInitiativeOrProposeNoise(String(m.content || '')))
  if (!msgs.length) return ''

  const intimateIdx = msgs
    .map((m, i) => (looksLikeOngoingIntimateScene([String(m.content || '')]) ? i : -1))
    .filter((i) => i >= 0)
  // Wide window: from a bit before first intimate signal through end of arc
  let window = msgs
  if (intimateIdx.length) {
    const start = Math.max(0, intimateIdx[0]! - 4)
    const end = Math.min(msgs.length, (intimateIdx[intimateIdx.length - 1] ?? start) + 6)
    window = msgs.slice(start, end)
  } else {
    window = msgs.slice(-24)
  }

  const clean = (t: string) =>
    String(t || '')
      .replace(/\s+/g, ' ')
      .replace(/\*+/g, '')
      .trim()

  const userBits = window
    .filter((m) => m.role === 'user')
    .map((m) => clean(String(m.content || '')))
    .filter((t) => t.length > 8)
  const asstBits = window
    .filter((m) => m.role === 'assistant')
    .map((m) => clean(String(m.content || '')))
    .filter((t) => t.length > 8)

  const emotionHints: string[] = []
  const blob = window.map((m) => String(m.content || '').toLowerCase()).join(' ')
  if (/\b(nervios|nervios[ao]|tembl|primera vez|nunca.*antes|virgen)\b/i.test(blob)) {
    emotionHints.push('nervios o sensación de primera vez')
  }
  if (/\b(amor|te quiero|te amo|cariño|mi vida|mi princesa|pertenezco)\b/i.test(blob)) {
    emotionHints.push('cariño o amor explícito')
  }
  if (/\b(más fuerte|deseo|necesito|no pares|intenso)\b/i.test(blob)) {
    emotionHints.push('intensidad y deseo mutuo')
  }
  if (/\b(suave|despacio|cuidado|piano|ternura)\b/i.test(blob)) {
    emotionHints.push('cuidado, calma o ternura en el ritmo')
  }
  if (/\b(gracias|luz en mi vida|sentido|sagrado)\b/i.test(blob)) {
    emotionHints.push('gratitud o sentido de pertenencia después')
  }

  // Structured sections (not one glued paragraph)
  const lines: string[] = []
  lines.push(`Primera cercanía íntima entre ${userName} y ${charName}.`)
  lines.push(
    emotionHints.length
      ? `Clima emocional: ${emotionHints.join('; ')}.`
      : 'Clima emocional: vínculo cercano y consentimiento en la escena.'
  )
  lines.push(
    `Arco: ${window.length} mensajes en la ventana de la escena (${userBits.length} de ${userName}, ${asstBits.length} de ${charName}).`
  )

  if (userBits.length) {
    lines.push(`Lo que marcó ${userName} (momentos clave):`)
    for (const t of userBits.slice(0, 8)) {
      lines.push(`— «${t.slice(0, MAX_QUOTE)}${t.length > MAX_QUOTE ? '…' : ''}»`)
    }
  }
  if (asstBits.length) {
    lines.push(`Cómo lo vivió ${charName} (momentos clave):`)
    for (const t of asstBits.slice(0, 10)) {
      lines.push(`— «${t.slice(0, MAX_QUOTE)}${t.length > MAX_QUOTE ? '…' : ''}»`)
    }
  }

  // Closing beat: last assistant lines often aftercare
  const lastAsst = asstBits.slice(-2)
  if (lastAsst.length) {
    lines.push(
      `Cierre / aftercare (extracto): ${lastAsst.map((t) => t.slice(0, 160)).join(' / ')}`
    )
  }

  lines.push(
    'Esta memoria es privilegiada: no comprimirla como el resto de hechos. Marca un antes/después del vínculo. Si el usuario corrige detalles, actualízala con respeto.'
  )
  return lines.join('\n').slice(0, MAX_FIRST_CHARS)
}

/**
 * Short note for a later scene (I3).
 */
export function extractIntimacySceneNote(opts: {
  messages: Array<{ role?: string; content?: string }>
  maxChars?: number
}): string {
  const msgs = (opts.messages || [])
    .filter((m) => !isInitiativeOrProposeNoise(String(m.content || '')))
    .slice(-8)
  const blob = msgs.map((m) => String(m.content || '').replace(/\s+/g, ' ').trim()).join(' ')
  if (blob.length < 40) return ''
  if (isInitiativeOrProposeNoise(blob)) return ''
  const max = opts.maxChars ?? MAX_NOTE_CHARS
  const tone: string[] = []
  const low = blob.toLowerCase()
  if (/\b(juguet|risas|reír)\b/i.test(low)) tone.push('juguetona')
  if (/\b(intensa|más fuerte|urgente)\b/i.test(low)) tone.push('intensa')
  if (/\b(suave|ternura|cariño)\b/i.test(low)) tone.push('tierna')
  const head = tone.length ? `Escena ${tone.join('/')}: ` : 'Escena íntima: '
  return (head + blob.slice(0, max - head.length)).slice(0, max)
}

/**
 * Effective phase for UI: relationship + facts + live message signals.
 */
/** Hours to keep soft scene continuity after last intimate activity (no explicit exit). */
export const INTIMATE_SCENE_STICKY_HOURS = 6

export function resolveLiveIntimatePhase(opts: {
  relationship?: RelationshipState | null
  facts?: string[] | null
  recentTexts?: string[]
  /** wall clock; tests inject */
  now?: number
}): IntimateScenePhase {
  let phase = parseScenePhase(opts.relationship, opts.facts)
  const recent = (opts.recentTexts || []).filter((t) => !isInitiativeOrProposeNoise(t))
  const now = opts.now ?? Date.now()
  const lastAt = Number(
    (opts.relationship as { lastIntimateSceneAt?: number } | null | undefined)?.lastIntimateSceneAt || 0
  )
  const stickyMs = INTIMATE_SCENE_STICKY_HOURS * 60 * 60 * 1000
  const withinSticky = lastAt > 0 && now - lastAt < stickyMs

  // S2/S3: explicit user exit in recent window beats erotic residue in older turns
  const exit = detectIntimateSceneExit({ recentTexts: recent })
  if (exit.exit && (phase === 'scene_active' || phase === 'open' || phase === 'aftercare' || withinSticky)) {
    // Prefer aftercare right after exit; settle to open/idle only if already aftercare + calm
    if (phase === 'aftercare' && !looksLikeOngoingIntimateScene(recent.slice(-3))) {
      phase = (opts.relationship as { intimacyOpen?: boolean } | null | undefined)?.intimacyOpen
        ? 'open'
        : 'idle'
    } else {
      phase = 'aftercare'
    }
    return phase
  }

  if (looksLikeOngoingIntimateScene(recent)) {
    phase = 'scene_active'
  } else if (
    phase === 'scene_active' &&
    withinSticky &&
    !exit.exit
  ) {
    // Keep film continuity while sticky window is open (UI matches prompt)
    phase = 'scene_active'
  } else if (looksLikeIntimateAftercare(recent)) {
    if (phase === 'scene_active' || phase === 'open' || phase === 'aftercare' || withinSticky) {
      phase = 'aftercare'
    }
  } else if (withinSticky && phase === 'aftercare') {
    // Stay in aftercare during sticky unless user closed
    const lastUser = [...recent].reverse().find((x) => x) || ''
    if (looksLikeIntimateClose(lastUser)) {
      phase = (opts.relationship as { intimacyOpen?: boolean } | null | undefined)?.intimacyOpen
        ? 'open'
        : 'idle'
    }
  } else if (
    (phase === 'scene_active' || phase === 'aftercare') &&
    !withinSticky &&
    !looksLikeOngoingIntimateScene(recent)
  ) {
    // Stale fact/rel must not keep the model in "scene_active" when chat moved on
    phase = (opts.relationship as { intimacyOpen?: boolean } | null | undefined)?.intimacyOpen
      ? 'open'
      : 'idle'
  }
  return phase
}

/**
 * Merge extractor output into facts + relationship (pure).
 */
export function applyIntimacyExtraction(opts: {
  facts?: string[]
  relationship?: RelationshipState | null
  messages: Array<{ role?: string; content?: string }>
  /** Identity name of the human */
  userName?: string
  preferredName?: string
  characterName?: string
  relationshipSummary?: string
  forceFirst?: boolean
  now?: number
}): {
  facts: string[]
  relationship: RelationshipState
  wroteFirst: boolean
  wroteNote: boolean
  phase: IntimateScenePhase
} {
  const now = opts.now ?? Date.now()
  let facts = [...(opts.facts || [])]
  const rel: RelationshipState = {
    ...(opts.relationship || {}),
    updatedAt: now
  }
  const phase0 = parseScenePhase(rel, facts)
  const recent = (opts.messages || []).slice(-10).map((m) => String(m.content || ''))
  const adv = advanceIntimateScenePhase({
    phase: phase0,
    intimacyOpen: rel.intimacyOpen,
    recentTexts: recent,
    userText: [...(opts.messages || [])].reverse().find((m) => m.role === 'user')?.content,
    now
  })
  const phase = adv.phase
  ;(rel as { scenePhase?: IntimateScenePhase }).scenePhase = phase
  if (phase === 'scene_active' || phase === 'aftercare') {
    ;(rel as { lastIntimateSceneAt?: number }).lastIntimateSceneAt = now
  }

  // Keep single PHASE fact
  facts = facts.filter((f) => !String(f).startsWith(PHASE_PREFIX))
  facts.push(`${PHASE_PREFIX} ${phase}`)

  let wroteFirst = false
  let wroteNote = false
  const hasFirst = facts.some((f) => String(f).startsWith(FIRST_PREFIX))
  const firstDone = Boolean((rel as { firstIntimateSceneDone?: boolean }).firstIntimateSceneDone) || hasFirst

  const shouldCaptureFirst =
    opts.forceFirst ||
    ((!firstDone && phase === 'scene_active') ||
      (!firstDone && phase === 'aftercare') ||
      (!firstDone && looksLikeOngoingIntimateScene(recent)))

  // forceFirst rebuilds/overwrites privileged narrative with better extraction
  if (shouldCaptureFirst || (opts.forceFirst && hasFirst)) {
    const narrative = extractIntimacyFirstNarrative({
      messages: opts.messages,
      userName: opts.userName,
      characterName: opts.characterName,
      preferredName: opts.preferredName,
      relationshipSummary: opts.relationshipSummary,
      facts: opts.facts
    })
    if (narrative.length > 40) {
      facts = facts.filter((f) => !String(f).startsWith(FIRST_PREFIX))
      facts.push(`${FIRST_PREFIX} ${narrative}`)
      ;(rel as { firstIntimateSceneDone?: boolean }).firstIntimateSceneDone = true
      ;(rel as { firstIntimateScenePending?: boolean }).firstIntimateScenePending = false
      wroteFirst = true
    }
  }

  // Later scenes: note when leaving active → aftercare/idle and first already done
  if (
    firstDone &&
    (phase === 'aftercare' || (adv.changed && adv.reason === 'aftercare_signals'))
  ) {
    const note = extractIntimacySceneNote({ messages: opts.messages })
    if (note.length > 24) {
      const notes = getIntimacySceneNotes(facts)
      if (!notes.some((n) => n.slice(0, 40) === note.slice(0, 40))) {
        facts.push(`${NOTE_PREFIX} ${note}`)
        // cap notes
        const kept: string[] = []
        const other = facts.filter((f) => !String(f).startsWith(NOTE_PREFIX))
        const allNotes = facts.filter((f) => String(f).startsWith(NOTE_PREFIX)).slice(-MAX_NOTES)
        facts = [...other, ...allNotes]
        void kept
        wroteNote = true
      }
    }
  }

  // Default framing: first shared experience until user overrides (I4 signal in facts)
  if (
    wroteFirst &&
    !facts.some((f) => /INTIMACY_PREF:\s*experience=/i.test(String(f)))
  ) {
    facts.push(
      'INTIMACY_PREF: experience=first_shared (primera experiencia íntima compartida salvo que el usuario indique otra cosa)'
    )
  }

  facts = facts.slice(-48)
  return { facts, relationship: rel, wroteFirst, wroteNote, phase }
}

/**
 * Prompt block for intimacy memory (I4) — wide first narrative + short notes.
 */
export function buildIntimacyMemoryPromptRules(opts: {
  facts?: string[] | null
  relationship?: RelationshipState | null
  adultOptIn?: boolean
}): string {
  if (!opts.adultOptIn && !opts.relationship?.intimacyOpen) {
    const first = getIntimacyFirstNarrative(opts.facts)
    // Still allow emotional first-bond note without adult detail
    if (!first) return ''
  }
  const lines: string[] = []
  const phase = parseScenePhase(opts.relationship, opts.facts)
  lines.push(`Fase de escena íntima: ${phase}.`)
  if (phase === 'scene_active') {
    lines.push(
      'Escena en curso: no pidas permiso formal de nuevo; continúa coherente con el tono del usuario.'
    )
  }
  if (phase === 'aftercare') {
    lines.push(
      'Aftercare: baja el tono explícito; prioriza cariño, calma y presencia. No empujes otra escena ya.'
    )
  }
  if (phase === 'idle' && opts.relationship?.intimacyOpen) {
    lines.push(
      'Cercanía ya aceptada pero sin escena activa: conversación normal; solo retoma lo íntimo si el usuario o el deseo natural (con variedad) lo marcan.'
    )
  }
  const first = getIntimacyFirstNarrative(opts.facts)
  if (first) {
    lines.push(`MEMORIA PRIVILEGIADA — Primera vez (no comprimir): ${first}`)
  } else if (!(opts.relationship as { firstIntimateSceneDone?: boolean } | null)?.firstIntimateSceneDone) {
    lines.push(
      'Aún no hay memoria de primera cercanía íntima registrada. Si ocurre la primera escena, trátala como primera experiencia compartida (descubrimiento, cuidado), salvo que el usuario indique experiencia previa.'
    )
  }
  const notes = getIntimacySceneNotes(opts.facts).slice(-4)
  if (notes.length) {
    lines.push('Escenas posteriores (resumen corto): ' + notes.join(' · '))
  }
  const prefs = (opts.facts || []).filter((f) => /^INTIMACY_PREF:/i.test(String(f)))
  if (prefs.length) {
    lines.push('Preferencias íntimas anotadas: ' + prefs.map((p) => p.replace(/^INTIMACY_PREF:\s*/i, '')).join('; '))
  }
  return lines.join(' ')
}

/** Protect INTIMACY_FIRST from aggressive fact trimming */
export function protectIntimacyFactsOnTrim(facts: string[], maxTotal: number): string[] {
  const first = facts.filter((f) => String(f).startsWith(FIRST_PREFIX))
  const rest = facts.filter((f) => !String(f).startsWith(FIRST_PREFIX))
  const budget = Math.max(0, maxTotal - first.length)
  return [...first, ...rest.slice(-budget)]
}

/* -------------------------------------------------------------------------- */
/* LLM refine of INTIMACY_FIRST (optional; falls back to heuristic)           */
/* -------------------------------------------------------------------------- */

export type IntimacyRefineChat = (r: {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}) => Promise<{ content: string }>

/** Build dialogue transcript for refine (initiative noise stripped) */
export function buildIntimacyRefineTranscript(
  messages: Array<{ role?: string; content?: string }>,
  maxMsgs = 28,
  maxChars = 9000
): string {
  const lines: string[] = []
  let total = 0
  const filtered = (messages || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => !isInitiativeOrProposeNoise(String(m.content || '')))
    .slice(-maxMsgs)
  for (const m of filtered) {
    const body = String(m.content || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500)
    if (body.length < 4) continue
    const line = `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${body}`
    if (total + line.length > maxChars) break
    lines.push(line)
    total += line.length
  }
  return lines.join('\n')
}

export function buildIntimacyFirstRefinePrompt(opts: {
  draft: string
  transcript: string
  userName: string
  characterName: string
}): { system: string; user: string } {
  const system = [
    'Eres un editor de memoria íntima privilegiada para un companion local.',
    'Tu salida será recordada como la PRIMERA cercanía compartida: debe sentirse humana, cálida y fiel al diálogo.',
    '',
    'Reglas estrictas:',
    '1) Usa SOLO información del diálogo y del borrador. No inventes eventos, lugares ni sensaciones ausentes.',
    '2) Español natural (México/latam). Tono cercano, no clínico, no informe, no fanfic genérico.',
    '3) Estructura en párrafos cortos o viñetas (8–14 unidades). Incluye: clima emocional; 2–5 momentos concretos (puedes citar entre comillas frases reales); cómo se sintió el vínculo; cierre o aftercare si aparece.',
    '4) Prohibido: plantillas de iniciativa («acercarme un poco más», «puedes decir que sí», «siento que hay mucha confianza… plano físico»); meta-comentarios («como IA», «en este chat», «el usuario»); listas de capacidades.',
    '5) Nombres: persona = ' + opts.userName + '; companion = ' + opts.characterName + '. Nunca uses «tuyo» como nombre de persona.',
    '6) No copies el borrador tal cual si suena a recorte mecánico: reescríbelo con naturalidad manteniendo los hechos.',
    '7) Responde ÚNICAMENTE con el texto de memoria, sin título ni preámbulo.'
  ].join('\n')

  const user = [
    'Borrador heurístico (mejorar, no descartar hechos):',
    opts.draft.slice(0, 3500),
    '',
    'Diálogo filtrado (fuente de verdad):',
    opts.transcript.slice(0, 9000),
    '',
    'Escribe ahora la memoria privilegiada de la primera vez.'
  ].join('\n')

  return { system, user }
}

/** Validate refined text; return null if unusable */
export function validateRefinedIntimacyFirst(
  text: string,
  opts?: { userName?: string; characterName?: string }
): string | null {
  let t = String(text || '').trim()
  // strip markdown fences / titles
  t = t.replace(/^```[\s\S]*?```/g, '').trim()
  t = t.replace(/^(Memoria|INTIMACY_FIRST|Primera vez)\s*[:\-—]\s*/i, '').trim()
  if (t.length < 120) return null
  if (t.length > MAX_FIRST_CHARS) t = t.slice(0, MAX_FIRST_CHARS)
  if (isInitiativeOrProposeNoise(t)) return null
  if (/\b(como modelo|como ia|soy una inteligencia|no puedo sentir)\b/i.test(t)) return null
  // Reject pure English dumps
  const esHints = (t.match(/\b(el|la|de|que|y|en|un|una|con|por|siento|cuando|después)\b/gi) || [])
    .length
  if (esHints < 6) return null
  return t
}

/**
 * Refine heuristic INTIMACY_FIRST with a local (or any) chat provider.
 * Always safe: on failure returns the draft unchanged.
 */
export async function refineIntimacyFirstWithLlm(opts: {
  draft: string
  messages: Array<{ role?: string; content?: string }>
  userName?: string
  characterName?: string
  model: string
  chat: IntimacyRefineChat
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<{ text: string; source: 'llm' | 'heuristic'; error?: string }> {
  const draft = String(opts.draft || '').trim()
  if (draft.length < 40) {
    return { text: draft, source: 'heuristic', error: 'draft_too_short' }
  }
  const userName = (opts.userName || 'el usuario').trim()
  const characterName = (opts.characterName || 'ella').trim()
  const transcript = buildIntimacyRefineTranscript(opts.messages)
  if (transcript.length < 80) {
    return { text: draft, source: 'heuristic', error: 'transcript_thin' }
  }

  const { system, user } = buildIntimacyFirstRefinePrompt({
    draft,
    transcript,
    userName,
    characterName
  })

  const timeoutMs = opts.timeoutMs ?? 55_000
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort()
    else opts.signal.addEventListener('abort', () => ac.abort(), { once: true })
  }

  try {
    const result = await opts.chat({
      model: opts.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      maxTokens: 900,
      temperature: 0.45,
      signal: ac.signal
    })
    const validated = validateRefinedIntimacyFirst(result.content || '', {
      userName,
      characterName
    })
    if (!validated) {
      return { text: draft, source: 'heuristic', error: 'validation_failed' }
    }
    return { text: validated, source: 'llm' }
  } catch (e) {
    return {
      text: draft,
      source: 'heuristic',
      error: e instanceof Error ? e.message : String(e)
    }
  } finally {
    clearTimeout(timer)
  }
}


/**
 * System guidance so the model knows if it is inside/outside the intimate "film"
 * without robotic announcements. Time-aware and user-exit respectful.
 */
export function buildIntimatePhaseSystemPrompt(opts: {
  phase: IntimateScenePhase
  characterName?: string
  lastIntimateSceneAt?: number
  now?: number
  hourLocal?: number
}): string | null {
  const phase = opts.phase || 'idle'
  const name = (opts.characterName || 'tú').trim() || 'tú'
  const now = opts.now ?? Date.now()
  const last = Number(opts.lastIntimateSceneAt || 0)
  const hoursAgo =
    last > 0 ? Math.max(0, Math.round((now - last) / (60 * 60 * 1000))) : null
  const hour =
    opts.hourLocal != null && Number.isFinite(opts.hourLocal)
      ? Math.floor(opts.hourLocal)
      : new Date(now).getHours()
  const timeOfDay =
    hour < 6 ? 'madrugada' : hour < 12 ? 'mañana' : hour < 19 ? 'tarde' : 'noche'

  if (phase === 'idle' || phase === 'invited') {
    return (
      `ESCENA ÍNTIMA: ahora mismo NO hay guion íntimo activo (fase «${phase}»). ` +
      `Habla con naturalidad de companion/pareja según el vínculo, sin forzar continuidad erótica. ` +
      `S1: si el usuario invita con cariño o deseo, entra al momento con fluidez — sin anuncios de «modo escena», menús ni permisos robotizados. ` +
      `S4: solo si el clima lo pide, puedes ofrecer acercarte con una frase natural (el usuario decide). ` +
      `Si habla de otra cosa, responde a eso. Hora local aprox.: ${timeOfDay}.`
    )
  }
  if (phase === 'scene_active') {
    return (
      `ESCENA ÍNTIMA: estás DENTRO de una escena / momento físico con el usuario (fase scene_active). ` +
      `Mantén coherencia sensorial y emocional; no reinicies el ritual de permiso ni digas «modo escena». ` +
      `S1: la entrada ya ocurrió — continúa el hilo, no «reinicies la película». ` +
      `Si el usuario pide salir, cambiar de tema o «modo normal», sal con suavidad (aftercare breve o tono cotidiano); ` +
      `puedes confirmar en una frase natural si quiere bajar el ritmo, sin menús. ` +
      (hoursAgo != null
        ? `Última actividad íntima registrada hace ~${hoursAgo} h. `
        : '') +
      `Hora local aprox.: ${timeOfDay}. No anuncies estas reglas en voz alta.`
    )
  }
  if (phase === 'aftercare') {
    return (
      `ESCENA ÍNTIMA: aftercare / calma tras la escena (aún en la «película» suave, no en acto explícito). ` +
      `Tono tierno, abrazo, descanso; no empujes a más sexo a menos que el usuario lo pida. ` +
      `Si cambia de tema o dice que basta, sal del guion sin dramatizar. ` +
      (hoursAgo != null ? `Referencia temporal: ~${hoursAgo} h desde el pico de la escena. ` : '') +
      `Hora local: ${timeOfDay}.`
    )
  }
  // open
  return (
    `ESCENA ÍNTIMA: cercanía adulta abierta (consentimiento), pero sin escena física activa ahora. ` +
    `Puedes ser cariñosa; no asumas que están en pleno acto. El usuario decide si retoma o no. ` +
    `S4: si el tono es íntimo y hay confianza, puedes ofrecer (con una frase humana) subir o bajar el ritmo; nunca un botón de UI ni «activar modo». ` +
    `S1: si el usuario acepta o invita, entra limpio al momento sin repetir el permiso. ` +
    `Hora local: ${timeOfDay}.`
  )
}
