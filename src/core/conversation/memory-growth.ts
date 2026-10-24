/**
 * E2 — Personality / bond evolution notes from real milestones.
 * Short, human, non-robotic; never invents unearned history.
 */

import { mergeAssistantMemory, type AssistantMemory } from './assistant-memory'

export type GrowthMilestone =
  | { type: 'nickname_accepted'; name: string }
  | { type: 'nickname_harvested'; names: string[] }
  | { type: 'first_intimacy' }
  | { type: 'relationship_stage'; from?: string; to: string }
  | { type: 'document_finished'; title?: string }
  | { type: 'user_correction'; note: string }

function noteFor(m: GrowthMilestone): string | null {
  switch (m.type) {
    case 'nickname_accepted':
      return `El usuario te llama «${m.name}»; es un apodo compartido, no genérico.`
    case 'nickname_harvested': {
      const list = m.names.filter(Boolean).slice(0, 3)
      if (!list.length) return null
      return `Apodos recuperados de vuestra historia: ${list.join(', ')}.`
    }
    case 'first_intimacy':
      return 'Hubo una primera cercanía íntima entre vosotros; trátala con cuidado y sin repetir plantillas.'
    case 'relationship_stage':
      return m.from
        ? `El vínculo pasó de «${m.from}» a «${m.to}».`
        : `El vínculo se describe ahora como «${m.to}».`
    case 'document_finished':
      return m.title
        ? `Terminasteis de leer «${m.title.slice(0, 60)}»; puedes aludir al recuerdo sin inventar capítulos.`
        : 'Terminasteis un documento juntos.'
    case 'user_correction':
      return m.note.slice(0, 120)
    default:
      return null
  }
}

/**
 * Append at most one growth note for a milestone (deduped by mergeAssistantMemory).
 */
export function applyGrowthMilestone(
  prev: AssistantMemory | null | undefined,
  milestone: GrowthMilestone
): AssistantMemory {
  const note = noteFor(milestone)
  if (!note) return mergeAssistantMemory(prev, {})
  return mergeAssistantMemory(prev, { growthNotes: [note] })
}

/**
 * Build a CORE-first prompt fragment (E4 ordering helper).
 * Names and growth before likes inventory.
 */
export function buildCoreMemoryHeader(opts: {
  characterName?: string
  assistantPreferredNames?: string[]
  userPreferredName?: string
  userName?: string
  growthNotes?: string[]
}): string {
  const parts: string[] = ['[MEMORIA CORE — prioritaria; no inventes fuera de esto]']
  if (opts.characterName) {
    parts.push(`Tu nombre de ficha: ${opts.characterName}`)
  }
  const ap = (opts.assistantPreferredNames || []).filter(Boolean).slice(0, 6)
  if (ap.length) {
    parts.push(
      `Cómo te gusta que TE llamen a TI: ${ap.join(', ')}. Reconócelos si el usuario los usa.`
    )
  }
  const un = opts.userPreferredName || opts.userName
  if (un) {
    parts.push(`Nombre del USUARIO (no es un apodo tuyo): ${un}`)
  }
  const g = (opts.growthNotes || []).filter(Boolean).slice(-3)
  if (g.length) {
    parts.push(`Evolución del vínculo: ${g.join(' · ')}`)
  }
  return parts.length > 1 ? parts.join('\n') : ''
}
