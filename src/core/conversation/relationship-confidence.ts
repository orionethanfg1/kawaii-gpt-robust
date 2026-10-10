/**
 * M4 — Relationship confidence + evolutionary nicknames.
 * Propose → accept/reject → write memory. Never impose.
 */

import type { UserMemory } from './user-memory'
import type { RelationshipState } from './dual-memory'
import { isUserMemorySparse } from './dual-memory'
import type { MemoryOnboardingState } from './memory-onboarding'
import { shouldRunOnboarding } from './memory-onboarding'

export type RelationshipStage = 'stranger' | 'acquaintance' | 'familiar' | 'intimate'

const BASE_CANDIDATES = ['amor', 'cariño', 'cielo']

/** Nickname pool extended by personality / style / role text */
export function nicknamePoolFromPersonality(blob?: string | null): string[] {
  const b = String(blob || '').toLowerCase()
  const extra: string[] = []
  if (/cariñ|amor|pareja|novia|cálid|calid|leal|atenta|dulce|sincera/.test(b)) {
    extra.push('amor', 'cariño', 'mi vida', 'corazón')
  }
  if (/jugueton|juguetón|coquet|travies|divert|bromista/.test(b)) {
    extra.push('campeón', 'crack', 'genio')
  }
  if (/tranqui|seren|pacien|suave|calm/.test(b)) {
    extra.push('querido', 'compañero')
  }
  if (/celtic|gaélic|irland|niamh|fantas|místic|mistico/.test(b)) {
    extra.push('a stór', 'mo chroí')
  }
  if (/kawaii|anime|moe/.test(b)) {
    extra.push('senpai', 'cari')
  }
  return [...BASE_CANDIDATES, ...extra]
}

export function emptyRelationshipState(): RelationshipState {
  return {
    stage: 'stranger',
    acceptedNicknames: [],
    rejectedNicknames: [],
    turnsTogether: 0,
    updatedAt: Date.now()
  }
}

export function computeStage(input: {
  turnsTogether?: number
  userMemory?: UserMemory | null
  rejectedCount?: number
}): RelationshipStage {
  const turns = Math.max(0, input.turnsTogether || 0)
  const mem = input.userMemory
  const hasName = Boolean((mem?.preferredName || '').trim())
  const likes = mem?.likes?.length || 0
  const accepted = mem?.nicknames?.length || 0
  let score = 0
  score += Math.min(40, turns * 2)
  if (hasName) score += 15
  score += Math.min(20, likes * 5)
  score += Math.min(15, accepted * 8)
  score -= Math.min(20, (input.rejectedCount || 0) * 5)
  if (score < 15) return 'stranger'
  if (score < 35) return 'acquaintance'
  if (score < 55) return 'familiar'
  return 'intimate'
}

export function bumpTurns(
  prev: RelationshipState | null | undefined,
  delta = 1
): RelationshipState {
  const base = { ...emptyRelationshipState(), ...(prev || {}) }
  const turnsTogether = Math.max(0, (base.turnsTogether || 0) + delta)
  const stage = computeStage({
    turnsTogether,
    rejectedCount: base.rejectedNicknames?.length || 0
  })
  return {
    ...base,
    turnsTogether,
    stage,
    updatedAt: Date.now()
  }
}

