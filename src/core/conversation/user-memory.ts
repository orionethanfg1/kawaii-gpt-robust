/**
 * Compact user memory for long-running chats.
 *
 * Cloud/local models only know what we put in the prompt. Keep a short profile
 * and inject it every turn (~few hundred tokens max).
 */

export interface UserMemoryState {
  facts: string[]
  preferredName?: string
  updatedAt?: number
}

export const EMPTY_USER_MEMORY: UserMemoryState = { facts: [] }

const MAX_FACTS = 28
const MAX_FACT_LEN = 160

/** Heuristic extraction from a user message (no extra model call). */
export function extractUserFactsFromMessage(text: string): string[] {
  const t = text.trim()
  if (t.length < 4 || t.length > 600) return []
  const out: string[] = []

  // Names: allow lowercase ("me llamo orion", "me llamo Orion Ethan")
  const namePatterns = [
    /(?:me llamo|mi nombre es|puedes llamarme|llámame|llamame)\s+([A-ZÁÉÍÓÚÑÜa-záéíóúñü][\wáéíóúñü]+(?:\s+[A-ZÁÉÍÓÚÑÜa-záéíóúñü][\wáéíóúñü]+){0,3})/i,
    /(?:call me|my name is|i'm|i am)\s+([A-Za-z][\w]+(?:\s+[A-Za-z][\w]+){0,3})/i
  ]
  for (const re of namePatterns) {
    const m = re.exec(t)
    if (m) {
      const name = m[1].trim().replace(/[.,!?;:]+$/, '')
      // Skip generic words
      if (!/^(un|una|el|la|de|en|por|para|tu|su|hombre|mujer|persona)$/i.test(name)) {
        out.push(`Nombre preferido: ${name}`)
        break
      }
    }
  }

  const likes = /(?:me gusta[n]?|me encanta[n]?)\s+(.{3,80}?)(?:\.|,|!|\?|$)/i.exec(t)
  if (likes) out.push(`Le gusta: ${likes[1].trim()}`)

  const dislikes = /(?:no me gusta[n]?|odio|detesto)\s+(.{3,80}?)(?:\.|,|!|\?|$)/i.exec(t)
  if (dislikes) out.push(`No le gusta: ${dislikes[1].trim()}`)

  const lives = /(?:vivo en|soy de|vengo de|estoy en)\s+(.{2,60}?)(?:\.|,|!|\?|$)/i.exec(t)
  if (lives) out.push(`Lugar: ${lives[1].trim()}`)

  const work =
    /(?:trabajo (?:en|como)|me dedico a)\s+(.{3,60}?)(?:\.|,|!|\?|$)/i.exec(t) ||
    /(?:soy)\s+((?:ingeniero|ingeniera|dev|desarrollador|desarrolladora|estudiante|profesor|profesora|médico|medico|diseñador|diseñadora)[\w\s]{0,40})/i.exec(
      t
    )
  if (work) out.push(`Ocupación: ${work[1].trim()}`)

  // Explicit "recuerda que..."
  const remember = /(?:recuerda que|ten en cuenta que|no olvides que)\s+(.{5,100}?)(?:\.|$)/i.exec(t)
  if (remember) out.push(`Dato: ${remember[1].trim()}`)

  return out.map((f) => f.slice(0, MAX_FACT_LEN))
}

export function mergeUserMemory(
  prev: UserMemoryState | undefined,
  additions: string[]
): UserMemoryState {
  const facts = [...(prev?.facts || [])]
  for (const a of additions) {
    const key = a.toLowerCase().slice(0, 48)
    const isName = /^nombre preferido:/i.test(a)
    // Replace previous preferred-name fact if updating name
    if (isName) {
      for (let i = facts.length - 1; i >= 0; i--) {
        if (/^nombre preferido:/i.test(facts[i])) facts.splice(i, 1)
      }
    }
    const dup = facts.some(
      (f) => f.toLowerCase().startsWith(key) || f.toLowerCase() === a.toLowerCase()
    )
    if (!dup) facts.push(a)
  }
  while (facts.length > MAX_FACTS) facts.shift()
  const preferredName =
    additions
      .map((a) => /Nombre preferido:\s*(.+)/i.exec(a)?.[1]?.trim())
      .find(Boolean) || prev?.preferredName
  return {
    facts,
    preferredName,
    updatedAt: Date.now()
  }
}

/** System block — keep short for token budget */
export function buildUserMemoryPrompt(mem: UserMemoryState | undefined): string {
  if (!mem || (!mem.facts?.length && !mem.preferredName)) return ''
  const name = (mem.preferredName || '').trim()
  const lines = [
    '# Memoria del usuario (hechos reales guardados por la app — úsalos siempre)',
    name
      ? `El nombre del usuario es exactamente: ${name}. Cuando pregunte cómo se llama o cómo dirigirte a él/ella, responde con ese nombre. NUNCA uses placeholders como [tu nombre], {nombre} o "usuario".`
      : 'Si aún no sabes el nombre del usuario, dilo con honestidad y pregunta cómo prefiere que le llames. NUNCA inventes un nombre ni uses placeholders como [tu nombre].',
    ...mem.facts.map((f) => `- ${f}`),
    'No contradigas estos hechos. Si el usuario los corrige, la app actualizará la memoria.'
  ].filter(Boolean)
  return lines.join('\n')
}
