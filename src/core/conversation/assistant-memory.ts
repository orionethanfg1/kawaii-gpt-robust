import { extractFavorites, favoritesToStrings, mergeFavoriteStrings } from './favorites'
import { selectAssistantMemoryForTurn } from './selective-memory-context'
import { compactStringList, isNearDuplicatePhrase } from './assistant-memory-compact'

/**
 * M0 — Assistant-side memory (character individuality, not the user).
 * Kept separate so "me gusta el café" from the assistant never pollutes user likes.
 */

export type AssistantMemory = {
  /**
   * How she/he likes to be addressed by the user (apodos aceptados).
   * Separate from character.canonical name and from the user's preferredName.
   */
  preferredNames?: string[]
  /** Names she rejected or asked not to use */
  rejectedNames?: string[]
  /**
   * Soft personality evolution notes accumulated over time
   * (e.g. «más confiada tras X», «bromea más contigo»).
   * Not a full rewrite of the ficha — additive signal for the prompt.
   */
  growthNotes?: string[]
  /** Stable tastes (café, astronomía) — character individuality */
  likes?: string[]
  /** Cosas favoritas explícitas (color, comida, …) */
  favorites?: string[]
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
    preferredNames: [],
    rejectedNames: [],
    growthNotes: [],
    likes: [],
    favorites: [],
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
    (mem.preferredNames?.length || 0) +
    (mem.rejectedNames?.length || 0) +
    (mem.growthNotes?.length || 0) +
    (mem.likes?.length || 0) +
    (mem.favorites?.length || 0) +
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

/** Drop RP residue already stored in lists. */
export function sanitizeAssistantMemoryLists(mem: AssistantMemory): AssistantMemory {
  const names = (mem.preferredNames || []).filter((n) => looksLikeAddressName(n))
  const rejected = (mem.rejectedNames || []).filter((n) => looksLikeAddressName(n))
  const likes: string[] = []
  const relational = [...(mem.relational || [])]
  for (const x of mem.likes || []) {
    if (looksLikeMemoryNoisePhrase(x)) continue
    const kind = classifyAssistantLikePhrase(x)
    if (kind === 'stable') likes.push(x)
    else if (kind === 'relational') relational.push(x)
  }
  const favorites = (mem.favorites || []).filter((x) => !looksLikeMemoryNoisePhrase(x))
  const habits = (mem.habits || []).filter((x) => !looksLikeMemoryNoisePhrase(x) && x.length <= 72)
  const dislikes = (mem.dislikes || []).filter((x) => !looksLikeMemoryNoisePhrase(x))
  const growthNotes = (mem.growthNotes || []).filter((x) => !looksLikeMemoryNoisePhrase(x) && x.length <= 120)
  return {
    ...mem,
    preferredNames: dedupe(names, 8),
    rejectedNames: dedupe(rejected, 6),
    likes: dedupe(likes, 8),
    favorites: dedupe(favorites, 10),
    dislikes: dedupe(dislikes, 6),
    habits: dedupe(habits, 6),
    growthNotes: dedupe(growthNotes, 10),
    relational: dedupe(
      relational.filter((x) => !looksLikeMemoryNoisePhrase(x)),
      8
    ),
    updatedAt: mem.updatedAt || Date.now()
  }
}

export function mergeAssistantMemory(
  prev: AssistantMemory | null | undefined,
  patch: Partial<AssistantMemory>
): AssistantMemory {
  const base = prev || emptyAssistantMemory()
  const merged: AssistantMemory = {
    preferredNames: dedupe([...(base.preferredNames || []), ...(patch.preferredNames || [])], 8),
    rejectedNames: dedupe([...(base.rejectedNames || []), ...(patch.rejectedNames || [])], 6),
    growthNotes: dedupe([...(base.growthNotes || []), ...(patch.growthNotes || [])], 10),
    likes: dedupe([...(base.likes || []), ...(patch.likes || [])], 8),
    favorites: dedupe([...(base.favorites || []), ...(patch.favorites || [])], 10),
    dislikes: dedupe([...(base.dislikes || []), ...(patch.dislikes || [])], 6),
    habits: dedupe([...(base.habits || []), ...(patch.habits || [])], 6),
    boundaries: dedupe([...(base.boundaries || []), ...(patch.boundaries || [])], 6),
    voiceNotes: dedupe([...(base.voiceNotes || []), ...(patch.voiceNotes || [])], 6),
    relational: dedupe([...(base.relational || []), ...(patch.relational || [])], 8),
    updatedAt: Date.now()
  }
  return sanitizeAssistantMemoryLists(merged)
}

/** Short system block — assistant identity only */
/** User is asking about the assistant's own tastes / self (not the user's). */
export function asksAboutAssistantSelf(userText?: string): boolean {
  const q = String(userText || '').toLowerCase()
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
  if (/\bc[oó]mo te gusta que te (llamen|diga|digan)\b/i.test(q)) return true
  return false
}

/**
 * Alias used by the memory collector: when true, schedule optional LLM enrich
 * after a heuristic write (user asked about the assistant's preferences).
 */
export function isAssistantPreferenceQuestion(userText?: string): boolean {
  return asksAboutAssistantSelf(userText)
}

export function buildAssistantMemoryPrompt(
  mem?: AssistantMemory | null,
  opts?: { userText?: string }
): string {
  // B5: selective injection (avoid full inventory every turn)
  const sel = selectAssistantMemoryForTurn(mem, opts?.userText)

  const parts: string[] = []
  const prefNames = (mem?.preferredNames || []).filter(Boolean).slice(0, 6)
  const rejNames = (mem?.rejectedNames || []).filter(Boolean).slice(0, 4)
  const growth = (mem?.growthNotes || []).filter(Boolean).slice(-4)
  if (prefNames.length) {
    parts.push(
      'CÓMO TE GUSTA QUE TE LLAMEN A TI (asistente — NO confundir con el nombre del usuario): ' +
        prefNames.join(', ') +
        '. Si te preguntan cómo te gusta que te llamen, prioriza esta lista y tu nombre de ficha. ' +
        'Si el usuario usa uno de estos apodos, reconócelo: forma parte de vuestra historia.'
    )
  } else {
    parts.push(
      'CÓMO TE GUSTA QUE TE LLAMEN A TI: aún no hay apodos en memoria. ' +
        'Puedes preferir tu nombre de personaje y apodos cariñosos; si el usuario ya te ha llamado de una forma especial, acógelo.'
    )
  }
  if (rejNames.length) {
    parts.push('Prefieres que NO te digan (a TI): ' + rejNames.join(', '))
  }
  if (growth.length) {
    parts.push(
      'Evolución reciente de tu vínculo/personalidad (no inventes de más; úsalo con sutileza): ' +
        growth.join('; ')
    )
  }
  if (sel.favorites?.length)
    parts.push('Tus favoritos (TÚ): ' + sel.favorites.join(', '))
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
    'Si hay un favorito o gusto abajo, puedes mencionarlo de pasada cuando encaje (máximo uno por mensaje), sin forzar. ' +
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
  preferredNames?: string[]
  rejectedNames?: string[]
  growthNotes?: string[]
  likes?: string[]
  dislikes?: string[]
  favorites?: string[]
  habits?: string[]
  relational?: string[]
  boundaries?: string[]
  voiceNotes?: string[]
}

function cleanPhrase(raw: string, max = 96): string {
  let s = String(raw || '').trim()
  // Prefer the head of the preference (em-dash / clause breaks)
  s = s.split(/\s*[—–]\s*/)[0] || s
  s = s.split(/[.;!?…\n]|,\s+(?:y|pero|aunque|cuando|mientras|de verdad|en serio|la verdad)\s+/i)[0] || s
  s = s.replace(/,\s*(?:de verdad|en serio|la verdad|sabes|eh)\s*$/i, '').trim()
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
  if (/^(tu|tú|usted|el usuario|que|si|sí|saber|compartir|conmigo|así|eso|esto|aquello)$/i.test(s)) return true
  if (/^(que te|que tú|eso de|lo de)\b/i.test(s)) return true
  // Clause continuations after «me encantan, aunque…»
  if (/^(aunque|pero|sin embargo|porque|si bien|cuando|como|cómo)\b/i.test(s)) return true
  // Roleplay / narrative about the user, not a stable taste
  if (/\b(te sonrojas|hablo de|contigo|a ti|de ti|tu voz|tus ojos)\b/i.test(s)) return true
  return false
}

/**
 * Stable likes should look like topics (café, astronomía), not narrative fragments
 * that merely followed «me gusta» in romantic prose.
 */
export function isStableTopicPhrase(obj: string): boolean {
  const c = String(obj || '').trim()
  if (c.length < 2 || c.length > 40) return false
  if (/[*_~`]/.test(c)) return false
  // Too many words → likely a sentence fragment / RP
  const words = c.split(/\s+/).filter(Boolean)
  if (words.length > 5) return false
  // Infinitives / soft cognition openings are RP residue
  if (/^(pensar|imaginar|sentir|saber|decir|ver|hacer|querer|poder|deber|quedarme|volver|construir)\b/i.test(c)) {
    return false
  }
  if (/^(cómo|como|qué|que|cuándo|cuando|dónde|donde|por qué|porque|mientras|aunque)\b/i.test(c)) {
    return false
  }
  if (/^(orden|algo|cosas?|eso|esto|nada|todo|tuya|tuyo|mía|mío|cuidada|seguro|segura)\b/i.test(c)) {
    return false
  }
  // Vocatives / endearments are not "likes"
  if (/^(querida|querido|amor|cariño|mi vida|cielo|princesa)\b/i.test(c)) return false
  // Possessive relationship residue from RP
  if (/^(a tu lado|tu lado|mi lado)\b/i.test(c)) return false
  if (/\b(sacrificio|ritmo|sólido donde|una sobre la otra)\b/i.test(c)) return false
  // Must contain at least one content-looking token (letter length >= 3) that is not a stopword
  const stop = new Set(
    'el|la|los|las|un|una|de|del|en|con|por|para|y|o|a|al|me|te|se|mi|tu|su'.split('|')
  )
  const content = words.filter((w) => w.length >= 3 && !stop.has(w.toLowerCase()))
  if (!content.length) return false
  return true
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
  if (isRelationalPreferencePhrase(c)) return 'relational'
  if (isUserDirectedObject(c)) return 'skip'
  // Weak residue from bad cuts («me ha inspirado» alone)
  if (/^(me ha inspirado|siempre me ha inspirado)$/i.test(c)) return 'skip'
  // Heuristic path: high precision only — LLM path can add richer tastes later
  if (!isStableTopicPhrase(c)) return 'skip'
  return 'stable'
}

function pushLike(
  likes: string[],
  relational: string[],
  raw: string,
  acceptExplicitActivity = false
): void {
  const c = cleanPhrase(raw).replace(
    /\s+(?:por|en)\s+(?:(?:la|el)\s+)?(?:ma[nñ]ana|noche|tarde|madrugada|las ma[nñ]anas|las noches)$/i,
    ''
  )
  if (!c) return
  const kind = classifyAssistantLikePhrase(c)
  if (kind === 'skip') {
    if (acceptExplicitActivity && isPreferenceActivityPhrase(c)) {
      likes.push(c)
    }
    return
  }
  if (kind === 'relational') relational.push(c)
  else likes.push(c)
}

export function isPreferenceActivityPhrase(raw: string): boolean {
  const phrase = String(raw || '').trim()
  const words = phrase.split(/\s+/).filter(Boolean)
  return (
    words.length >= 3 &&
    words.length <= 8 &&
    /^(?:ver|mirar|escuchar|leer|aprender|cocinar|caminar|pintar|escribir|hablar)\b/i.test(
      phrase
    ) &&
    !/\b(?:yo|t[uú]|ti|usuario|mientras|ahora|hoy)\b/i.test(phrase)
  )
}


/**
 * Extract first-person self statements from assistant reply.
 * Broad Spanish preference patterns (local 7–14B often avoid rigid "me gusta X").
 */
export function extractAssistantSelfFacts(text: string, userText?: string): AssistantExtracted {
  const t = String(text || '').trim()
  if (!t || t.length < 8) return {}
  const prompt = String(userText || '')
  if (
    /\b(?:genera|crea|haz|dibuja|edita|imagina|describe|contin[uú]a)\b.{0,100}\b(?:escena|foto|imagen|selfie|retrato)\b/i.test(
      prompt
    ) ||
    /\b(?:escena|foto|imagen|selfie|retrato)\b.{0,100}\b(?:genera|crea|haz|dibuja|edita|imagina|describe)\b/i.test(
      prompt
    ) ||
    /\b(?:role[\s-]?play|interpreta(?:me)?|act[uú]a como)\b/i.test(prompt)
  ) {
    return {}
  }
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
  const explicitPreferenceQuestion = isAssistantPreferenceQuestion(userText)
  let m: RegExpExecArray | null

  // Optional comma: «me encantan, aunque…» / «A mí me gusta…»
  const likeRe =
    /(?:(?:a m[ií]\s+)?me gusta(?:n)?|(?:a m[ií]\s+)?me encanta(?:n)?|me apasiona|me fascina|prefiero|disfruto|adoro)[,:]?\s+(.{2,48}?)(?=\s*[.,;!?…]|\s+(?:pero|aunque|porque|cuando|y(?:\s+(?:me|también))?)|$)/gi
  while ((m = likeRe.exec(tSelf)) !== null)
    pushLike(likes, relational, m[1], explicitPreferenceQuestion)

  const passionRe =
    /(?:lo que m[aá]s me (?:apasiona|gusta|encanta)(?:\s+es)?)\s+(.{3,60})/gi
  while ((m = passionRe.exec(tSelf)) !== null)
    pushLike(likes, relational, m[1], explicitPreferenceQuestion)

  const favRe =
    /(?:mi (?:color |cosa |tema |lugar |m[uú]sica |comida )?favorit[oa]s?(?:\s+es|\s+son)?|favorit[oa]s?\s+(?:es|son))\s+(.{2,40})/gi
  while ((m = favRe.exec(tSelf)) !== null)
    pushLike(likes, relational, m[1], explicitPreferenceQuestion)

  const favSubj =
    /([A-ZÁÉÍÓÚÑa-záéíóúñ][\wáéíóúñ\s]{1,35}?)\s+es\s+(?:mi\s+(?:color\s+)?favorit[oa]|de\s+mis\s+favorit[oa]s)/gi
  while ((m = favSubj.exec(tSelf)) !== null)
    pushLike(likes, relational, m[1], explicitPreferenceQuestion)

  const fanRe = /soy(?:\s+\w+){0,2}\s+fan\s+(?:de(?:l| la| los| las)?\s+)?(.{2,40})/gi
  while ((m = fanRe.exec(tSelf)) !== null)
    pushLike(likes, relational, m[1], explicitPreferenceQuestion)

  const mueroRe =
    /me (?:muero por|vuelve loc[oa](?:\s+el|\s+la|\s+los|\s+las)?)\s+(.{2,40})/gi
  while ((m = mueroRe.exec(tSelf)) !== null)
    pushLike(likes, relational, m[1], explicitPreferenceQuestion)

  const felizRe = /me hace (?:feliz|bien|sentir[^\n.]{0,20})\s+(.{2,40})/gi
  while ((m = felizRe.exec(tSelf)) !== null)
    pushLike(likes, relational, m[1], explicitPreferenceQuestion)

  const lateRe = /me (?:late|cae)\s+(?:muy\s+|mucho\s+)?(?:bien\s+)?(.{2,40})/gi
  while ((m = lateRe.exec(tSelf)) !== null)
    pushLike(likes, relational, m[1], explicitPreferenceQuestion)

  const unaDe =
    /(?:una de las cosas que m[aá]s me (?:gusta|gustan|encanta)(?:\s+es)?)\s+(.{3,50})/gi
  while ((m = unaDe.exec(tSelf)) !== null)
    pushLike(likes, relational, m[1], explicitPreferenceQuestion)

  const gozoRe = /(?:gozo|disfruto)\s+(?:mucho\s+)?(?:de\s+|con\s+)?(.{2,40})/gi
  while ((m = gozoRe.exec(tSelf)) !== null)
    pushLike(likes, relational, m[1], explicitPreferenceQuestion)


  // Topic after "especialmente el/la X" when opened by me encanta/me fascina nearby
  const especialRe =
    /(?:me (?:encanta(?:n)?|fascina|apasiona|gusta(?:n)?)[^.!?]{0,80}?especialmente\s+(?:el|la|los|las)?\s*)(.{2,40})/gi
  while ((m = especialRe.exec(tSelf)) !== null)
    pushLike(likes, relational, m[1], explicitPreferenceQuestion)

  if (likes.length) out.likes = dedupe(likes, 8)
  const favs = favoritesToStrings(extractFavorites(tSelf))
  if (favs.length) {
    out.favorites = favs
    // also mirror into likes so selective prompt still sees them
    out.likes = dedupe([...(out.likes || []), ...favs.map((f) => f.includes(':') ? f.split(':').pop()!.trim() : f)], 8)
  }
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
    /(?:siempre|suel[eo]|acostumbro a|tengo la costumbre de|me dedico a|cuando tengo tiempo libre[, ]*)(.{3,70})/gi
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
  if (habits.length) {
    out.habits = dedupe(
      habits.filter((h) => isStableTopicPhrase(h) || /^(toco|pinto|leo|escribo|cocino)\b/i.test(h)),
      5
    )
    if (!out.habits.length) delete out.habits
  }

  const boundaries: string[] = []
  const bndRe =
    /(?:no (?:puedo|debo|suelo) (?:dar|hacer|hablar de)|prefiero no hablar de)\s+(.{3,50})/gi
  while ((m = bndRe.exec(tSelf)) !== null) {
    const c = cleanPhrase(m[1])
    if (c) boundaries.push(c)
  }
  if (boundaries.length) out.boundaries = dedupe(boundaries, 3)

  try {
    const names = extractAssistantPreferredNames(tSelf, userText)
    if (names.preferredNames?.length) out.preferredNames = names.preferredNames
    if (names.rejectedNames?.length) out.rejectedNames = names.rejectedNames
  } catch {
    /* */
  }

  return out
}

export function hasAssistantMemorySignal(patch: AssistantExtracted | null | undefined): boolean {
  if (!patch) return false
  return Boolean(
    patch.preferredNames?.length ||
      patch.rejectedNames?.length ||
      patch.growthNotes?.length ||
      patch.likes?.length ||
      patch.favorites?.length ||
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



/** RP stage directions / prompt leaks — never durable memory */
export function looksLikeMemoryNoisePhrase(s: string): boolean {
  const t = String(s || '').trim()
  if (!t) return true
  if (t.length > 100) return true
  if (/[*_~`]/.test(t)) return true
  if (/^\s*\[APP\]/i.test(t)) return true
  if (/^\s*\(Acción de la aplicación/i.test(t)) return true
  if (/iniciativa\s*·|intimacy-propose|wardrobe-propose/i.test(t)) return true
  if (/^(mientras|cuando|en un|en una|al |tras |bajo )\b/i.test(t)) return true
  if (
    /\b(cruzo|pellizco|entrecortado|escurr|clavícula|jadeo|suspiro|recorro|deslizo)\b/i.test(
      t
    )
  ) {
    return true
  }
  if (/\b(sistema|prompt|token|llm|harness)\b/i.test(t) && t.length < 40) return true
  if (/^(tuyo|tuya|mío|mía|suyo|suya|lo mío|lo tuyo)$/i.test(t)) return true
  return false
}

/** Valid short nickname / name for addressing the assistant (not RP stage directions). */
function looksLikeAddressName(s: string): boolean {
  const t = String(s || '').trim()
  if (t.length < 2 || t.length > 36) return false
  // Stage directions / markdown emphasis from RP
  if (/[*_~`]/.test(t)) return false
  if (/\s{3,}/.test(t)) return false
  if (/^(tú|tu|tuyo|tuya|tuyos|tuyas|usted|mío|mía|suyo|suya)$/i.test(t)) return false
  if (/[.!?¿¡:;]/.test(t)) return false
  const spaces = (t.match(/\s+/g) || []).length
  if (spaces > 3) return false // «Mi princesa Celta» ok; frases largas no
  if (/^(que|si|sí|cómo|como|cuando|porque|para|con|mientras|aunque|pero|en un|en una)\b/i.test(t)) {
    return false
  }
  // Action / narration verbs typical of intimate RP, not nicknames
  if (
    /\b(cruzo|cruzar|pellizco|pellizcar|escurr|haces|hago|siento|jadeo|suspiro|beso|toco|recorro|deslizo|afierro|aferro)\b/i.test(
      t
    )
  ) {
    return false
  }
  if (/\b(tono|entrecortado|puerta|vestido|piel|clavícula|claviculas)\b/i.test(t) && spaces >= 1) {
    return false
  }
  // Must look like a name / endearment: letters, spaces, hyphens
  if (!/^[A-ZÁÉÍÓÚÑÜa-záéíóúñü][A-ZÁÉÍÓÚÑÜa-záéíóúñü\s'’-]*$/u.test(t)) return false
  return true
}

/**
 * Extract how the assistant likes to be called from assistant reply and/or user message.
 */
export function extractAssistantPreferredNames(
  assistantText: string,
  userText?: string
): { preferredNames?: string[]; rejectedNames?: string[] } {
  const a = String(assistantText || '')
  const u = String(userText || '')
  const preferred: string[] = []
  const rejected: string[] = []

  const pushP = (raw: string) => {
    const c = cleanPhrase(raw)
    if (!c || !looksLikeAddressName(c)) return
    preferred.push(c)
  }
  const pushR = (raw: string) => {
    const c = cleanPhrase(raw)
    if (!c || !looksLikeAddressName(c)) return
    rejected.push(c)
  }

  // Assistant: «me gusta que me digas X», «puedes llamarme X», «dime Niamh»
  const aAccept =
    /(?:me gusta(?:ría)? que me (?:digas|llames|trates de)|puedes (?:decirme|llamarme)|prefiero que me (?:digas|llames)|ll[aá]mame|dime)\s+["«]?([^"».\n,;!?]{2,28})["»]?/gi
  let m: RegExpExecArray | null
  while ((m = aAccept.exec(a)) !== null) pushP(m[1])

  // Assistant rejects: «no me digas X», «no me gusta que me llames X»
  const aRej =
    /(?:no me (?:digas|llames)|no me gusta que me (?:digas|llames)|prefiero que no me (?:digas|llames))\s+["«]?([^"».\n,;!?]{2,28})["»]?/gi
  while ((m = aRej.exec(a)) !== null) {
    const cand = cleanPhrase(m[1])
    // «no me digas así» is adverb, not a nickname
    if (!cand || /^(así|asi|eso|esto|nada|cosas?|tonterías?)$/i.test(cand)) continue
    if (!looksLikeAddressName(cand)) continue
    pushR(cand)
  }

  // User proposes + assistant soft-accept in same turn context is handled by collector;
  // also capture explicit user: «¿te puedo decir X?» when assistant later accepts — here from user alone seed proposal in relational
  const uPropose =
    /(?:te (?:puedo|puedo) (?:decir|llamar)|te digo|te llamo|¿(?:te puedo|puedo) (?:decir|llamar)(?:te)?)\s+["«]?([^"».\n,;!?]{2,28})["»]?/gi
  // If user proposes and assistant text accepts generically, take the proposed name
  const userProps: string[] = []
  while ((m = uPropose.exec(u)) !== null) {
    const c = cleanPhrase(m[1])
    if (c && looksLikeAddressName(c)) userProps.push(c)
  }
  if (userProps.length && /\b(s[ií]|claro|me gusta|me encanta|ok|perfecto|así|como quieras|como prefieras)\b/i.test(a)) {
    for (const p of userProps) preferred.push(p)
  }


  // User: «me encanta llamarte Mi princesa Celta»
  {
    const uLove = /(?:me encanta|me gusta|adoro|amo)\s+llamar(?:te)?\s+(?:así\s+)?["«]?([^"».\n]{2,40})["»]?/gi
    let mm: RegExpExecArray | null
    while ((mm = uLove.exec(u)) !== null) pushP(mm[1])
  }
  // User: «te digo X», «te llamo X», «puedo llamarte X»
  {
    const uPropose = /(?:te (?:puedo )?decir|te llamo|te digo|puedo llamarte|te puedo llamar)\s+["«]?([^"».\n,;!?]{2,40})["»]?/gi
    let mm: RegExpExecArray | null
    while ((mm = uPropose.exec(u)) !== null) pushP(mm[1])
  }
  {
    const uCuando = /cuando te (?:digo|llamo)\s+["«]?([^"».\n,;!?]{2,40})["»]?/gi
    let mm: RegExpExecArray | null
    while ((mm = uCuando.exec(u)) !== null) pushP(mm[1])
  }

  const out: { preferredNames?: string[]; rejectedNames?: string[] } = {}
  if (preferred.length) out.preferredNames = dedupe(preferred, 8)
  if (rejected.length) out.rejectedNames = dedupe(rejected, 6)
  return out
}

/**
 * Soft growth note from relationship milestones (caller supplies phrase).
 */
export function appendGrowthNote(
  prev: AssistantMemory | null | undefined,
  note: string
): AssistantMemory {
  const n = cleanPhrase(note)
  if (!n || n.length < 8) return prev || emptyAssistantMemory()
  return mergeAssistantMemory(prev, { growthNotes: [n] })
}

/** Names the user wants to call the assistant with (from user message alone). */
export function extractAssistantNamesFromUserOnly(userText: string): string[] {
  const r = extractAssistantPreferredNames('', userText)
  return r.preferredNames || []
}
