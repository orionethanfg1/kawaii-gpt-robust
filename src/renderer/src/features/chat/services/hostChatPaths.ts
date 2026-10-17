/**
 * Host-owned chat entry points (no LLM): status, tools, model inventory.
 */
import { isHostOnlyToolQuery } from '@core/agent/planner'
import {
  forceStatusAndModelsReport,
  isStatusOrModelsQuery,
  runHostToolPlanFromUserGoal
} from './appAgent'

export type HostChatDeps = {
  activeId: string | null
  create: () => string
  addMessage: (
    convId: string,
    msg: {
      role: 'user' | 'assistant'
      content: string
      isStreaming?: boolean
      attachments?: unknown
      meta?: Record<string, unknown>
    }
  ) => string
  updateMessage: (convId: string, id: string, patch: Record<string, unknown>) => void
  setIsLoading: (v: boolean) => void
  setError: (v: string | null) => void
  setLiveStatus: (v: null) => void
  inFlightRef: { current: boolean }
  notifyChatReply?: (preview: string) => void
}

/**
 * @returns true if handled (caller must return).
 * Single assistant bubble — no template ack; content updates when host finishes.
 */
export async function tryHandleHostOwnedChat(
  trimmed: string,
  hasAtt: boolean,
  deps: HostChatDeps
): Promise<boolean> {
  if (!trimmed || hasAtt) return false

  if (isHostOnlyToolQuery(trimmed)) {
    let convId = deps.activeId
    if (!convId) convId = deps.create()
    deps.inFlightRef.current = true
    deps.setIsLoading(true)
    deps.setError(null)
    deps.addMessage(convId, { role: 'user', content: trimmed })
    // One bubble only: streaming placeholder → final humanized report
    const reportId = deps.addMessage(convId, {
      role: 'assistant',
      content: '…',
      isStreaming: true,
      meta: {
        kind: 'harness-activity',
        model: 'harness-host',
        provider: 'app',
        route: 'local',
        reason: 'Herramienta host'
      }
    })
    try {
      const report = await runHostToolPlanFromUserGoal(trimmed)
      deps.updateMessage(convId, reportId, {
        content: report.content || 'Listo.',
        isStreaming: false,
        meta: {
          kind: 'harness-activity',
          model: 'harness-host',
          provider: 'app',
          route: 'local',
          reason: 'Herramienta host',
          planSummary: report.planSummary || 'host-only tool',
          harnessLog: report.actionLog.slice(0, 16)
        }
      })
      try {
        deps.notifyChatReply?.((report.content || '').slice(0, 120))
      } catch {
        /* */
      }
    } catch (e) {
      deps.updateMessage(convId, reportId, {
        content:
          'No pude ejecutar la herramienta local.\n\n' +
          (e instanceof Error ? e.message : String(e)),
        isStreaming: false,
        meta: {
          isError: true,
          kind: 'harness-activity',
          model: 'harness-host',
          provider: 'app',
          route: 'local'
        }
      })
    } finally {
      deps.inFlightRef.current = false
      deps.setIsLoading(false)
      deps.setLiveStatus(null)
    }
    return true
  }

  if (isStatusOrModelsQuery(trimmed)) {
    let convId = deps.activeId
    if (!convId) convId = deps.create()
    deps.inFlightRef.current = true
    deps.setIsLoading(true)
    deps.setError(null)
    deps.addMessage(convId, { role: 'user', content: trimmed })
    const assistantId = deps.addMessage(convId, {
      role: 'assistant',
      content: '…',
      isStreaming: true,
      meta: {
        kind: 'harness-activity',
        model: 'harness-host',
        provider: 'app',
        route: 'local',
        reason: 'Estado y modelos (determinista)'
      }
    })
    try {
      const report = await forceStatusAndModelsReport()
      deps.updateMessage(convId, assistantId, {
        content: report.content,
        isStreaming: false,
        meta: {
          kind: 'harness-activity',
          model: 'harness-host',
          provider: 'app',
          route: 'local',
          reason: 'Estado y modelos (determinista)',
          planSummary: 'diagnóstico host: estado + modelos locales',
          harnessLog: report.actionLog.slice(0, 12)
        }
      })
      try {
        deps.notifyChatReply?.(report.content.slice(0, 120))
      } catch {
        /* */
      }
    } catch (e) {
      deps.updateMessage(convId, assistantId, {
        content:
          'No pude completar el diagnóstico. Revisa Ajustes → Capas.\n\n' +
          (e instanceof Error ? e.message : String(e)),
        isStreaming: false,
        meta: {
          kind: 'harness-activity',
          model: 'harness-host',
          provider: 'app',
          route: 'local',
          reason: 'Error diagnóstico'
        }
      })
    } finally {
      deps.inFlightRef.current = false
      deps.setIsLoading(false)
      deps.setLiveStatus(null)
    }
    return true
  }

  return false
}