export function nicknameCandidates(
  rel?: RelationshipState | null,
  mem?: UserMemory | null,
  personalityBlob?: string | null
): string[] {
  const rejected = new Set(
    (rel?.rejectedNicknames || []).map((x) => x.toLowerCase())
  )
  const accepted = new Set(
    [...(rel?.acceptedNicknames || []), ...(mem?.nicknames || []), mem?.preferredName || '']
      .filter(Boolean)
      .map((x) => String(x).toLowerCase())
  )
  const pool = nicknamePoolFromPersonality(personalityBlob)
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of pool) {
    const k = c.toLowerCase()
    if (seen.has(k) || rejected.has(k) || accepted.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}

const PROPOSAL_COOLDOWN_MS = 4 * 60 * 60 * 1000 // 4h base; intimate uses half

export function shouldProposeNickname(opts: {
  relationship?: RelationshipState | null
  userMemory?: UserMemory | null
  onboarding?: MemoryOnboardingState | null
  memoryGatePending?: boolean
  now?: number
  personalityBlob?: string | null
}): boolean {
  if (opts.memoryGatePending) return false
  if (
    shouldRunOnboarding({
      userMemory: opts.userMemory,
      onboarding: opts.onboarding,
      memoryGatePending: opts.memoryGatePending
    })
  ) {
    return false
  }
  if (opts.userMemory?.pendingNickname) return false
  if (isUserMemorySparse(opts.userMemory)) return false

  const stage = (opts.relationship?.stage ||
    computeStage({
      turnsTogether: opts.relationship?.turnsTogether,
      userMemory: opts.userMemory,
      rejectedCount: opts.relationship?.rejectedNicknames?.length
    })) as RelationshipStage

  if (stage === 'stranger') return false
  const turns = opts.relationship?.turnsTogether || 0
  const minTurns =
    stage === 'intimate' ? 2 : stage === 'familiar' ? 3 : stage === 'acquaintance' ? 5 : 99
  if (turns < minTurns) return false

  const last = opts.relationship?.lastProposalAt || 0
  const now = opts.now ?? Date.now()
  const cooldown =
    stage === 'intimate'
      ? PROPOSAL_COOLDOWN_MS / 2
      : stage === 'familiar'
        ? PROPOSAL_COOLDOWN_MS * 0.75
        : PROPOSAL_COOLDOWN_MS
  if (last && now - last < cooldown) return false

  const cands = nicknameCandidates(opts.relationship, opts.userMemory, opts.personalityBlob)
  return cands.length > 0
}

export function pickNicknameProposal(
  rel?: RelationshipState | null,
  mem?: UserMemory | null,
  personalityBlob?: string | null
): string | null {
  const cands = nicknameCandidates(rel, mem, personalityBlob)
  if (!cands.length) return null
  const turns = rel?.turnsTogether || 0
  return cands[turns % cands.length] || cands[0]
}

export function buildNicknameProposalText(
  nickname: string,
  characterName?: string
): string {
  const who = characterName || 'yo'
  return (
    'Oye… ¿te gustaría que te diga «' +
    nickname +
    '»? Si prefieres solo tu nombre, dímelo y lo respeto.'
  )
}

export function markProposalSent(
  prev: RelationshipState | null | undefined,
  nickname: string
): RelationshipState {
  const base = { ...emptyRelationshipState(), ...(prev || {}) }
  return {
    ...base,
    lastProposalAt: Date.now(),
    stage: computeStage({
      turnsTogether: base.turnsTogether,
      rejectedCount: base.rejectedNicknames?.length
    }),
    updatedAt: Date.now()
  }
}

export function acceptNickname(
  mem: UserMemory | null | undefined,
  rel: RelationshipState | null | undefined,
  nickname: string
): { userMemory: UserMemory; relationship: RelationshipState } {
  const n = nickname.trim().slice(0, 32)
  const nicks = Array.isArray(mem?.nicknames) ? [...mem!.nicknames!] : []
  if (n && !nicks.map((x) => x.toLowerCase()).includes(n.toLowerCase())) nicks.push(n)
  const accepted = Array.isArray(rel?.acceptedNicknames) ? [...rel!.acceptedNicknames!] : []
  if (n && !accepted.map((x) => x.toLowerCase()).includes(n.toLowerCase())) accepted.push(n)
  const userMemory: UserMemory = {
    ...(mem || {}),
    preferredName: mem?.preferredName || n,
    nicknames: nicks.slice(0, 12),
    pendingNickname: undefined,
    updatedAt: Date.now()
  }
  const relationship: RelationshipState = {
    ...emptyRelationshipState(),
    ...(rel || {}),
    acceptedNicknames: accepted.slice(0, 12),
    stage: computeStage({
      turnsTogether: rel?.turnsTogether,
      userMemory,
      rejectedCount: rel?.rejectedNicknames?.length
    }),
    updatedAt: Date.now()
  }
  return { userMemory, relationship }
}

export function rejectNickname(
  mem: UserMemory | null | undefined,
  rel: RelationshipState | null | undefined,
  nickname: string
): { userMemory: UserMemory; relationship: RelationshipState } {
  const n = nickname.trim().slice(0, 32)
  const rejected = Array.isArray(rel?.rejectedNicknames) ? [...rel!.rejectedNicknames!] : []
  if (n && !rejected.map((x) => x.toLowerCase()).includes(n.toLowerCase())) rejected.push(n)
  const userMemory: UserMemory = {
    ...(mem || {}),
    pendingNickname: undefined,
    updatedAt: Date.now()
  }
  const relationship: RelationshipState = {
    ...emptyRelationshipState(),
    ...(rel || {}),
    rejectedNicknames: rejected.slice(0, 12),
    lastProposalAt: Date.now(),
    stage: computeStage({
      turnsTogether: rel?.turnsTogether,
      userMemory,
      rejectedCount: rejected.length
    }),
    updatedAt: Date.now()
  }
  return { userMemory, relationship }
}

/** System prompt: how confident to sound */
export function buildConfidenceSystemPrompt(
  rel?: RelationshipState | null,
  mem?: UserMemory | null
): string {
  const sparse = isUserMemorySparse(mem)
  let stage =
    (rel?.stage as RelationshipStage) ||
    computeStage({
      turnsTogether: rel?.turnsTogether,
      userMemory: mem,
      rejectedCount: rel?.rejectedNicknames?.length
    })
  // Cleared / empty memory must not keep intimate stage behavior
  if (sparse) stage = 'stranger'
  const name = sparse ? undefined : mem?.preferredName || mem?.nicknames?.[0]
  const lines: string[] = []
  if (stage === 'stranger' || sparse) {
    lines.push(
      'Aún conoces poco al usuario: no inventes su nombre ni recuerdos compartidos. ' +
        'Si tu rol es de pareja/novia puedes ser cálida, pero el vínculo se está construyendo (meta), no está dado por hecho. ' +
        'Una sola respuesta; no repitas el mismo saludo.'
    )
  } else if (stage === 'acquaintance') {
    lines.push(
      'Confianza media: puedes ser cercana, pero no inventes apodos nuevos sin preguntar antes.'
    )
  } else if (stage === 'familiar') {
    lines.push(
      'Confianza buena: usa apodos ya aceptados si los hay; si propones uno nuevo, pregunta primero.'
    )
  } else {
    lines.push(
      'Confianza alta: puedes usar apodos ya aceptados con naturalidad; no inventes títulos nuevos sin consentimiento.'
    )
  }
  if (name) lines.push('Nombre/apodo ya aceptado: ' + name + '.')
  if (mem?.pendingNickname) {
    lines.push(
      'Hay un apodo pendiente de confirmación («' +
        mem.pendingNickname +
        '»): no lo uses como definitivo hasta que acepte.'
    )
  }
  if (rel?.rejectedNicknames?.length) {
    lines.push(
      'No uses estos apodos (rechazados): ' + rel.rejectedNicknames.slice(0, 6).join(', ') + '.'
    )
  }
  return lines.join(' ')
}

export type NicknameChip = { id: string; label: string; action: 'accept' | 'reject' | 'other' }

export function chipsForPendingNickname(pending: string): NicknameChip[] {
  return [
    { id: 'yes', label: 'Sí, «' + pending + '»', action: 'accept' },
    { id: 'no', label: 'Mejor no', action: 'reject' }
  ]
}
