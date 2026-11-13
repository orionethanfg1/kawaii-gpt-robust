/**
 * X8 — intimacy system inject only when DecisionPacket.inject.intimacyBlock.
 */
import type { DecisionPacket } from '@core/agent/decision-packet'
import { effectiveAdultIntimacyOptIn } from '@core/user/age-gate'
import type { Settings } from '@shared/types/settings'

export function shouldInjectIntimacy(packet: DecisionPacket | null | undefined): boolean {
  return Boolean(packet?.inject?.intimacyBlock)
}

export async function buildIntimacyInjectBlock(opts: {
  packet: DecisionPacket | null | undefined
  settings: Settings | Record<string, unknown>
  recentTexts?: string[]
  userText?: string
  /** Transparent doc continue — never inject scene */
  isAppDocContinue?: boolean
}): Promise<string> {
  if (!shouldInjectIntimacy(opts.packet)) return ''
  if (opts.isAppDocContinue) return ''
  const settings = opts.settings as Settings
  const parts: string[] = []
  try {
    const {
      resolveLiveIntimatePhase,
      buildIntimatePhaseSystemPrompt,
      buildIntimacyMemoryPromptRules
    } = await import('@core/conversation/intimacy-memory')
    const rel = (settings as { relationshipState?: import('@core/conversation/dual-memory').RelationshipState })
      .relationshipState
    const facts = (settings as { userMemory?: { facts?: string[] } }).userMemory?.facts || []
    const adult = effectiveAdultIntimacyOptIn({
      adultIntimacyOptIn: (settings as { adultIntimacyOptIn?: boolean }).adultIntimacyOptIn,
      userBirthDate: (settings as { userBirthDate?: string }).userBirthDate
    })
    const phase = resolveLiveIntimatePhase({
      relationship: rel,
      facts,
      recentTexts: opts.recentTexts || [],
      userText: opts.userText
    })
    const phasePrompt = buildIntimatePhaseSystemPrompt({
      phase,
      characterName: settings.character?.name,
      hourLocal: new Date().getHours()
    })
    if (phasePrompt) parts.push(phasePrompt)
    const mem = buildIntimacyMemoryPromptRules({
      facts,
      relationship: rel,
      adultOptIn: adult
    })
    if (mem) parts.push(mem)
  } catch {
    /* optional */
  }
  try {
    const { buildIntimacyStagePromptRules } = await import('@core/conversation/intimacy-stage')
    const rel = (settings as { relationshipState?: import('@core/conversation/dual-memory').RelationshipState })
      .relationshipState
    const adult = effectiveAdultIntimacyOptIn({
      adultIntimacyOptIn: (settings as { adultIntimacyOptIn?: boolean }).adultIntimacyOptIn,
      userBirthDate: (settings as { userBirthDate?: string }).userBirthDate
    })
    const stage = buildIntimacyStagePromptRules({
      stage: rel?.stage,
      adultOptIn: adult,
      intimacyOpen: Boolean(rel?.intimacyOpen),
      relationshipRole: settings.character?.relationshipRole
    })
    if (stage) parts.push(stage)
  } catch {
    /* optional */
  }
  return parts.filter(Boolean).join('\n\n')
}
