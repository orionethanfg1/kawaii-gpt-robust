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
  dislikes?: string[]
  /** Soft emotional / relationship continuity */
  emotionalNotes?: string[]
  /** One-line arc: "estamos construyendo confianza", etc. */
  relationshipSummary?: string
  /** Last time we actively used memory in a reply (host) */
  lastRecalledAt?: number
  updatedAt?: number
}

export type ExtractedFacts = {
  facts?: string[]
  preferredName?: string
  nicknames?: string[]
  pendingNickname?: string
  appearanceNotes?: string
  goals?: string[]
  currentFocus?: string
  people?: NamedPerson[]
  likes?: string[]
  dislikes?: string[]
  emotionalNotes?: string[]
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
  userText?: string
): string {
  if (!mem) return ""
  const q = String(userText || "").toLowerCase()
  const bits: string[] = []
  if (mem.preferredName) bits.push("Nombre: " + mem.preferredName)
  if (mem.nicknames?.length) bits.push("Apodos OK: " + mem.nicknames.slice(0, 4).join(", "))
  if (mem.relationshipSummary) bits.push("Vínculo: " + mem.relationshipSummary.slice(0, 160))
  const pinned = (mem.factEntries || []).filter((f) => f.pinned).map((f) => f.text)
  if (pinned.length) bits.push("Anclas: " + pinned.slice(0, 4).join("; "))
  const greetingOnly = q.length > 0 && q.length < 12
  // Asking about the assistant's tastes — do NOT inject the user's likes
  const aboutAssistantSelf =
    /\b(te gusta|te gustan|te encanta|te apasiona|disfrutas|prefieres)\b/i.test(q) ||
    /\b(qu[eé]|algo|cu[aá]l(?:es)?)\b.{0,40}\b(guste|gustan|encante)\b.{0,20}\b(a ti|tuy[oa]|tuyo|tuya)\b/i.test(q) ||
    /\b(tus gustos|tu favorito|lo que a ti)\b/i.test(q) ||
    /\bdime algo que te guste\b/i.test(q)
  const wantsFood =
    !aboutAssistantSelf &&
    /caf[eé]|moka|mocha|t[eé]|comida|favorit|hambre|cocina/i.test(q)
  const wantsUserLikes =
    !aboutAssistantSelf &&
    (wantsFood || /\b(me gusta|mis gustos|mi favorito|lo que me gusta)\b/i.test(q))
  const wantsGoals = /meta|objetivo|proyecto|libro|plan|quiero|enfoque/i.test(q)
  const wantsPeople = /amigo|amiga|hermano|hermana|familia|persona|novio|novia/i.test(q)
  const likes = (mem.likes || []).map(normalizeLikePhrase).filter(Boolean)
  const dislikes = (mem.dislikes || []).map(normalizeLikePhrase).filter(Boolean)
  if (!greetingOnly) {
    if (wantsUserLikes && likes.length) {
      bits.push("Gustos del USUARIO (no son tuyos): " + likes.slice(0, 6).join(", "))
    }
    if (wantsFood && dislikes.length) bits.push("No le gusta al USUARIO: " + dislikes.slice(0, 4).join(", "))
    if (wantsGoals && mem.goals?.length) bits.push("Metas: " + mem.goals.slice(0, 4).join("; "))
    if (wantsGoals && mem.currentFocus) bits.push("Enfoque: " + mem.currentFocus.slice(0, 80))
    if (wantsPeople && mem.people?.length) {
      bits.push("Personas: " + mem.people.slice(0, 4).map((p) => p.name + (p.relation ? " (" + p.relation + ")" : "")).join("; "))
    }
    const facts = flattenFacts(mem).filter((f) => !pinned.includes(f))
    if (facts.length && q.length >= 12) {
      const tokens = q.split(/[^a-záéíóúüñ0-9]+/i).filter((w) => w.length >= 4)
      const hit = facts.filter((f) => tokens.some((w) => f.toLowerCase().includes(w))).slice(0, 4)
      if (hit.length) bits.push("Recuerdos relacionados: " + hit.join("; "))
    }
  }
  if (!bits.length) return ""
  return (
    "[MEMORIA - capas; no inventario completo]\n" +
    bits.join("\n") +
    "\n" +
    "Usa solo lo que encaje en este turno. No inventes juegos, titulos ni gustos ausentes. " +
    "No enumeres la memoria. Si hay gusto generico (cafe) y concreto (Moka), manda el concreto."
  )
}

