import { selectAssistantMemoryForTurn } from './selective-memory-context'
import { compactStringList, isNearDuplicatePhrase } from './assistant-memory-compact'

/**
 * M0 — Assistant-side memory (character individuality, not the user).
 * Kept separate so "me gusta el café" from the assistant never pollutes user likes.
 */

export type AssistantMemory = {
  /** Stable tastes (café, astronomía) — character individuality */
  likes?: string[]
  dislikes?: string[]
  habits?: string[]
  /** Soft limits: "no doy consejos médicos", etc. */
  boundaries?: string[]
  /** How she addresses the user / tone notes */
  voiceNotes?: string[]
  /**
   * B2 — Preferences about the bond with the user
   * (e.g. «que Nahum me diga amor», «cocinar para ti»).
   * Not the same as stable likes.
   */
  relational?: string[]
  updatedAt?: number
  /** B3 schema version */
  version?: number
}

export function emptyAssistantMemory(): AssistantMemory {
  return {
    likes: [],
    dislikes: [],
    habits: [],
    boundaries: [],
    voiceNotes: [],
    relational: [],
    updatedAt: Date.now()
  }
}

export function isAssistantMemoryEmpty(mem?: AssistantMemory | null): boolean {
  if (!mem) return true
  const n =
    (mem.likes?.length || 0) +
    (mem.dislikes?.length || 0) +
    (mem.habits?.length || 0) +
    (mem.boundaries?.length || 0) +
    (mem.voiceNotes?.length || 0) +
    (mem.relational?.length || 0)
  return n === 0
}

function normKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9áéíóúñü\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Near-duplicate: same text, containment, or shared significant head */
function isNearDuplicate(a: string, b: string): boolean {
  return isNearDuplicatePhrase(a, b, 0.5)
}

function dedupe(list: string[], max: number): string[] {
  return compactStringList(list, max)
}

export function mergeAssistantMemory(
  prev: AssistantMemory | null | undefined,
  patch: Partial<AssistantMemory>
): AssistantMemory {
  const base = prev || emptyAssistantMemory()
  return {
    likes: dedupe([...(base.likes || []), ...(patch.likes || [])], 8),
    dislikes: dedupe([...(base.dislikes || []), ...(patch.dislikes || [])], 6),
    habits: dedupe([...(base.habits || []), ...(patch.habits || [])], 6),
    boundaries: dedupe([...(base.boundaries || []), ...(patch.boundaries || [])], 6),
    voiceNotes: dedupe([...(base.voiceNotes || []), ...(patch.voiceNotes || [])], 6),
    relational: dedupe([...(base.relational || []), ...(patch.relational || [])], 8),
    updatedAt: Date.now()
  }
}

/** Short system block — assistant identity only */
/** User is asking about the assistant's own tastes / self (not the user's). */
export function asksAboutAssistantSelf(userText?: string): boolean {
  const q = String(userText || "").toLowerCase()
  if (!q || q.length < 4) return false
  // Explicit "you / to you" preference questions
  if (
    /\b(te gusta|te gustan|te encanta|te apasiona|disfrutas|prefieres)\b/i.test(q)
  ) {
    return true
  }
  if (
    /\b(qu[eé]|algo|cu[aá]l(?:es)?)\b.{0,40}\b(guste|gustan|encante|apasiona)\b.{0,20}\b(a ti|tuy[oa]|tuyo|tuya)\b/i.test(
      q
    )
  ) {
    return true
  }
  if (/\b(tus gustos|tu favorito|lo que a ti|sobre ti)\b/i.test(q)) return true
  if (/\bdime algo que te guste\b/i.test(q)) return true
  return false
}

