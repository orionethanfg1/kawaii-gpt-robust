/**
 * M0 — Dual memory view: user + assistant + optional relationship shell.
 * Settings still store userMemory / assistantMemory flat; this module is the API.
 */

import type { UserMemory } from './user-memory'
import { flattenFacts } from './user-memory'
import type { AssistantMemory } from './assistant-memory'
import { emptyAssistantMemory, isAssistantMemoryEmpty } from './assistant-memory'

export type RelationshipState = {
  /** stranger | acquaintance | familiar | intimate */
  stage?: string
  acceptedNicknames?: string[]
  rejectedNicknames?: string[]
  lastProposalAt?: number
  turnsTogether?: number
  updatedAt?: number
}

export type DualMemory = {
  user: UserMemory
  assistant: AssistantMemory
  relationship?: RelationshipState
}

export type DualMemorySource = {
  userMemory?: UserMemory | null
  assistantMemory?: AssistantMemory | null
  relationshipState?: RelationshipState | null
}

export function emptyUserMemory(): UserMemory {
  return {
    facts: [],
    factEntries: [],
    nicknames: [],
    goals: [],
    likes: [],
    dislikes: [],
    people: [],
    emotionalNotes: [],
    avatarScenes: [],
    updatedAt: Date.now()
  }
}

/** Normalize legacy flat userMemory into DualMemory */
export function migrateToDual(src: DualMemorySource | null | undefined): DualMemory {
  const user = src?.userMemory && typeof src.userMemory === 'object'
    ? { ...emptyUserMemory(), ...src.userMemory }
    : emptyUserMemory()
  const assistant =
    src?.assistantMemory && typeof src.assistantMemory === 'object'
      ? { ...emptyAssistantMemory(), ...src.assistantMemory }
      : emptyAssistantMemory()
  const relationship =
    src?.relationshipState && typeof src.relationshipState === 'object'
      ? { ...src.relationshipState }
      : undefined
  return { user, assistant, relationship }
}

export function isUserMemorySparse(mem?: UserMemory | null): boolean {
  if (!mem) return true
  const facts = flattenFacts(mem)
  const hasName = Boolean((mem.preferredName || '').trim())
  const hasLikes = (mem.likes?.length || 0) > 0
  const hasFacts = facts.length > 0
  const hasPeople = (mem.people?.length || 0) > 0
  return !hasName && !hasLikes && !hasFacts && !hasPeople
}

export function dualFromSettings(settings: {
  userMemory?: UserMemory | null
  assistantMemory?: AssistantMemory | null
  relationshipState?: RelationshipState | null
}): DualMemory {
  return migrateToDual(settings)
}

export function summarizeDual(d: DualMemory): string {
  const uSparse = isUserMemorySparse(d.user)
  const aEmpty = isAssistantMemoryEmpty(d.assistant)
  return (
    'user:' +
    (uSparse ? 'sparse' : 'rich') +
    ' assistant:' +
    (aEmpty ? 'empty' : 'set') +
    (d.relationship?.stage ? ' rel:' + d.relationship.stage : '')
  )
}
