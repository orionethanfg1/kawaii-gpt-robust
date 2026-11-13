import { extractFavorites, favoritesToStrings, mergeFavoriteStrings } from './favorites'
/**
 * Long-term user memory for companion + harness continuity.
 *
 * Design (from companion apps 2025–26: Nomi/Kindroid-style structured notes):
 * - Host-owned facts, pinned high-priority anchors
 * - Named people, likes/dislikes, goals, emotional/relationship notes
 * - Never store full chat transcripts here — only curated facts
 * - Prompt injection: short, pinned first, "use naturally, don't list"
 */

export type MemoryFact = {
  text: string
  /** 0–1 importance; pinned => treated as high */
  importance?: number
  pinned?: boolean
  at?: number
  category?: 'general' | 'preference' | 'appearance' | 'goal' | 'person' | 'emotion' | 'work'
}

export type NamedPerson = {
  name: string
  relation?: string
  note?: string
}

export type UserMemory = {
  facts?: string[]
  /** Structured facts (preferred when present) */
  factEntries?: MemoryFact[]
  /**
   * Real / identity name of the human (e.g. Nahum).
   * Never fill from romantic phrases like «soy tuyo».
   */
  userName?: string
  /**
   * How they like to be addressed (apodo de trato), not legal identity.
   * Distinct from userName.
   */
  preferredName?: string
  nicknames?: string[]
  pendingNickname?: string
  appearanceNotes?: string
  avatarScenes?: string[]
  goals?: string[]
  currentFocus?: string
  /** People the user talks about */
  people?: NamedPerson[]
  likes?: string[]
  /** Cosas favoritas (color, comida, …) */
  favorites?: string[]
  dislikes?: string[]
  /** Soft emotional / relationship continuity */
  emotionalNotes?: string[]
  /** One-line arc: "estamos construyendo confianza", etc. */
  relationshipSummary?: string
  /** Standing rules from the user across chats */
  standingInstructions?: string[]
  /** Last time we actively used memory in a reply (host) */
  lastRecalledAt?: number
  updatedAt?: number
}

/** Words that must never be stored as a person's name */
export const INVALID_PERSON_NAME =
  /^(un|una|el|la|yo|t[uú]|tuyo|tuya|tuyos|tuyas|suyo|suya|m[ií]o|m[ií]a|nosotros|usted|vos|amor|cari[nñ]o|bebé|bebe|sky|user|usuario|de|del|en|con|para|muy|tan|solo|sólo|todo|toda|aqui|aquí|allá|asi|así|cu[aá]l|cu[aá]les|qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|qui[eé]n|porqu[eé]|cu[aá]nto|cu[aá]nta|cu[aá]ntos|cu[aá]ntas|esto|eso|aquello|nada|algo|alguien|nadie|siempre|nunca|ahora|hoy|mañana|si|sí|no|ok|vale|claro|mejor|peor|ambas|ambos|otra|otro|las|los|una|unos|unas)$/i