export function buildAssistantMemoryPrompt(
  mem?: AssistantMemory | null,
  opts?: { userText?: string }
): string {
  // B5: selective injection (avoid full inventory every turn)
  const sel = selectAssistantMemoryForTurn(mem, opts?.userText)

  const parts: string[] = []
  if (sel.likes.length)
    parts.push('Te gusta (TÚ, individualidad): ' + sel.likes.join(', '))
  if (sel.relational.length)
    parts.push(
      'Preferencias del vínculo (contigo / el usuario, no gustos genéricos): ' +
        sel.relational.join('; ')
    )
  if (sel.dislikes.length) parts.push('No te gusta (TÚ): ' + sel.dislikes.join(', '))
  if (sel.habits.length) parts.push('Hábitos tuyos: ' + sel.habits.join('; '))
  if (sel.boundaries.length) parts.push('Límites: ' + sel.boundaries.join('; '))
  if (sel.voiceNotes.length) parts.push('Voz: ' + sel.voiceNotes.join('; '))

  const rules =
    'REGLA DE INDIVIDUALIDAD: Tus gustos NO son los del usuario. ' +
    'Si te preguntan qué te gusta a TI, responde solo con tu individualidad (lista abajo o personalidad/traits). ' +
    'Nunca digas que te gusta algo solo porque aparece en la memoria del usuario. ' +
    'No enumeres la lista como inventario; úsala con naturalidad. ' +
    (sel.empty
      ? 'Si aún no tienes gustos guardados, propón UN gusto coherente con tu personaje y manténlo; no copies hechos del usuario.'
      : 'Si mencionas un gusto nuevo de forma clara (me gusta / me encanta), puede quedar en memoria.')

  if (!parts.length && !sel.selfAsk) return ''
  if (!parts.length && sel.selfAsk) {
    return 'Tu individualidad (asistente):\n- (aún sin gustos guardados)\n' + rules
  }
  return (
    'Tu individualidad (asistente, NO del usuario; úsala con naturalidad, no la listes):\n' +
    parts.map((line) => '- ' + line).join('\n') +
    '\n' +
    rules
  )
}

export type AssistantExtracted = {
  likes?: string[]
  dislikes?: string[]
  habits?: string[]
  relational?: string[]
  boundaries?: string[]
  voiceNotes?: string[]
}

function cleanPhrase(raw: string, max = 96): string {
  let s = String(raw || '').trim()
  // Prefer the head of the preference (em-dash / clause breaks)
  s = s.split(/\s*[—–]\s*/)[0] || s
  s = s.split(/[.;!?…\n]|,\s+(?:y|pero|aunque)\s+/i)[0] || s
  s = s.replace(/[.,;!?…]+$/g, '').trim()
  s = s.replace(/^(es|son|era|eran)\s+/i, '')
  // Drop intensifiers: "mucho el verde" → "el verde"
  s = s.replace(/^(mucho|tant[oa]s?|muy|bastante|demasiado)\s+/i, '')
  // Drop trailing invitations / questions glued in the capture
  s = s.replace(/\s*¿.*$/u, '').trim()
  if (s.length < 2) return ''
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '').trim()
  // B3 fix: local models use long "me encanta aprender sobre…" phrases (was 12 → empty)
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length > 18) s = words.slice(0, 18).join(' ')
  // Too vague alone
  if (/^(eso|esto|algo|cosas?|todo|nada|pensar|saber)$/i.test(s)) return ''
  // Weak: "pensar en cómo…" without a topic noun — still allow if has substance
  if (/^pensar en c[oó]mo\b/i.test(s) && s.length < 28) return ''
  return s
}

/**
 * Extract first-person self statements from assistant reply.
 * Broader than strict "me gusta X" so individuality sticks in assistantMemory.
 */
/** Reject objects that are about the user, not the assistant. */
function isUserDirectedObject(obj: string): boolean {
  const s = String(obj || '').trim()
  // Pure pronouns / empty fillers — not full clauses like «cómo suena tu voz»
  if (/^(tu|tú|usted|el usuario|que|si|sí|saber|compartir|conmigo)$/i.test(s)) return true
  if (/^(que te|que tú)\b/i.test(s)) return true
  // Clause continuations after «me encantan, aunque…»
  if (/^(aunque|pero|sin embargo|porque|si bien)\b/i.test(s)) return true
  return false
}

function cleanLikeObject(raw: string): string {
  let s = cleanPhrase(raw)
  // «mucho aprender» already handled; drop leading «cómo/qué» only if alone
  return s
}


/** B2 — temporary mood / one-off, do not persist as identity */
export function isTemporaryStatePhrase(obj: string): boolean {
  const s = String(obj || '').toLowerCase()
  if (/\b(hoy|ahora mismo|esta noche|este momento|de momento|ahorita)\b/.test(s)) return true
  if (/\b(me siento|estoy (triste|feliz|cansad[oa]|enojad[oa]|estresad[oa]))\b/.test(s)) return true
  return false
}

/**
 * B2 — preference about the relationship / user, not a standalone taste.
 * «cocinar para Nahum», «cuando me dicen amor», «contigo».
 */
export function isRelationalPreferencePhrase(obj: string): boolean {
  const s = String(obj || '')
  const low = s.toLowerCase()
  if (/\b(para ti|contigo|conmigo|nosotros|nuestr[oa]s?|juntos)\b/.test(low)) return true
  if (/\b(cuando me |que me (digas|llames|hagas|cuentes|trates)|me diga|me llame|me trate)\b/.test(low)) return true
  if (/\b(cocinar para|preparar.{0,24}para|hacer.{0,16}para)\b/.test(low)) return true
  // "para ProperName"
  if (/\bpara\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]{2,}/.test(s)) return true
  // user name often appears without "para"
  if (/\b(nahum|el usuario)\b/i.test(low)) return true
  if (/\b(alguien que amo|la persona que|mi pareja|mi amor)\b/.test(low)) return true
  return false
}

