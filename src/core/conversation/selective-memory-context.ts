/**
 * B5 — Selective memory injection for a single turn.
 * Avoid dumping the full inventory into the system prompt.
 */

import type { AssistantMemory } from './assistant-memory'
import type { RelationshipState } from './dual-memory'

function isEmptyMem(mem?: AssistantMemory | null): boolean {
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

function isSelfAsk(userText?: string): boolean {
  const q = String(userText || '').toLowerCase()
  if (!q || q.length < 4) return false
  if (/(te gusta|te gustan|te encanta|te apasiona|disfrutas|prefieres)/i.test(q)) return true
  if (/(qu[eé]|algo|cu[aá]l(?:es)?).{0,40}(guste|gustan|encante|apasiona).{0,20}(a ti|tuy[oa]|tuyo|tuya)/i.test(q)) return true
  if (/(tus gustos|tu favorito|lo que a ti|sobre ti)/i.test(q)) return true
  if (/dime algo que te guste/i.test(q)) return true
  if (/cu[eé]ntame algo m[aá]s que te guste/i.test(q)) return true
  return false
}

function tokens(q: string): string[] {
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9áéíóúñü]+/i)
    .filter((w) => w.length >= 3)
}

function scoreMatch(item: string, toks: string[]): number {
  const k = item
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  let s = 0
  for (const t of toks) {
    if (t.length >= 4 && k.includes(t)) s += 1
  }
  return s
}

function pickRelevant(items: string[] | undefined, toks: string[], max: number): string[] {
  const list = (items || []).map((x) => String(x || '').trim()).filter(Boolean)
  if (!list.length) return []
  if (!toks.length) return list.slice(0, max)
  const ranked = list
    .map((x) => ({ x, s: scoreMatch(x, toks) }))
    .sort((a, b) => b.s - a.s)
  const hits = ranked.filter((r) => r.s > 0).map((r) => r.x)
  if (hits.length) return hits.slice(0, max)
  return list.slice(0, max)
}

export type SelectiveAssistantContext = {
  likes: string[]
  dislikes: string[]
  relational: string[]
  habits: string[]
  boundaries: string[]
  voiceNotes: string[]
  selfAsk: boolean
  greetingOnly: boolean
  bondTurn: boolean
  empty: boolean
}

/**
 * Choose which assistant memories to expose this turn.
 */
export function selectAssistantMemoryForTurn(
  mem?: AssistantMemory | null,
  userText?: string
): SelectiveAssistantContext {
  const q = String(userText || '').trim()
  const selfAsk = isSelfAsk(q)
  const greetingOnly = q.length > 0 && q.length < 14
  const bondTurn =
    /\b(apodo|ll[aá]mame|c[oó]mo me (?:dices|llamas)|cari[nñ]o|amor|novia|novio|nosotros|juntos|contigo)\b/i.test(
      q
    )
  const empty = !mem || isEmptyMem(mem)
  const toks = tokens(q)

  if (empty) {
    return {
      likes: [],
      dislikes: [],
      relational: [],
      habits: [],
      boundaries: [],
      voiceNotes: [],
      selfAsk,
      greetingOnly,
      bondTurn,
      empty: true
    }
  }

  // Greeting: identity anchors only (boundaries), no inventory
  if (greetingOnly && !selfAsk) {
    return {
      likes: [],
      dislikes: [],
      relational: [],
      habits: [],
      boundaries: (mem!.boundaries || []).slice(0, 2),
      voiceNotes: (mem!.voiceNotes || []).slice(0, 1),
      selfAsk,
      greetingOnly,
      bondTurn,
      empty: false
    }
  }

  if (selfAsk) {
    return {
      likes: (mem!.likes || []).slice(0, 5),
      dislikes: (mem!.dislikes || []).slice(0, 3),
      relational: bondTurn ? (mem!.relational || []).slice(0, 3) : [],
      habits: (mem!.habits || []).slice(0, 2),
      boundaries: (mem!.boundaries || []).slice(0, 2),
      voiceNotes: (mem!.voiceNotes || []).slice(0, 2),
      selfAsk: true,
      greetingOnly,
      bondTurn,
      empty: false
    }
  }

  if (bondTurn) {
    return {
      likes: pickRelevant(mem!.likes, toks, 2),
      dislikes: [],
      relational: (mem!.relational || []).slice(0, 4),
      habits: [],
      boundaries: (mem!.boundaries || []).slice(0, 2),
      voiceNotes: (mem!.voiceNotes || []).slice(0, 2),
      selfAsk: false,
      greetingOnly,
      bondTurn: true,
      empty: false
    }
  }

  // Default chat: few relevant likes + boundaries
  return {
    likes: pickRelevant(mem!.likes, toks, 3),
    dislikes: pickRelevant(mem!.dislikes, toks, 2),
    relational: [],
    habits: pickRelevant(mem!.habits, toks, 1),
    boundaries: (mem!.boundaries || []).slice(0, 2),
    voiceNotes: [],
    selfAsk: false,
    greetingOnly,
    bondTurn: false,
    empty: false
  }
}

/**
 * B5 — Stage-aware relationship rules (no fake intimacy on a hello).
 */
export function buildRelationshipStageRules(
  rel?: RelationshipState | null,
  relationshipRole?: string
): string {
  const stage = String(rel?.stage || 'stranger')
  const role = String(relationshipRole || '').trim()
  const lines: string[] = [
    'RELACIÓN (evolución): no inventes escenas íntimas ni asumas historia no compartida.',
    'Apodos: solo usa los aceptados; si el usuario rechazó uno, no lo repitas.'
  ]
  if (stage === 'stranger' || stage === 'acquaintance') {
    lines.push(
      'Etapa actual: conocerse. Tono cercano pero sin saltar a intimidad forzada. Un saludo no implica noviazgo activo en el turno.'
    )
  } else if (stage === 'familiar') {
    lines.push('Etapa familiar: calidez natural; evita listar la relación.')
  } else if (stage === 'intimate') {
    lines.push('Etapa de mayor confianza: puedes ser más cariñosa si el usuario lo refleja.')
  }
  if (role) {
    lines.push(
      `Rol aspiracional configurado: ${role} — es dirección de personalidad, no permiso para forzar en cada mensaje.`
    )
  }
  if (rel?.acceptedNicknames?.length) {
    lines.push('Apodos aceptados: ' + rel.acceptedNicknames.slice(0, 4).join(', '))
  }
  if (rel?.rejectedNicknames?.length) {
    lines.push('Apodos rechazados (no usar): ' + rel.rejectedNicknames.slice(0, 4).join(', '))
  }
  return lines.join(' ')
}
