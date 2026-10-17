/**
 * Post-reply host harness (after assistant stream completes).
 * Extracted from useChat onDone to keep the hook thinner.
 */
import { stripHarnessMarkup } from '@core/agent'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import {
  runActionsFromAssistantText,
  extractModelTagsFromObservations,
  formatHostStatusAndModelsReply,
} from './appAgent'

export type PostReplyHarnessDeps = {
  convId: string
  assistantId: string
  trimmed: string
  meta: {
    model?: string
    provider?: string
    latencyMs?: number
    route?: {
      target?: string
      reason?: string
      at?: number
      failover?: boolean
      contextPacked?: boolean
      summarySource?: string
      model?: string
    }
  }
  addMessage: (
    convId: string,
    msg: {
      role: 'user' | 'assistant'
      content: string
      isStreaming?: boolean
      meta?: Record<string, unknown>
    }
  ) => string
  updateMessage: (convId: string, id: string, patch: Record<string, unknown>) => void
  deleteMessage: (convId: string, id: string) => void
  notifyChatReply: (preview: string, meta?: { model?: string }) => void
  setPhase: (phase: string, route?: unknown) => void
  annotateEmojisForModel: (t: string) => string
  apiKey?: string
  providerKeys?: Record<string, string>
}

export async function runPostReplyHarness(deps: PostReplyHarnessDeps): Promise<void> {
  const {
    convId,
    assistantId,
    trimmed,
    meta,
    addMessage,
    updateMessage,
    deleteMessage,
    notifyChatReply,
    setPhase
  } = deps

  try {
    const cur = useChatStore
      .getState()
      .conversations.find((c) => c.id === convId)
      ?.messages.find((m) => m.id === assistantId)
    const raw = cur?.content || ''
    try {
      const { parseAppPlan, parseAppActions } = await import('./appAgent')
      const planned = parseAppPlan(raw)
      const { cleanText: pre } = parseAppActions(planned.cleanText)
      const early = stripHarnessMarkup(pre || raw).trim()
      if (early) {
        updateMessage(convId, assistantId, {
          content: early,
          isStreaming: false,
          meta: {
            model: meta.model,
            provider: meta.provider,
            latencyMs: meta.latencyMs,
            route: meta.route?.target,
            reason: meta.route?.reason,
            toolsUsed: meta.route?.toolsUsed
          }
        })
      }
    } catch {
      const early = stripHarnessMarkup(raw).trim()
      if (early) {
        updateMessage(convId, assistantId, {
          content: early,
          isStreaming: false
        })
      }
    }

    let activityId: string | null = null
    // B4: only explicit ops — not casual chat (gracias, he estado, libro…)
    const maybeHost =
      /\b(estado\s+de\s+(?:la\s+)?(?:app|capas)|app\s+status|diagn[oó]stic|revisa(?:r)?\s+la\s+app|lista(?:r)?\s+modelos|arranca\s+forge|lm\s*studio|qu[eé]\s+puedes\s+hacer|lista\s+de\s+capacidades)\b/i.test(
        trimmed
      )
    if (maybeHost) {
      activityId = addMessage(convId, {
        role: 'assistant',
        content: '⏳ Revisando en la app…',
        isStreaming: false,
        meta: {
          kind: 'harness-activity',
          model: 'harness-host',
          provider: 'app',
          route: 'local'
        }
      })
    }

    let cleanText = raw
    let actionLog: string[] = []
    let observations: string[] = []
    let hadActions = false
    let planSummary: string | undefined
    try {
      const ran = await runActionsFromAssistantText(raw, { userGoal: trimmed })
      cleanText = ran.cleanText
      actionLog = ran.actionLog
      observations = ran.observations
      hadActions = ran.hadActions
      planSummary = ran.planSummary
      // P2.3: tools on primary reply meta (keep harness bubble collapsible noise low)
      if (hadActions && actionLog.length) {
        try {
          const toolNames = actionLog
            .map((l) => {
              const m = /^\s*[✓*]\s*([a-z0-9_]+)/i.exec(l) || /\b([a-z][a-z0-9_]{2,})\s*:/i.exec(l)
              return m ? m[1] : null
            })
            .filter(Boolean) as string[]
          updateMessage(convId, assistantId, {
            meta: {
              ...(useChatStore
                .getState()
                .conversations.find((c) => c.id === convId)
                ?.messages.find((m) => m.id === assistantId)?.meta || {}),
              toolsUsed: toolNames.slice(0, 6),
              planSummary: planSummary || undefined
            }
          })
        } catch {
          /* */
        }
      }
    } catch (harnessErr) {
      if (activityId) {
        updateMessage(convId, activityId, {
          content:
            'No pude completar la revisión: ' +
            (harnessErr instanceof Error ? harnessErr.message : String(harnessErr)).slice(0, 240),
          isStreaming: false,
          meta: { kind: 'harness-activity', isError: true }
        })
      }
      return
    }

    const cleaned = stripHarnessMarkup(cleanText).trim()
    updateMessage(convId, assistantId, {
      content: cleaned || '(listo)',
      isStreaming: false,
      meta: {
        model: meta.model,
        provider: meta.provider,
        latencyMs: meta.latencyMs,
        route: meta.route?.target
      }
    })

    if (hadActions && !activityId) {
      activityId = addMessage(convId, {
        role: 'assistant',
        content: '⏳ Revisando en la app…',
        isStreaming: false,
        meta: {
          kind: 'harness-activity',
          model: 'harness-host',
          provider: 'app',
          route: 'local'
        }
      })
    }
    if (hadActions && observations.length === 0 && activityId) {
      updateMessage(convId, activityId, {
        content:
          'Revisión terminada sin datos extra. Prueba «rescanea modelos» o «qué falta».',
        isStreaming: false,
        meta: {
          kind: 'harness-activity',
          harnessLog: actionLog.slice(0, 12),
          planSummary
        }
      })
    }
    if (!hadActions && activityId) {
      try {
        deleteMessage(convId, activityId)
      } catch {
        updateMessage(convId, activityId, {
          content: '',
          isStreaming: false,
          meta: { kind: 'harness-activity', hidden: true }
        })
      }
      activityId = null
    }

    if (hadActions && observations.length > 0) {
      const wantsStatusOrModels =
        /\b(estado\s+de\s+|status\b|diagn|revisa(?:r)?\s+(?:la\s+)?app|modelos|lista(?:r)?\s+modelos|forge|capas|ollama|lm\s*studio|qu[eé]\s+puedes\s+hacer|lista\s+de\s+capacidades)\b/i.test(
          trimmed
        )
      if (wantsStatusOrModels) {
        let statusBody = formatHostStatusAndModelsReply(
          observations,
          extractModelTagsFromObservations(observations)
        )
        try {
          const { humanizeHostObservations } = await import('@core/agent/humanize-host-reply')
          const hum = humanizeHostObservations(observations, { userGoal: trimmed })
          if (hum && !hum.trim().startsWith('{')) statusBody = hum
        } catch {
          /* */
        }
        // capabilities tool often returns long markdown in summary
        const capObs = observations.find((o) => {
          try {
            return JSON.parse(o).tool === 'list_host_commands'
          } catch {
            return false
          }
        })
        if (capObs) {
          try {
            const j = JSON.parse(capObs) as { summary?: string }
            if (j.summary && j.summary.length > 80) statusBody = j.summary
          } catch {
            /* */
          }
        }
        if (activityId) {
          updateMessage(convId, activityId, {
            content: statusBody,
            isStreaming: false,
            meta: {
              kind: 'harness-activity',
              model: 'harness-host',
              provider: 'app',
              route: 'local',
              reason: 'Host facts',
              harnessLog: actionLog.slice(0, 12),
              planSummary
            }
          })
        } else if ((cleaned || '').length < 40) {
          updateMessage(convId, assistantId, {
            content: statusBody,
            isStreaming: false,
            meta: {
              kind: 'harness-activity',
              model: 'harness-host',
              provider: 'app',
              route: 'local',
              harnessLog: actionLog.slice(0, 12),
              planSummary
            }
          })
        }
        notifyChatReply(statusBody.slice(0, 120))
        return
      }

      // Non-status tools: humanize observations into activity bubble (no second LLM required)
      try {
        const { humanizeHostObservations } = await import('@core/agent/humanize-host-reply')
        const body = humanizeHostObservations(observations, { userGoal: trimmed })
        if (activityId) {
          updateMessage(convId, activityId, {
            content: body || statusFallback(observations),
            isStreaming: false,
            meta: {
              kind: 'harness-activity',
              model: 'harness-host',
              provider: 'app',
              harnessLog: actionLog.slice(0, 12),
              planSummary
            }
          })
        }
      } catch {
        if (activityId) {
          updateMessage(convId, activityId, {
            content: statusFallback(observations),
            isStreaming: false,
            meta: { kind: 'harness-activity' }
          })
        }
      }
    }
  } catch {
    /* ignore */
  }
}


function statusFallback(observations: string[]): string {
  try {
    return formatHostStatusAndModelsReply(
      observations,
      extractModelTagsFromObservations(observations)
    )
  } catch {
    return 'Revisión host terminada.'
  }
}