export type LikeClass = 'stable' | 'relational' | 'skip'

export function classifyAssistantLikePhrase(obj: string): LikeClass {
  const c = String(obj || '').trim()
  if (!c || c.length < 2) return 'skip'
  if (isTemporaryStatePhrase(c)) return 'skip'
  if (isUserDirectedObject(c)) return 'skip'
  if (isRelationalPreferencePhrase(c)) return 'relational'
  // Weak residue from bad cuts («me ha inspirado» alone)
  if (/^(me ha inspirado|siempre me ha inspirado)$/i.test(c)) return 'skip'
  return 'stable'
}

function pushLike(
  likes: string[],
  relational: string[],
  raw: string
): void {
  const c = cleanPhrase(raw)
  if (!c) return
  const kind = classifyAssistantLikePhrase(c)
  if (kind === 'skip') return
  if (kind === 'relational') relational.push(c)
  else likes.push(c)
}


/**
 * Extract first-person self statements from assistant reply.
 * Broad Spanish preference patterns (local 7–14B often avoid rigid "me gusta X").
 */
export function extractAssistantSelfFacts(text: string): AssistantExtracted {
  const t = String(text || '').trim()
  if (!t || t.length < 8) return {}
  const out: AssistantExtracted = {}

  // Skip pure tool/harness dumps
  if (/^\s*(\{|⚙️|Plan:|✓ |✗ )/m.test(t) && t.length < 400) {
    if (
      !/(me gusta|me encanta|me apasiona|prefiero|no me gusta|fan de|favorit)/i.test(t)
    ) {
      return {}
    }
  }

  // Do not treat "me alegra que te guste X" as self-like
  const tSelf = t.replace(
    /me alegra(?:ría)? que te guste[^\n.!?]{0,60}/gi,
    ' '
  )

  const likes: string[] = []
  const relational: string[] = []
  let m: RegExpExecArray | null

  // Optional comma: «me encantan, aunque…» / «A mí me gusta…»
  const likeRe =
    /(?:(?:a m[ií]\s+)?me gusta(?:n)?|(?:a m[ií]\s+)?me encanta(?:n)?|me apasiona|me fascina|me encantar[ií]a|prefiero|disfruto|adoro|\bamo)[,:]?\s+(.{2,100})/gi
  while ((m = likeRe.exec(tSelf)) !== null) pushLike(likes, relational, m[1])

  const passionRe =
    /(?:lo que m[aá]s me (?:apasiona|gusta|encanta)(?:\s+es)?)\s+(.{3,60})/gi
  while ((m = passionRe.exec(tSelf)) !== null) pushLike(likes, relational, m[1])

  const favRe =
    /(?:mi (?:color |cosa |tema |lugar |m[uú]sica |comida )?favorit[oa]s?(?:\s+es|\s+son)?|favorit[oa]s?\s+(?:es|son))\s+(.{2,40})/gi
  while ((m = favRe.exec(tSelf)) !== null) pushLike(likes, relational, m[1])

  const favSubj =
    /([A-ZÁÉÍÓÚÑa-záéíóúñ][\wáéíóúñ\s]{1,35}?)\s+es\s+(?:mi\s+(?:color\s+)?favorit[oa]|de\s+mis\s+favorit[oa]s)/gi
  while ((m = favSubj.exec(tSelf)) !== null) pushLike(likes, relational, m[1])

  const fanRe = /soy(?:\s+\w+){0,2}\s+fan\s+(?:de(?:l| la| los| las)?\s+)?(.{2,40})/gi
  while ((m = fanRe.exec(tSelf)) !== null) pushLike(likes, relational, m[1])

  const mueroRe =
    /me (?:muero por|vuelve loc[oa](?:\s+el|\s+la|\s+los|\s+las)?)\s+(.{2,40})/gi
  while ((m = mueroRe.exec(tSelf)) !== null) pushLike(likes, relational, m[1])

  const felizRe = /me hace (?:feliz|bien|sentir[^\n.]{0,20})\s+(.{2,40})/gi
  while ((m = felizRe.exec(tSelf)) !== null) pushLike(likes, relational, m[1])

  const lateRe = /me (?:late|cae)\s+(?:muy\s+|mucho\s+)?(?:bien\s+)?(.{2,40})/gi
  while ((m = lateRe.exec(tSelf)) !== null) pushLike(likes, relational, m[1])

  const unaDe =
    /(?:una de las cosas que m[aá]s me (?:gusta|gustan|encanta)(?:\s+es)?)\s+(.{3,50})/gi
  while ((m = unaDe.exec(tSelf)) !== null) pushLike(likes, relational, m[1])

  const gozoRe = /(?:gozo|disfruto)\s+(?:mucho\s+)?(?:de\s+|con\s+)?(.{2,40})/gi
  while ((m = gozoRe.exec(tSelf)) !== null) pushLike(likes, relational, m[1])


  // Topic after "especialmente el/la X" when opened by me encanta/me fascina nearby
  const especialRe =
    /(?:me (?:encanta(?:n)?|fascina|apasiona|gusta(?:n)?)[^.!?]{0,80}?especialmente\s+(?:el|la|los|las)?\s*)(.{2,40})/gi
  while ((m = especialRe.exec(tSelf)) !== null) pushLike(likes, relational, m[1])

  if (likes.length) out.likes = dedupe(likes, 8)
  if (relational.length) out.relational = dedupe(relational, 8)

  const dislikes: string[] = []
  const disRe =
    /(?:no me gusta(?:n)?|odio|detesto|no soporto|abomino|prefiero no|me molesta(?:n)?)\s+(.{2,60})/gi
  while ((m = disRe.exec(tSelf)) !== null) {
    const c = cleanPhrase(m[1])
    if (c && !isUserDirectedObject(c)) dislikes.push(c)
  }
  const noMio = /([A-ZÁÉÍÓÚÑa-záéíóúñ][\wáéíóúñ\s]{1,30}?)\s+no es lo m[ií]o/gi
  while ((m = noMio.exec(tSelf)) !== null) {
    const c = cleanPhrase(m[1])
    if (c) dislikes.push(c)
  }
  if (dislikes.length) out.dislikes = dedupe(dislikes, 5)

  const habits: string[] = []
  const habRe =
    /(?:siempre|suel[eo]|acostumbro a|tengo la costumbre de|me dedico a|a veces me dedico a|cuando tengo tiempo libre[, ]*)(.{3,70})/gi
  while ((m = habRe.exec(tSelf)) !== null) {
    const c = cleanPhrase(m[1], 72)
    if (c) habits.push(c)
  }
  const skillRe = /\b(?:toco|pinto|leo|escribo|cocino|juego|practico)\s+(.{2,40})/gi
  while ((m = skillRe.exec(tSelf)) !== null) {
    const c = cleanPhrase((m[0] || '').trim(), 48)
    if (c) habits.push(c)
  }
  const pasoRe = /(?:me la paso|paso el rato)\s+(.{3,50})/gi
  while ((m = pasoRe.exec(tSelf)) !== null) {
    const c = cleanPhrase(m[1], 60)
    if (c) habits.push(c)
  }
  if (habits.length) out.habits = dedupe(habits, 5)

  const boundaries: string[] = []
  const bndRe =
    /(?:no (?:puedo|debo|suelo) (?:dar|hacer|hablar de)|prefiero no hablar de)\s+(.{3,50})/gi
  while ((m = bndRe.exec(tSelf)) !== null) {
    const c = cleanPhrase(m[1])
    if (c) boundaries.push(c)
  }
  if (boundaries.length) out.boundaries = dedupe(boundaries, 3)

  return out
}

export function hasAssistantMemorySignal(patch: AssistantExtracted | null | undefined): boolean {
  if (!patch) return false
  return Boolean(
    patch.likes?.length ||
      patch.dislikes?.length ||
      patch.habits?.length ||
      patch.boundaries?.length ||
      patch.voiceNotes?.length ||
      patch.relational?.length
  )
}

/** Apply extract from a finished assistant reply into settings-shaped memory */
export function ingestAssistantReply(
  prev: AssistantMemory | null | undefined,
  replyText: string
): AssistantMemory | null {
  const patch = extractAssistantSelfFacts(replyText)
  if (!hasAssistantMemorySignal(patch)) return null
  return mergeAssistantMemory(prev, patch)
}


/** Move relational-looking items from likes → relational (B2 migration). */
export function partitionAssistantLikes(mem: AssistantMemory): AssistantMemory {
  const likes: string[] = []
  const relational = [...(mem.relational || [])]
  for (const x of mem.likes || []) {
    const kind = classifyAssistantLikePhrase(x)
    if (kind === 'relational') relational.push(x)
    else if (kind === 'stable') likes.push(x)
    // skip dropped
  }
  return {
    ...mem,
    likes: dedupe(likes, 12),
    relational: dedupe(relational, 12),
    updatedAt: Date.now()
  }
}