export function extractUserFactsFromMessage(text: string): ExtractedFacts {
  const t = (text || '').trim()
  if (!t || t.length < 4) return {}
  const out: ExtractedFacts = { facts: [] }

  const name =
    t.match(
      /(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ'-]{1,30})/i
    ) ||
    t.match(/ll[aá]mame\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ'-]{1,30})/i) ||
    t.match(/(?:mi nombre|puedes decirme)\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ'-]{1,30})/i)
  if (name?.[1] && !/^(un|una|el|la|yo|tú)$/i.test(name[1])) {
    out.preferredName = name[1]
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
  const dislike = t.match(
    /(?:no me gusta(?:n)?|odio|detesto|me molesta|no soporto|abomino)\s+(.{3,60})/i
  )
  if (dislike?.[1]) {
    const d = dislike[1].replace(/[.,;].*$/, '').trim()
    if (d.length >= 2) out.dislikes = [d]
  }

  // Named people: "mi amigo Jake", "mi hermana Ana"
  const person = t.match(
    /mi\s+(amigo|amiga|hermano|hermana|pareja|novio|novia|jefe|madre|padre|mam[aá]|pap[aá]|compa(?:ñero|ñera)?)\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ'-]{1,30})/i
  )
  if (person) {
    out.people = [{ name: person[2], relation: person[1].toLowerCase() }]
  }

  if (/(vivo en|trabajo en|estudio|tengo \d+ a[ñn]os|cumplo|soy de )/i.test(t)) {
    out.facts!.push(t.slice(0, 160))
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
  if (/(cabello|ojos|mido|peso|barba|soy alto|soy baja|mi aspecto)/i.test(t)) {
    out.appearanceNotes = t.slice(0, 200)
  }
  if (
    /(me siento|estoy (triste|feliz|cansad|estres|ansios|enojad|agotad)|tuve un (mal|buen) d[ií]a)/i.test(
      t
    )
  ) {
    out.emotionalNotes = [t.slice(0, 120)]
  }
  if (
    /(?:recuerda|no olvides|importante:)\s+(.{8,120})/i.test(t)
  ) {
    const m = t.match(/(?:recuerda|no olvides|importante:)\s+(.{8,120})/i)
    if (m?.[1]) out.facts!.push(`PIN:${m[1].trim().slice(0, 120)}`)
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
    appearanceNotes: prev?.appearanceNotes,
    avatarScenes: [...(prev?.avatarScenes || [])],
    goals: [...(prev?.goals || [])],
    currentFocus: prev?.currentFocus,
    people: [...(prev?.people || [])],
    likes: [...(prev?.likes || [])],
    dislikes: [...(prev?.dislikes || [])],
    emotionalNotes: [...(prev?.emotionalNotes || [])],
    relationshipSummary: prev?.relationshipSummary,
    lastRecalledAt: prev?.lastRecalledAt,
    updatedAt: Date.now()
  }

  if (patch.preferredName) base.preferredName = patch.preferredName
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
  if (patch.appearanceNotes) {
    base.appearanceNotes = [base.appearanceNotes, patch.appearanceNotes]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 400)
  }
  if (patch.currentFocus) base.currentFocus = patch.currentFocus
  if (patch.goals?.length) {
    base.goals = dedupeStrings([...(base.goals || []), ...patch.goals], 12)
  }
  if (patch.likes?.length) {
    const cleaned = patch.likes.map(normalizeLikePhrase).filter(Boolean) as string[]
    base.likes = dedupeStrings([...(base.likes || []), ...cleaned], 16)
  }
  // Sanitize legacy garbage already stored (broken parens, pronouns as likes)
  if (base.likes?.length) {
    base.likes = base.likes.map(normalizeLikePhrase).filter(Boolean) as string[]
    base.likes = dedupeStrings(base.likes, 16)
  }
  if (patch.dislikes?.length) {
    base.dislikes = dedupeStrings([...(base.dislikes || []), ...patch.dislikes], 12)
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
      base.facts = dedupeStrings([...(base.facts || []), text], 24)
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

  // Soft relationship summary if we have enough signal
  if (!base.relationshipSummary && (base.preferredName || (base.facts || []).length >= 2)) {
    base.relationshipSummary = base.preferredName
      ? `Conoces a ${base.preferredName}; están construyendo confianza y detalles compartidos.`
      : `Están construyendo una relación con detalles compartidos; sé coherente con lo ya dicho.`
  }
  if (base.relationshipSummary) {
    base.relationshipSummary = base.relationshipSummary
      .replace(/\bvais\b/gi, 'van')
      .replace(/\bestáis\b/gi, 'están')
      .replace(/\btenéis\b/gi, 'tienen')
      .replace(/\bpodéis\b/gi, 'pueden')
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
  if (!mem && !role) return ''
  const empty =
    !(mem?.preferredName || '').trim() &&
    !(mem?.likes?.length) &&
    !(mem?.facts?.length) &&
    !(mem?.factEntries?.length) &&
    !(mem?.nicknames?.length)
  if (empty) {
    const roleLine = role
      ? `Tu rol de personaje («${role}») es la META del vínculo: quieres llegar ahí con naturalidad, no fingir que ya hay una historia larga juntos.`
      : `Estás empezando el vínculo: cercana, sin inventar recuerdos compartidos.`
    return (
      `# Continuidad afectiva\n` +
      `Aún NO conoces los datos de esta persona (nombre, gustos, historia). ` +
      roleLine +
      ` Puedes sonar cálida según tu personalidad, pero pregunta y escucha; no des por hecho cómo se llama ni qué le gusta. ` +
      `Una sola respuesta coherente: no repitas el mismo saludo ni el mismo párrafo varias veces.`
    )
  }
  const parts: string[] = []
  if (role) parts.push(`Rol vivo con el usuario: ${role}`)
  if (mem?.preferredName) parts.push(`Le gusta que le digas: ${mem.preferredName}`)
  if (mem?.relationshipSummary) parts.push(mem.relationshipSummary)
  if (mem?.currentFocus) parts.push(`Ahora le importa: ${mem.currentFocus}`)
  if (mem?.emotionalNotes?.length) {
    parts.push(`Clima reciente: ${mem.emotionalNotes[mem.emotionalNotes.length - 1]}`)
  }
  if (!parts.length) return ''
  return (
    `# Continuidad afectiva\n` +
    parts.join('\n') +
    `\nResponde como alguien que recuerda el vínculo, no como un bot que acaba de nacer.`
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


/** True if extractUserFactsFromMessage produced something to merge */
export function hasMemorySignal(patch: ExtractedFacts | null | undefined): boolean {
  if (!patch) return false
  if (patch.preferredName) return true
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
