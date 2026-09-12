export type UserMemory = {
  facts?: string[]
  preferredName?: string
  appearanceNotes?: string
  avatarScenes?: string[]
  goals?: string[]
  currentFocus?: string
  updatedAt?: number
}

export type ExtractedFacts = {
  facts?: string[]
  preferredName?: string
  appearanceNotes?: string
  goals?: string[]
  currentFocus?: string
}

export function buildUserMemoryPrompt(mem?: UserMemory | null): string {
  if (!mem) return ''
  const bits: string[] = []
  if (mem.preferredName) bits.push(`Nombre preferido del usuario: ${mem.preferredName}`)
  if (mem.appearanceNotes) bits.push(`Apariencia del usuario: ${mem.appearanceNotes}`)
  if (mem.currentFocus) bits.push(`Enfoque actual: ${mem.currentFocus}`)
  if (mem.facts?.length) bits.push(`Hechos: ${mem.facts.slice(0, 12).join('; ')}`)
  if (mem.goals?.length) bits.push(`Metas: ${mem.goals.slice(0, 6).join('; ')}`)
  if (!bits.length) return ''
  return (
    `[MEMORIA_USUARIO]\n${bits.join('\n')}\n` +
    `Usa estos datos con naturalidad; no los enumeres salvo que pregunten.`
  )
}

export function extractUserFactsFromMessage(text: string): ExtractedFacts {
  const t = (text || '').trim()
  if (!t || t.length < 4) return {}
  const out: ExtractedFacts = { facts: [] }
  const name =
    t.match(/(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ-]{1,30})/i) ||
    t.match(/llamame\s+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][\wáéíóúüñ-]{1,30})/i)
  if (name?.[1]) out.preferredName = name[1]
  const goal = t.match(/(?:quiero|necesito|estoy buscando)\s+(.{8,80})/i)
  if (goal?.[1]) {
    out.goals = [goal[1].trim()]
    out.currentFocus = goal[1].trim().slice(0, 80)
  }
  if (/(vivo en|trabajo en|estudio|tengo \d+ años|cumplo)/i.test(t)) {
    out.facts!.push(t.slice(0, 160))
  }
  if (/(cabello|ojos|mido|peso|barba|soy alto|soy baja)/i.test(t)) {
    out.appearanceNotes = t.slice(0, 200)
  }
  if (!out.facts!.length) delete out.facts
  return out
}

export function mergeUserMemory(prev: UserMemory | undefined | null, patch: ExtractedFacts): UserMemory {
  const base: UserMemory = {
    facts: [...(prev?.facts || [])],
    preferredName: prev?.preferredName,
    appearanceNotes: prev?.appearanceNotes,
    avatarScenes: [...(prev?.avatarScenes || [])],
    goals: [...(prev?.goals || [])],
    currentFocus: prev?.currentFocus,
    updatedAt: Date.now()
  }
  if (patch.preferredName) base.preferredName = patch.preferredName
  if (patch.appearanceNotes) {
    base.appearanceNotes = [base.appearanceNotes, patch.appearanceNotes].filter(Boolean).join(' · ').slice(0, 400)
  }
  if (patch.currentFocus) base.currentFocus = patch.currentFocus
  if (patch.goals?.length) {
    const set = new Set([...(base.goals || []), ...patch.goals])
    base.goals = [...set].slice(0, 12)
  }
  if (patch.facts?.length) {
    const set = new Set([...(base.facts || []), ...patch.facts])
    base.facts = [...set].slice(-20)
  }
  return base
}

/** Group facts for Settings UI: { General: [...], ... } */
export function groupMemoryFacts(facts: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {
    General: [],
    Preferencias: [],
    Apariencia: [],
    Metas: []
  }
  for (const f of facts || []) {
    const lower = f.toLowerCase()
    if (/(cabello|ojos|altura|apariencia|foto)/.test(lower)) groups.Apariencia.push(f)
    else if (/(quiero|meta|objetivo|proyecto)/.test(lower)) groups.Metas.push(f)
    else if (/(prefiero|me gusta|odio|favorito)/.test(lower)) groups.Preferencias.push(f)
    else groups.General.push(f)
  }
  return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length > 0))
}
