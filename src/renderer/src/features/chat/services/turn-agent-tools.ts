/**
 * Agent / tools post-reply scheduling (X5).
 * Keeps runChatOrchestrationTurn free of harness import details.
 */
import type { DecisionPacket } from '@core/agent/decision-packet'
import { runPostReplyHarness, type PostReplyHarnessDeps } from './postReplyHarness'

export type ScheduleAgentOpts = Omit<PostReplyHarnessDeps, 'needsTools'> & {
  decisionPacket?: DecisionPacket | null
}

/** True when this turn should run host tools / APP_ACTION pipeline. */
export function turnNeedsHostTools(
  packet: DecisionPacket | null | undefined,
  userText: string
): boolean {
  if (packet?.needsTools || packet?.inject.fullHarness) return true
  if (packet?.task === 'files' || packet?.task === 'mixed' || packet?.inject.library) return true
  const t = String(userText || '')
  if (/^\[APP\]/i.test(t.trim())) return true
  if (
    /\b(diagn[oó]stico|autodiagn[oó]stico|herramientas?|forge|faceid|listar\s+modelos|estado\s+de\s+la\s+app|health_forge|APP_ACTION)\b/i.test(
      t
    )
  ) {
    return true
  }
  return false
}

export function scheduleTurnAgentAfterReply(opts: ScheduleAgentOpts): void {
  const needsTools = turnNeedsHostTools(opts.decisionPacket, opts.trimmed)
  void runPostReplyHarness({
    convId: opts.convId,
    assistantId: opts.assistantId,
    trimmed: opts.trimmed,
    meta: opts.meta,
    addMessage: opts.addMessage,
    updateMessage: opts.updateMessage,
    deleteMessage: opts.deleteMessage,
    notifyChatReply: opts.notifyChatReply,
    setPhase: opts.setPhase,
    annotateEmojisForModel: opts.annotateEmojisForModel,
    apiKey: opts.apiKey,
    providerKeys: opts.providerKeys,
    needsTools
  })
}
