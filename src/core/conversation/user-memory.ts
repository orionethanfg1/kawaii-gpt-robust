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
  if (!mem) return ''
  const bits: string[] = []
  if (mem.preferredName) bits.push(`Nombre preferido del usuario: ${mem.preferredName}`)
  if (mem.nicknames?.length) bits.push(`Apodos de cariño que acepta: ${mem.nicknames.join(', ')}`)
  if (mem.pendingNickname) bits.push(`Apodo propuesto (esperando OK del usuario): ${mem.pendingNickname}`)
  if (mem.relationshipSummary) bits.push(`Hilo de relación: ${mem.relationshipSummary}`)
  if (mem.appearanceNotes) bits.push(`Apariencia del usuario: ${mem.appearanceNotes}`)
  if (mem.currentFocus) bits.push(`Enfoque actual: ${mem.currentFocus}`)

  const pinned = (mem.factEntries || []).filter((f) => f.pinned).map((f) => f.text)
  if (pinned.length) bits.push(`Anclas (prioridad alta): ${pinned.slice(0, 8).join('; ')}`)

  const facts = flattenFacts(mem).filter((f) => !pinned.includes(f))
  if (facts.length) bits.push(`Hechos: ${facts.slice(0, 14).join('; ')}`)
  if (mem.goals?.length) bits.push(`Metas: ${mem.goals.slice(0, 6).join('; ')}`)
  if (mem.likes?.length) bits.push(`Le gusta: ${mem.likes.slice(0, 8).join(', ')}`)
  if (mem.dislikes?.length) bits.push(`No le gusta: ${mem.dislikes.slice(0, 6).join(', ')}`)
  if (mem.people?.length) {
    bits.push(
      `Personas: ` +
        mem.people
          .slice(0, 8)
          .map((p) => `${p.name}${p.relation ? ` (${p.relation})` : ''}${p.note ? ` — ${p.note}` : ''}`)
          .join('; ')
    )
  }
  if (mem.emotionalNotes?.length) {
    bits.push(`Clima emocional reciente: ${mem.emotionalNotes.slice(-4).join('; ')}`)
  }
  if (!bits.length) return ''
  return (
    `[MEMORIA_USUARIO — relación continua]\n${bits.join('\n')}\n` +
    `Úsalo con naturalidad como alguien que ya os conocéis: menciona detalles solo cuando encajen. ` +
    `No enumeres la memoria como lista. No inventes hechos que no estén aquí. ` +
    `Si el rol es personal (pareja/amiga), sé cálida y coherente con el vínculo; ` +
    `si el usuario pide algo técnico de la app, prioriza hechos del host (Harness).`
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

  const goal = t.match(
    /(?:quiero|necesito|estoy buscando|mi meta es|mi objetivo es)\s+(.{8,100})/i
  )
  if (goal?.[1]) {
    const g = goal[1].replace(/[.,;].*$/, '').trim()
    out.goals = [g]
    out.currentFocus = g.slice(0, 80)
  }

  const like = t.match(/(?:me gusta|me encanta|amo|disfruto)\s+(.{3,60})/i)
  if (like?.[1]) {
    out.likes = [like[1].replace(/[.,;].*$/, '').trim()]
  }
  const dislike = t.match(/(?:no me gusta|odio|detesto|me molesta)\s+(.{3,60})/i)
  if (dislike?.[1]) {
    out.dislikes = [dislike[1].replace(/[.,;].*$/, '').trim()]
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
    base.nicknames = dedupeStrings([...(base.nicknames || []), ...patch.nicknames], 12)
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
    base.likes = dedupeStrings([...(base.likes || []), ...patch.likes], 16)
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
      ? `Conoces a ${base.preferredName}; vais construyendo confianza y detalles compartidos.`
      : `Vais construyendo una relación con detalles compartidos; sé coherente con lo ya dicho.`
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
  const t = text || ''
  const m =
    t.match(/\b(?:ll[aá]mame|dime|prefiero que me digas)\s+[«"']?([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ \-]{1,28})[»"']?/i) ||
    t.match(/\b(?:mi apodo (?:es|puede ser)|me puedes decir)\s+[«"']?([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ \-]{1,28})[»"']?/i)
  return m?.[1]?.trim() || null
}