export function looksLikePersonName(raw: string): boolean {
  const s = String(raw || '').trim()
  if (s.length < 2 || s.length > 32) return false
  if (INVALID_PERSON_NAME.test(s)) return false
  if (/\s/.test(s)) return false
  // Prefer names, not full sentences
  if (!/^[\wÁÉÍÓÚÜÑáéíóúüñ'-]+$/i.test(s)) return false
  // Interrogatives / determiners that slip past the list
  if (/^(cu[aá]l|qu[eé]|c[oó]mo|qui[eé]n|d[oó]nde|cu[aá]ndo)/i.test(s)) return false
  // Pure function words already covered; reject very short all-lowercase Spanish particles
  if (s.length <= 4 && /^(me|te|se|lo|la|le|nos|os|les|al|del)$/i.test(s)) return false
  return true
}

/** Drop interrogatives / garbage that landed in name fields (e.g. «cuál»). */
export function sanitizeUserMemoryNames(mem?: UserMemory | null): UserMemory | null | undefined {
  if (!mem) return mem
  let changed = false
  const next = { ...mem }
  if (next.preferredName && !looksLikePersonName(next.preferredName)) {
    next.preferredName = next.userName && looksLikePersonName(next.userName) ? next.userName : undefined
    changed = true
  }
  if (next.userName && !looksLikePersonName(next.userName)) {
    next.userName = undefined
    changed = true
  }
  return changed ? { ...next, updatedAt: Date.now() } : mem
}


export type ExtractedFacts = {
  facts?: string[]
  standingInstructions?: string[]
  /** Identity name */
  userName?: string
  /** Address preference (llámame X) */
  preferredName?: string
  nicknames?: string[]
  pendingNickname?: string
  appearanceNotes?: string
  goals?: string[]
  currentFocus?: string
  people?: NamedPerson[]
  likes?: string[]
  /** Cosas favoritas (color, comida, …) */
  favorites?: string[]
  dislikes?: string[]
  emotionalNotes?: string[]
}

export function isExplicitRoleplayMemoryContext(text: string): boolean {
  if (
    /\b(?:role[\s-]?play|juego de rol|modo escena|escena íntima|narraci[oó]n f[ií]sica|interpreta(?:me)?|act[uú]a como)\b/i.test(
      text
    )
  ) {
    return true
  }
  const embodiedIntimacy =
    /\b(?:me besas|me acaricias|nos besamos|te desnudas|me desnudas|me tocas|me siento dentro|gemid|orgasmo|penetr|f[oó]ll|sexo)\b/i.test(
      text
    )
  const narrativeAction =
    /(?:^|\n)\s*(?:\*{1,2}|—|–)\s*[^.\n]{0,180}\b(?:me bes|me acaric|nos bes|te desnud|me desnud|me toc|me acerco|te abrazo)\w*/i.test(
      text
    )
  return embodiedIntimacy || narrativeAction
}

function extractExplicitSceneRelationshipPreference(text: string): string | undefined {
  const match = text.match(
    /\b(?:me gusta|me encanta|prefiero|no me gusta|me incomoda)\b[^.!?]{0,100}\b(?:bes\w*|acarici\w*|abraz\w*|estar contigo|sentirme cerca)\b/i
  )
  return match?.[0]?.replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** Clean noisy like fragments. Reject pronouns, broken parens, pure names. */
export function normalizeLikePhrase(raw: string): string {
  let s = String(raw || "").trim()
  if (!s) return ""
  s = s.replace(/[.,;!?]+$/g, "").trim()
  s = s.replace(/^(es|son|era|eran)\s+(el|la|los|las|un|una)\s+/i, "")
  s = s.replace(/^(el|la|los|las|un|una)\s+/i, "")
  s = s.replace(/^(tipo de\s+)/i, "")
  s = s.replace(/^(mucho|tant[oa]|muy|bastante)\s+/i, "")
  // Broken fragments: "Nahum (y tú"
  if (/\([^)]*$/.test(s) || /^[^()]*\)/.test(s)) return ""
  if (/\b(y tú|y tu|como tú|como tu)\b/i.test(s)) return ""
  if (/^(tú|tu|yo|usted|ellos|ellas|nosotros|nahum)$/i.test(s)) return ""
  if (/^(mucho|esto|eso|ello|asi|así|algo|cosas?)$/i.test(s)) return ""
  if (s.length < 2 || s.length > 48) return ""
  if (s.split(/\s+/).length > 6) return ""
  return s
}

function dedupeStrings(list: string[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of list) {
    const k = x.toLowerCase().trim()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(x.trim())
    if (out.length >= max) break
  }
  return out
}

function isGeneratedRelationshipSummary(value: string): boolean {
  return /^Conoces a .+; están construyendo confianza y detalles compartidos\.?$|^Están construyendo una relación con detalles compartidos; sé coherente con lo ya dicho\.?$/i.test(
    String(value || '').trim()
  )
}

/** Canonical list of fact strings for UI + legacy */
export function flattenFacts(mem?: UserMemory | null): string[] {
  if (!mem) return []
  const fromEntries = (mem.factEntries || []).map((f) => f.text)
  return dedupeStrings([...(mem.facts || []), ...fromEntries], 40)
}

export function buildUserMemoryPrompt(mem?: UserMemory | null): string {
  return buildSelectiveUserMemoryPrompt(mem, "")
}

/** Layered memory: anchors always; likes/goals/people only when relevant. */
export function buildSelectiveUserMemoryPrompt(
  mem?: UserMemory | null,
  userText?: string,
  opts?: { messageCount?: number; longChat?: boolean; includeIdentity?: boolean }
): string {
  if (!mem) return ""
  const q = String(userText || "").toLowerCase()
  const bits: string[] = []
  const msgCount = Math.max(0, opts?.messageCount ?? 0)
  const longChat = opts?.longChat === true || msgCount >= 16
  if (opts?.includeIdentity !== false) {
    if (mem.userName) bits.push("Nombre (identidad): " + mem.userName)
    if (mem.preferredName && mem.preferredName !== mem.userName) {
      bits.push("Cómo le gusta que le digan AL USUARIO (no al asistente): " + mem.preferredName)
    } else if (mem.preferredName && !mem.userName) {
      bits.push("Nombre: " + mem.preferredName)
    }
  }
  const asksName =
    /\b(mi nombre|c[oó]mo me (?:llamas|dices)|qu[eé] apodo|apodo para m[ií]|ll[aá]mame)\b/i.test(q)
  if (asksName && mem.nicknames?.length) {
    bits.push("Apodos OK del USUARIO: " + mem.nicknames.slice(0, 4).join(", "))
  }
  const asksRelationship =
    /\b(nuestra relaci[oó]n|nuestro v[ií]nculo|c[oó]mo vamos|qu[eé] sabes de m[ií]|qu[eé] recuerdas de m[ií])\b/i.test(
      q
    )
  if (
    asksRelationship &&
    mem.relationshipSummary &&
    !isGeneratedRelationshipSummary(mem.relationshipSummary)
  ) {
    bits.push("Vínculo: " + mem.relationshipSummary.slice(0, 160))
  }
  const asksAppearance =
    /\b(apariencia|c[oó]mo me veo|mi aspecto|mi cabello|mi pelo|mis ojos|mi estatura|mi foto|mi imagen)\b/i.test(
      q
    )
  if (asksAppearance && (mem.appearanceNotes || "").trim()) {
    bits.push(
      "Apariencia del USUARIO (no la del asistente): " +
        String(mem.appearanceNotes).trim().slice(0, 280)
    )
  }
  const pinned = (mem.factEntries || [])
    .filter((f) => f.pinned)
    .map((f) => String(f.text || '').trim().slice(0, 160))
    .filter(Boolean)
  const greetingOnly = q.length > 0 && q.length < 12
  // Asking about the assistant's tastes — do NOT inject the user's likes
  const aboutAssistantSelf =
    /\b(te gusta|te gustan|te encanta|te apasiona|disfrutas|prefieres)\b/i.test(q) ||
    /\b(qu[eé]|algo|cu[aá]l(?:es)?)\b.{0,40}\b(guste|gustan|encante)\b.{0,20}\b(a ti|tuy[oa]|tuyo|tuya)\b/i.test(q) ||
    /\b(tus gustos|tu favorito|tu color favorito|lo que a ti)\b/i.test(q) ||
    /\bdime algo que te guste\b/i.test(q)
  const wantsFood =
    !aboutAssistantSelf &&
    /caf[eé]|moka|mocha|t[eé]|comida|favorit|hambre|cocina/i.test(q)
  const wantsUserLikes =
    !aboutAssistantSelf &&
    (wantsFood || /\b(me gusta|mis gustos|mi favorito|lo que me gusta)\b/i.test(q))
  const asksDislikes = /\b(qu[eé] no me gusta|mis disgustos|qu[eé] detesto)\b/i.test(q)
  const wantsGoals = /meta|objetivo|proyecto|libro|plan|enfoque/i.test(q)
  const wantsPeople =
    /amigo|amiga|hermano|hermana|familia|persona|novio|novia|personaje|libro|novela|protagonista/i.test(
      q
    )
  const likes = (mem.likes || []).map(normalizeLikePhrase).filter(Boolean)
  const dislikes = (mem.dislikes || []).map(normalizeLikePhrase).filter(Boolean)
  const favorites = (mem.favorites || [])
    .map((favorite) => String(favorite || '').trim().slice(0, 64))
    .filter(Boolean)
  const queryTokens = q
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 4)
  const matchesQuery = (item: string) => {
    const normalized = item
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
    return queryTokens.some((word) => normalized.includes(word))
  }
  const asksMemory =
    !q.trim() ||
    /\b(recuerdas|te acuerdas|qu[eé] sabes de m[ií]|qu[eé] recuerdas|retomemos|continuemos con)\b/i.test(
      q
    )
  const standingInstructions = (mem.standingInstructions || [])
    .map((instruction) => String(instruction || '').trim().slice(0, 140))
    .filter(Boolean)
    .slice(0, 2)
  const relevantPins = asksMemory
    ? pinned.slice(0, 3)
    : pinned.filter(matchesQuery).slice(0, 2)
  const selectedPins = relevantPins.filter(
    (pin) =>
      !standingInstructions.some(
        (instruction) => instruction.toLocaleLowerCase() === pin.toLocaleLowerCase()
      )
  )
  if (standingInstructions.length) {
    bits.push('Instrucciones estables del usuario: ' + standingInstructions.join('; '))
  }
  if (selectedPins.length) bits.push('Anclas: ' + selectedPins.join('; '))

  if (!aboutAssistantSelf && favorites.length && !greetingOnly) {
    const relevantFavorites = favorites.filter(matchesQuery)
    const selectedFavorites = wantsUserLikes
      ? favorites.slice(0, longChat ? 4 : 3)
      : relevantFavorites.slice(0, 2)
    if (selectedFavorites.length) {
      bits.push(
        "Favoritos del USUARIO (anclas; no son tuyos): " + selectedFavorites.join(", ")
      )
    }
  }

  if (!greetingOnly) {
    if (wantsUserLikes && likes.length) {
      bits.push(
        "Gustos del USUARIO (no son tuyos): " + likes.slice(0, longChat ? 4 : 3).join(", ")
      )
    }
    if ((wantsFood || asksDislikes) && dislikes.length) {
      const selectedDislikes = asksDislikes
        ? dislikes.slice(0, 4)
        : dislikes.filter(matchesQuery).slice(0, 2)
      if (selectedDislikes.length) {
        bits.push("No le gusta al USUARIO: " + selectedDislikes.join(", "))
      }
    }
    if (wantsGoals && mem.goals?.length) {
      bits.push(
        "Metas: " +
          mem.goals
            .slice(0, longChat ? 3 : 2)
            .map((goal) => String(goal || '').trim().slice(0, 100))
            .filter(Boolean)
            .join("; ")
      )
    }
    if (
      wantsGoals &&
      mem.currentFocus &&
      !mem.goals?.some((goal) => goal.toLowerCase().trim() === mem.currentFocus?.toLowerCase().trim())
    ) {
      bits.push("Enfoque: " + mem.currentFocus.slice(0, 80))
    }
    const people = mem.people || []
    const mentionedPeople = people.filter((p) => {
      const n = String(p.name || '').trim()
      return n.length >= 3 && q.includes(n.toLowerCase())
    })
    if (mentionedPeople.length) {
      bits.push(
        "Personas ya conocidas (no digas que no las conoces): " +
          mentionedPeople
            .map((p) => p.name + (p.relation ? " (" + p.relation + ")" : ""))
            .join("; ")
      )
    } else if (wantsPeople && people.length) {
      bits.push(
        "Personas: " +
          people
            .slice(0, longChat ? 3 : 2)
            .map(
              (p) =>
                String(p.name || '').trim().slice(0, 32) +
                (p.relation ? " (" + String(p.relation).trim().slice(0, 32) + ")" : "")
            )
            .join("; ")
      )
    }
    const wantsDoc =
      /\b(libro|documento|cap[ií]tulo|lectura|pdf|docx|adjunto|rese[nñ]a)\b/i.test(q)
    const facts = flattenFacts(mem).filter((f) => {
      if (pinned.some((pin) => pin.toLowerCase() === f.toLowerCase())) return false
      // DOC_READ / DOC_INDEX only when the user is talking about the book
      if (/^DOC_(READ|INDEX)\b/i.test(String(f)) && !wantsDoc) return false
      return true
    })
    if (facts.length && queryTokens.length) {
      const hit = facts.filter(matchesQuery).slice(0, longChat ? 3 : 2)
      if (hit.length) {
        bits.push("Recuerdos relacionados: " + hit.map((fact) => fact.slice(0, 160)).join("; "))
      }
    }
  }
  if (!bits.length) return ""
  return (
    "[MEMORIA - capas; no inventario completo]\n" +
    bits.join("\n") +
    "\n" +
    "Integra solo lo que encaje en este turno y hazlo con naturalidad. No inventes juegos, titulos ni gustos ausentes. " +
    "No enumeres la memoria. Si hay gusto generico (cafe) y concreto (Moka), manda el concreto. " +
    "Los FAVORITOS del usuario son anclas estables: no los olvides en chats largos ni los copies como tuyos."
  )
}

export function extractUserFactsFromMessage(text: string): ExtractedFacts {
  const t = (text || '').trim()
  if (!t || t.length < 4) return {}
  // Scene language is meaningful for the conversation, but not evidence of stable biography.
  if (isExplicitRoleplayMemoryContext(t)) {
    const preference = extractExplicitSceneRelationshipPreference(t)
    return preference ? { emotionalNotes: [preference] } : {}
  }
  const out: ExtractedFacts = { facts: [] }

  // Identity: «me llamo / mi nombre es X» — never bare «soy X» (soy tuyo, soy feliz…)
  const identity =
    t.match(/\bme llamo\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ'-]{1,30})/i) ||
    t.match(/\bmi nombre(?:\s+real)?\s+es\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ'-]{1,30})/i) ||
    t.match(/\b(?:me conocen como|mi nombre)\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ'-]{1,30})/i)
  if (identity?.[1] && looksLikePersonName(identity[1])) {
    out.userName = identity[1]
    // Also seed preferredName only if empty later in merge
    out.preferredName = identity[1]
  }

  // Address preference: «llámame X» / short «dime X» (not identity, not «dime cuál de…»)
  const addressStrict =
    t.match(/\bll[aá]mame\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ'-]{1,30})/i) ||
    t.match(/\bprefiero que me (?:digas|llames)\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ'-]{1,30})/i) ||
    t.match(/\bme puedes llamar\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ'-]{1,30})/i)
  // Bare «dime X» only in short utterances (avoids «dime cuál de las dos»)
  const addressDime =
    t.length <= 48
      ? t.match(/^\s*(?:por favor[, ]*)?dime\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ'-]{1,30})\s*[.!?…]?\s*$/i)
      : null
  const address = addressStrict || addressDime
  if (address?.[1] && looksLikePersonName(address[1])) {
    // Reject choice-question tails: «dime X de las dos»
    const after = t.slice(t.toLowerCase().indexOf(address[1].toLowerCase()) + address[1].length)
    if (!/^\s*(de\s+l[ao]s?|de\s+est[ao]s?|o\s+|u\s+)/i.test(after)) {
      out.preferredName = address[1]
    }
  }

  // «Soy X» only if X is clearly a proper name (capitalized Latin name), not possessives
  const soy = t.match(/\bsoy\s+([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ'-]{2,30})\b/)
  if (soy?.[1] && looksLikePersonName(soy[1]) && /^[A-ZÁÉÍÓÚÜÑ]/.test(soy[1])) {
    // e.g. «Soy Nahum» — allow; «soy tuyo» rejected by INVALID_PERSON_NAME
    if (!out.userName) out.userName = soy[1]
  }

  // Only explicit goals — avoid «quiero un café» / chat filler becoming currentFocus
  const goal = t.match(
    /(?:mi meta es|mi objetivo es|estoy enfocado en|estoy centrado en|ahora mismo quiero)\s+(.{6,100})/i
  )
  if (goal?.[1]) {
    const g = goal[1].replace(/[.,;!?].*$/, '').trim()
    if (g.length >= 6 && !/^(un|una|el|la|que|te|me)\b/i.test(g)) {
      out.goals = [g]
      out.currentFocus = g.slice(0, 80)
    }
  }

  const fav =
    t.match(
      /(?:mi (?:tipo |caf[eé] )?favorito(?:a)?(?:\s+es)?|el (?:tipo|caf[eé]) que m[aá]s me gusta(?:\s+es)?)\s+(?:es\s+)?(.{2,40})/i
    ) || t.match(/favorito(?:a)?\s+(?:es\s+)?(.{2,40})/i)
  if (fav?.[1]) {
    const Lf = normalizeLikePhrase(fav[1])
    if (Lf) out.likes = [Lf]
  }
  const like = t.match(
    /(?:me gusta(?:n)?|me encanta(?:n)?|disfruto|prefiero|me vuelve loco(?:a)?(?:\s+el|\s+la|\s+los|\s+las)?)\s+(.{2,60})/i
  )
  if (like?.[1]) {
    const L = normalizeLikePhrase(like[1].replace(/[.,;!?].*$/, ''))
    // Reject pure personal names as "likes" (those belong in preferredName / people)
    if (L && !/^[A-ZÁÉÍÓÚÜÑ][\wáéíóúüñ'-]{1,20}$/.test(L)) {
      if (!out.likes?.length) out.likes = [L]
      else if (!out.likes.map((x) => x.toLowerCase()).includes(L.toLowerCase())) {
        out.likes = [...out.likes, L].slice(0, 6)
      }
    }
  }
  // «también me gusta el té» — require explicit gusta/encanta, not bare «también X»
  const alsoLike = t.match(/(?:también|además)\s+me gusta(?:n)?\s+(.{2,40})/i)
  if (alsoLike?.[1]) {
    const L = normalizeLikePhrase(alsoLike[1].replace(/[.,;!?].*$/, ''))
    if (L && !/^[A-ZÁÉÍÓÚÜÑ][\wáéíóúüñ'-]{1,20}$/.test(L)) {
      out.likes = [...(out.likes || []), L]
      out.likes = [...new Set(out.likes.map((x) => x.trim()))].slice(0, 8)
    }
  }
  // Drinks / food lists: «me gusta el café moka y cappuccino…»
  const drinkOrFood = t.match(
    /(?:me gusta(?:n)?|prefiero|quiero|pido)\s+(?:el|la|los|las)?\s*(.{0,80}?(?:caf[eé]|moka|mocha|cappuccino|capuchino|frapp[eé]|t[eé]|chocolate|cerveza|vino|comida|pizza|tacos).{0,60})/i
  )
  if (drinkOrFood?.[1]) {
    const chunk = drinkOrFood[1].replace(/[!?].*$/, '').trim()
    const parts = chunk
      .split(/\s*(?:,| y | e |\/)\s*/i)
      .map((x) => normalizeLikePhrase(x.replace(/^(el|la|los|las|un|una)\s+/i, '')))
      .filter((x) => x && x.length >= 3 && x.length <= 48)
    if (parts.length) {
      out.likes = [...new Set([...(out.likes || []), ...parts])].slice(0, 10)
      out.favorites = [...new Set([...(out.favorites || []), ...parts.map((p) => ( /caf|moka|capp|frap|t[eé]/i.test(p) ? 'bebida: ' + p : p))])].slice(0, 10)
      out.facts = [...(out.facts || []), 'Preferencias de bebida/comida: ' + parts.slice(0, 5).join(', ')].slice(0, 12)
    }
  }
  // «calientitos y sin espuma» style constraints → standing preference fact
  if (/sin espuma|con crema|sin az[uú]car|con hielo|caliente|fr[ií]o/i.test(t) && /caf[eé]|moka|cappuccino|frapp/i.test(t)) {
    const detail = t.slice(0, 160).replace(/\s+/g, ' ').trim()
    out.facts = [...(out.facts || []), 'Detalle café/bebida: ' + detail].slice(0, 12)
  }
  const dislike = t.match(
    /(?:no me gusta(?:n)?|odio|detesto|me molesta|no soporto|abomino)\s+(.{3,60})/i
  )
  if (dislike?.[1]) {
    const d = dislike[1].replace(/[.,;].*$/, '').trim()
    if (d.length >= 2) out.dislikes = [d]
  }
  // Don't treat "tu/su color favorito…" as the USER's favorite
  const aboutTheirFav =
    /\b(?:tu|su|tus|el)\s+(?:color\s+)?favorit/i.test(t) &&
    /\b(?:es|sea|era)\b/i.test(t) &&
    !/\bmi\s+(?:color\s+)?favorit/i.test(t)
  if (!aboutTheirFav) {
    const favs = favoritesToStrings(extractFavorites(t))
    if (favs.length) {
      out.favorites = favs
      const bare = favs.map((f) => (f.includes(':') ? f.split(':').pop()!.trim() : f))
      out.likes = [...new Set([...(out.likes || []), ...bare])].slice(0, 8)
    }
  }
  if (aboutTheirFav && out.likes?.length) {
    // Affirming THEIR favorite is not a user like
    out.likes = out.likes.filter((x) => !/favorit|verde|azul|rojo|rosa/i.test(x))
  }

  // Named people: "mi amigo Jake", "mi hermana Ana"
  const person = t.match(
    /mi\s+(amigo|amiga|hermano|hermana|pareja|novio|novia|jefe|madre|padre|mam[aá]|pap[aá]|compa(?:ñero|ñera)?)\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ'-]{1,30})/i
  )
  if (person) {
    out.people = [{ name: person[2], relation: person[1].toLowerCase() }]
  }
  // Book / story characters the user writes about
  const bookChar = t.match(
    /([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,24})\s+(?:es\s+la\s+chica|es\s+el\s+chico|es\s+(?:un|una)\s+personaje|es\s+(?:mi|la)\s+protagonista)/i
  ) || t.match(
    /(?:personaje|protagonista|hero[ií]na|del\s+libro|en\s+(?:mi\s+)?libro)[^.\n]{0,40}\b([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,24})\b/i
  ) || t.match(
    /\b([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,24})\s+es\s+la\s+chica\s+de\s+la\s+que\s+escribo/i
  )
  if (bookChar?.[1]) {
    const nm = bookChar[1]
    if (!/^(Ella|El|Una|Uno|Esta|Este|Mi|Tu|La|Los|Las)$/i.test(nm)) {
      out.people = [...(out.people || []), { name: nm, relation: 'personaje del libro' }]
    }
  }
  // "Ivanna" named with libro / escribir context
  const namedBook = t.match(
    /\b([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,24})\b[^.\n]{0,60}\b(?:libro|novela|historia|escribo|escribir)\b/i
  )
  if (namedBook?.[1] && !/^(Niamh|Nahum)$/i.test(namedBook[1])) {
    out.people = [...(out.people || []), { name: namedBook[1], relation: 'personaje del libro' }]
  }

  const durableProfileFact =
    t.match(/\b(?:vivo|resido)\s+en\s+([^.!?]{2,60})/i) ||
    t.match(/\btrabajo\s+como\s+([^.!?]{2,60})/i) ||
    t.match(/\bsoy\s+de\s+([A-ZÁÉÍÓÚÜÑ][^.!?]{1,48})/)
  if (durableProfileFact?.[1]) {
    const label = /\b(?:vivo|resido)\s+en/i.test(t)
      ? 'Residencia declarada'
      : /\btrabajo\s+como/i.test(t)
        ? 'Ocupación declarada'
        : 'Origen declarado'
    out.facts!.push(`${label}: ${durableProfileFact[1].trim().slice(0, 80)}`)
  }
  const hobby = t.match(/(?:mi hobby|en mi tiempo libre|suel[eo] (?:jugar|leer|ver|escuchar))\s+(.{4,80})/i)
  if (hobby?.[1]) {
    const h = hobby[1].replace(/[.,;!?].*$/, '').trim()
    if (h.length >= 4) {
      out.facts!.push('Hobby/tiempo libre: ' + h.slice(0, 100))
      const L = normalizeLikePhrase(h)
      if (L) out.likes = [...(out.likes || []), L].slice(0, 8)
    }
  }
  // Physical self-description only — never erotic RP or whole assistant turns
  {
    const looksPhysical =
      /\b(?:mi\s+(?:cabello|pelo|ojos|barba|estatura|complexión|complexion|aspecto|f[ií]sico)|soy\s+(?:alto|alta|bajo|baja)|mido\s+\d|peso\s+\d|cabello\s+(?:casta|rubio|negro|marrón|moreno)|ojos\s+(?:caf[eé]|marrones|verdes|azules|negros))\b/i.test(
        t
      )
    const looksErotic =
      /\b(?:gemid|orgasmo|penetra|clítoris|clitoris|vagina|pene|corr[ei]da|foll|cojo|te\s+siento\s+dentro|interior\s+ard|respiro\s+agitad|sonido\s+de\s+placer)\b/i.test(
        t
      )
    if (looksPhysical && !looksErotic && t.length < 280) {
      // Prefer a short clause, not the whole message
      const clause =
        t.match(
          /[^.]{0,40}\b(?:cabello|pelo|ojos|barba|mido|estatura|complexión|aspecto|f[ií]sico|soy\s+alt[oa]|soy\s+baj[oa])[^.]{0,120}/i
        )?.[0]?.trim() || t.slice(0, 160)
      out.appearanceNotes = clause.slice(0, 200)
    }
  }
  // Temporary moods belong in mood-memory, which carries a timestamp and TTL.
  if (/(?:recuerda|no olvides|importante:)\s*[:,-]?\s+(.{8,120})/i.test(t)) {
    const m = t.match(/(?:recuerda|no olvides|importante:)\s*[:,-]?\s+(.{8,120})/i)
    if (m?.[1]) out.facts!.push(`PIN:${m[1].trim().slice(0, 120)}`)
  }

  const stand = t.match(
    /(?:debes\s+(?:siempre|mantener|evitar)|siempre\s+(?:debes|haz|recuerda)|no\s+(?:debes\s+)?cometer|en\s+futuras?\s+ocasiones|a\s+partir\s+de\s+ahora)\s*[:,]?\s*(.{8,160})/i
  )
  if (stand?.[1]) {
    const line = stand[1].replace(/[.,;!?]+$/, '').trim().slice(0, 160)
    if (line.length >= 8) {
      ;(out as { standingInstructions?: string[] }).standingInstructions = [line]
      out.facts!.push(`PIN:${line}`)
    }
  }

  if (!out.facts!.length) delete out.facts
  return out
}

export function mergeUserMemory(
  prev: UserMemory | undefined | null,
  patch: ExtractedFacts
): UserMemory {
  const base: UserMemory = {
    facts: [...(prev?.facts || [])],
    factEntries: [...(prev?.factEntries || [])],
    preferredName: prev?.preferredName,
    userName: prev?.userName,
    appearanceNotes: prev?.appearanceNotes,
    avatarScenes: [...(prev?.avatarScenes || [])],
    goals: [...(prev?.goals || [])],
    currentFocus: prev?.currentFocus,
    people: [...(prev?.people || [])],
    likes: [...(prev?.likes || [])],
    dislikes: [...(prev?.dislikes || [])],
    emotionalNotes: [...(prev?.emotionalNotes || [])],
    relationshipSummary: prev?.relationshipSummary,
    standingInstructions: [...(prev?.standingInstructions || [])],
    lastRecalledAt: prev?.lastRecalledAt,
    updatedAt: Date.now()
  }

  if (patch.userName && looksLikePersonName(patch.userName)) {
    base.userName = patch.userName
  }
  if (patch.preferredName && looksLikePersonName(patch.preferredName)) {
    base.preferredName = patch.preferredName
  } else if (patch.preferredName && !looksLikePersonName(patch.preferredName)) {
    // Ignore bad extractions "names" like tuyo
  }
  // Heal corrupted preferredName stored earlier (e.g. «cuál» from «dime cuál de…»)
  if (base.preferredName && !looksLikePersonName(base.preferredName)) {
    base.preferredName = base.userName || undefined
  }
  if (base.userName && !looksLikePersonName(base.userName)) {
    base.userName = undefined
  }
  if (patch.nicknames?.length) {
    const cleanNicks = patch.nicknames.filter(
      (n) =>
        n.trim().length >= 2 &&
        n.trim().length <= 28 &&
        n.trim().split(/\s+/).length <= 3 &&
        !/^(en|qué|que|por|las|los)/i.test(n.trim())
    )
    if (cleanNicks.length) {
      base.nicknames = dedupeStrings([...(base.nicknames || []), ...cleanNicks], 12)
    }
  }
  if (patch.pendingNickname !== undefined) base.pendingNickname = patch.pendingNickname
  if (patch.appearanceNotes !== undefined) {
    const next = String(patch.appearanceNotes || '').trim()
    const erotic =
      /\b(?:gemid|orgasmo|penetra|clítoris|vagina|pene|foll|respiro\s+agitad|sonido\s+de\s+placer|interior\s+ard)\b/i
    if (!next) {
      base.appearanceNotes = undefined
    } else if (erotic.test(next)) {
      // Refuse to store RP/erotic prose as physical identity
    } else if ((base.appearanceNotes || '').trim()) {
      const prev = (base.appearanceNotes || '').trim()
      if (erotic.test(prev) && !erotic.test(next)) {
        // Heal: replace contaminated sheet with clean physical text
        base.appearanceNotes = next.slice(0, 400)
      } else if (next.length >= 40 || next.includes(',')) {
        // Manual / structured rewrite wins
        base.appearanceNotes = next.slice(0, 400)
      } else if (next.length >= 12 && !prev.toLowerCase().includes(next.toLowerCase())) {
        base.appearanceNotes = [prev, next].join(' · ').slice(0, 400)
      }
    } else {
      base.appearanceNotes = next.slice(0, 400)
    }
  }
  if (patch.currentFocus) base.currentFocus = patch.currentFocus
  if (patch.goals?.length) {
    base.goals = dedupeStrings([...(base.goals || []), ...patch.goals], 12)
  }
  if (patch.likes?.length) {
    const cleaned = patch.likes.map(normalizeLikePhrase).filter(Boolean) as string[]
    base.likes = dedupeStrings([...(base.likes || []), ...cleaned], 16)
  }
  if (patch.favorites?.length) {
    base.favorites = mergeFavoriteStrings(base.favorites, patch.favorites, 10)
  }
  // Sanitize legacy garbage already stored (broken parens, pronouns as likes)
  if (base.likes?.length) {
    base.likes = base.likes.map(normalizeLikePhrase).filter(Boolean) as string[]
    base.likes = dedupeStrings(base.likes, 16)
  }
  if (patch.dislikes?.length) {
    base.dislikes = dedupeStrings([...(base.dislikes || []), ...patch.dislikes], 12)
  }
  const standPatch = (patch as { standingInstructions?: string[] }).standingInstructions
  if (standPatch?.length) {
    base.standingInstructions = dedupeStrings(
      [...(base.standingInstructions || []), ...standPatch],
      16
    )
  }
  if (patch.emotionalNotes?.length) {
    base.emotionalNotes = [...(base.emotionalNotes || []), ...patch.emotionalNotes].slice(-8)
  }
  if (patch.people?.length) {
    for (const p of patch.people) {
      const i = base.people!.findIndex(
        (x) => x.name.toLowerCase() === p.name.toLowerCase()
      )
      if (i >= 0) base.people![i] = { ...base.people![i], ...p }
      else base.people!.push(p)
    }
    base.people = base.people!.slice(0, 12)
  }
  if (patch.facts?.length) {
    for (const raw of patch.facts) {
      const pinned = raw.startsWith('PIN:')
      const text = pinned ? raw.slice(4).trim() : raw.trim()
      if (!text) continue
      // Keep INTIMACY_* out of aggressive general-fact cap
      const isIntimacy = /^INTIMACY_/i.test(text)
      if (isIntimacy) {
        const without = (base.facts || []).filter(
          (f) =>
            !(
              (text.startsWith('INTIMACY_FIRST:') && String(f).startsWith('INTIMACY_FIRST:')) ||
              (text.startsWith('INTIMACY_PHASE:') && String(f).startsWith('INTIMACY_PHASE:')) ||
              f === text
            )
        )
        base.facts = [...without, text]
      } else {
        base.facts = dedupeStrings([...(base.facts || []), text], 40)
      }
      const existing = base.factEntries!.find(
        (f) => f.text.toLowerCase() === text.toLowerCase()
      )
      if (existing) {
        if (pinned) existing.pinned = true
        existing.importance = Math.max(existing.importance || 0.5, pinned ? 0.95 : 0.6)
        existing.at = Date.now()
      } else {
        base.factEntries!.push({
          text,
          pinned,
          importance: pinned ? 0.95 : 0.55,
          at: Date.now(),
          category: 'general'
        })
      }
    }
    base.factEntries = base.factEntries!.slice(-30)
  }

  if (base.relationshipSummary) {
    base.relationshipSummary = base.relationshipSummary
      .replace(/\bvais\b/gi, 'van')
      .replace(/\bestáis\b/gi, 'están')
      .replace(/\btenéis\b/gi, 'tienen')
      .replace(/\bpodéis\b/gi, 'pueden')
    if (isGeneratedRelationshipSummary(base.relationshipSummary)) {
      base.relationshipSummary = undefined
    }
  }

  // Privileged intimacy facts must survive general fact pressure
  try {
    const intimacy = (base.facts || []).filter((f) => /^INTIMACY_/i.test(String(f)))
    const general = (base.facts || []).filter((f) => !/^INTIMACY_/i.test(String(f)))
    base.facts = [...intimacy, ...general.slice(-36)]
  } catch {
    /* */
  }

  return base
}

/** Pin a fact from Settings UI */
export function pinFact(mem: UserMemory, text: string): UserMemory {
  const t = text.trim()
  if (!t) return mem
  return mergeUserMemory(mem, { facts: [`PIN:${t}`] })
}

/** Group facts for Settings UI */
export function groupMemoryFacts(facts: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {
    General: [],
    Preferencias: [],
    Apariencia: [],
    Metas: [],
    Personas: []
  }
  for (const f of facts || []) {
    const lower = f.toLowerCase()
    if (/(cabello|ojos|altura|apariencia|foto)/.test(lower)) groups.Apariencia.push(f)
    else if (/(quiero|meta|objetivo|proyecto)/.test(lower)) groups.Metas.push(f)
    else if (/(prefiero|me gusta|odio|favorito)/.test(lower)) groups.Preferencias.push(f)
    else if (/(amigo|hermana|hermano|pareja|jefe|mam|pap)/.test(lower)) groups.Personas.push(f)
    else groups.General.push(f)
  }
  return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length > 0))
}

/** One-line bond status for character system prompt */
export function buildRelationshipContinuityBlock(
  mem?: UserMemory | null,
  role?: string
): string {
  const empty =
    !(mem?.preferredName || '').trim() &&
    !(mem?.likes?.length) &&
    !(mem?.facts?.length) &&
    !(mem?.factEntries?.length) &&
    !(mem?.nicknames?.length)
  if (empty) {
    if (!role) return ''
    const roleLine = `Tu rol de personaje («${role}») es la META del vínculo: quieres llegar ahí con naturalidad, no fingir que ya hay una historia larga juntos.`
    return (
      `# Continuidad afectiva\n` +
      `Aún NO conoces los datos de esta persona (nombre, gustos, historia). ` +
      roleLine +
      ` Puedes sonar cálida según tu personalidad, pero pregunta y escucha; no des por hecho cómo se llama ni qué le gusta. ` +
      `Una sola respuesta coherente: no repitas el mismo saludo ni el mismo párrafo varias veces.`
    )
  }
  if (!role) return ''
  return (
    `# Continuidad afectiva\n` +
    `Rol vivo con el usuario: ${role}\n` +
    `Ajusta la cercanía a la historia confirmada; no inventes hitos, estados emocionales ni datos personales.`
  )
}


/** User accepts a proposed nickname */
export function looksLikeNicknameAccept(text: string): boolean {
  const t = (text || '').toLowerCase().trim()
  return (
    /^(s[ií]|ok|vale|de acuerdo|me gusta|perfecto|acepto)(\s|,|!|\.|$)/i.test(t) ||
    /\b(me gusta (ese |el )?apodo|as[ií] me puedes decir|puedes decirme as[ií])\b/i.test(t)
  )
}

export function looksLikeNicknameReject(text: string): boolean {
  const t = (text || '').toLowerCase().trim()
  return /\b(no me gusta|otro apodo|no me digas as[ií]|mejor no)\b/i.test(t)
}

/** Extract explicit "llámame X" / "dime X" from user */
export function extractExplicitNickname(text: string): string | null {
  const t = (text || '').trim()
  if (!t || t.length > 80) return null
  // Strict: only clear nickname declarations (never «me puedes decir en qué…»)
  const m =
    t.match(
      /^(?:mi apodo (?:es|puede ser)|dime|ll[aá]mame|prefiero que me digas)\s+[«"']?([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ\-]{1,24})[»"']?\s*$/i
    ) ||
    t.match(
      /^me puedes decir\s+[«"']([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ\- ]{1,24})[»"']\s*$/i
    )
  if (!m?.[1]) return null
  const n = m[1].trim()
  if (/^(en|qué|que|por|las|los|un|una|el|la|me|te|se)\b/i.test(n)) return null
  if (n.split(/\s+/).length > 3) return null
  return n.slice(0, 28)
}



/**
 * Contextual extraction: user affirms something the assistant just mentioned.
 * Example:
 *   Assistant: "...película Cómo entrenar a tu dragón..."
 *   User: "¡Claro! Es una de mis películas favoritas"
 * → favorites: película: Cómo entrenar a tu dragón
 *
 * Deterministic (no LLM). Safe complement to single-message extract.
 */
export function extractUserFactsFromTurnPair(
  userText: string,
  previousAssistantText?: string | null
): ExtractedFacts {
  const base = extractUserFactsFromMessage(userText)
  const u = String(userText || '').trim()
  const a = String(previousAssistantText || '').trim()
  if (!u || !a || a.length < 8) return base

  // User affirms "one of my favorites / mi favorita / me encanta esa"
  const affirmsFavorite =
    /\b(?:es\s+una\s+de\s+mis\s+(?:pel[ií]culas|series|canciones|comidas|cosas)?\s*favorit)/i.test(u) ||
    /\b(?:mi\s+(?:pel[ií]cula|serie|canci[oó]n|comida)?\s*favorit[oa]\s+(?:es\s+)?(?:esa|ese|esta|esto))/i.test(u) ||
    /\b(?:me\s+encanta\s+esa|esa\s+es\s+mi\s+favorit|tambi[eé]n\s+es\s+mi\s+favorit)/i.test(u) ||
    /\b(?:una\s+de\s+mis\s+favoritas?)\b/i.test(u)

  if (!affirmsFavorite) return base

  // Try quoted title from assistant
  let title = ''
  const q =
    a.match(/[«"]([^»"]{2,80})[»"]/) ||
    a.match(/\bpel[ií]cula\s+[«"]?([^»".\n]{2,60})/) ||
    a.match(/\bserie\s+[«"]?([^»".\n]{2,60})/) ||
    a.match(/\bcanci[oó]n\s+[«"]?([^»".\n]{2,60})/)
  if (q?.[1]) title = q[1].trim().replace(/[.,;:!?]+$/, '')

  // Category from either side
  let cat = 'favorito'
  if (/pel[ií]cula/i.test(u + a)) cat = 'película'
  else if (/serie/i.test(u + a)) cat = 'serie'
  else if (/canci[oó]n|m[uú]sica/i.test(u + a)) cat = 'música'
  else if (/comida|platillo/i.test(u + a)) cat = 'comida'

  if (title && title.length >= 2 && title.length <= 80) {
    const entry = `${cat}: ${title}`
    const favs = [...(base.favorites || [])]
    if (!favs.some((f) => f.toLowerCase().includes(title.toLowerCase().slice(0, 20)))) {
      favs.push(entry)
    }
    const likes = [...(base.likes || [])]
    if (!likes.some((l) => l.toLowerCase().includes(title.toLowerCase().slice(0, 16)))) {
      likes.push(title.slice(0, 60))
    }
    return {
      ...base,
      favorites: favs.slice(0, 10),
      likes: likes.slice(0, 12)
    }
  }

  return base
}

/** True if extractUserFactsFromMessage produced something to merge */
export function hasMemorySignal(patch: ExtractedFacts | null | undefined): boolean {
  if (!patch) return false
  if (patch.preferredName || patch.userName) return true
  if (patch.pendingNickname) return true
  if (patch.appearanceNotes) return true
  if (patch.currentFocus) return true
  if (patch.facts?.length) return true
  if (patch.goals?.length) return true
  if (patch.likes?.length) return true
  if (patch.dislikes?.length) return true
  if (patch.people?.length) return true
  if (patch.emotionalNotes?.length) return true
  if (patch.nicknames?.length) return true
  return false
}
