/**
 * App self-agent orchestration (M2: tools live under ./hostTools).
 */
import {
  AgentAuditLog,
  parseAppActions,
  parseAppPlan,
  planFromActions,
  suggestPlanFromUserGoal,
  executePlan,
  refinePlanWithLiveStatus,
  formatPlanForLog,
  type AppToolName,
  type AgentPlan,
  recordToolFailure,
  recordToolSuccess,
  shouldSkipTool,
  recordPreferredLocalModel,
  recordHarnessSuccess
} from '@core/agent'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useAgentApprovalStore } from '@shared/lib/stores/agentApprovalStore'
import { tryHandleAppControl } from './appControl'
import {
  extractModelTagsFromObservations,
  formatHostStatusAndModelsReply,
  formatHostModelListReply,
  isHallucinatedModelList,
  buildToolObservationPrompt,
  isStatusOrModelsQuery
} from './host-formatters'
import {
  executeAppTool,
  buildAppStatusSnapshot,
  applySmartLocalModelAuto,
  applyAutoModelRouting,
  buildAppAgentSystemBlock,
  invalidateAppAgentStatusCache
} from './hostTools'

const agentAudit = new AgentAuditLog()

export {
  executeAppTool,
  buildAppStatusSnapshot,
  applySmartLocalModelAuto,
  applyAutoModelRouting,
  buildAppAgentSystemBlock,
  invalidateAppAgentStatusCache
}

export async function forceStatusAndModelsReport(): Promise<{
  content: string
  observations: string[]
  tags: string[]
  actionLog: string[]
}> {
  const actionLog: string[] = []
  const observations: string[] = []
  const run = async (tool: string, args?: Record<string, unknown>) => {
    const r = await executeAppTool({ tool, args })
    const summary = r.summary || (r.ok ? 'ok' : r.error || 'fail')
    observations.push(JSON.stringify({ tool, ok: r.ok, summary }))
    actionLog.push(`${r.ok ? '✓' : '✗'} ${tool}: ${summary.slice(0, 160)}`)
    return r
  }
  try {
    await run('get_app_status')
  } catch (e) {
    observations.push(JSON.stringify({ tool: 'get_app_status', ok: false, summary: String(e) }))
  }
  try {
    await run('list_installed_models')
  } catch (e) {
    observations.push(JSON.stringify({ tool: 'list_installed_models', ok: false, summary: String(e) }))
  }
  try {
    await run('check_local_runtime')
  } catch {
    /* optional */
  }
  try {
    await run('health_forge')
  } catch {
    /* optional */
  }
  try {
    await run('assess_image_stack')
  } catch {
    /* optional */
  }
  const tags = extractModelTagsFromObservations(observations)
  let content = formatHostStatusAndModelsReply(observations, tags)
  const gapObs = observations.find((o) => {
    try {
      return JSON.parse(o).tool === 'assess_image_stack'
    } catch {
      return false
    }
  })
  if (gapObs) {
    try {
      const j = JSON.parse(gapObs) as { summary?: string }
      if (j.summary) content += '\n\n' + j.summary
    } catch {
      /* */
    }
  }
  try {
    recordHarnessSuccess('status_report', `${tags.length} models`)
    const active = useSettingsStore.getState().settings.localModel
    if (active) recordPreferredLocalModel(active)
  } catch {
    /* ignore */
  }
  return { content, observations, tags, actionLog }
}


export async function runHostToolPlanFromUserGoal(userGoal: string): Promise<{
  content: string
  actionLog: string[]
  observations: string[]
  hadActions: boolean
  planSummary?: string
}> {
  const { isHostOnlyToolQuery, suggestPlanFromUserGoal } = await import('@core/agent/planner')
  if (!isHostOnlyToolQuery(userGoal) && !suggestPlanFromUserGoal(userGoal)) {
    return { content: '', actionLog: [], observations: [], hadActions: false }
  }
  // Empty assistant text → host plan from user goal only
  const r = await runActionsFromAssistantText('', { userGoal })
  const obs = r.observations.filter(Boolean)
  let body: string
  try {
    const { humanizeHostObservations } = await import('@core/agent/humanize-host-reply')
    body =
      obs.length > 0
        ? humanizeHostObservations(obs, { userGoal })
        : r.hadActions
          ? 'Listo (sin detalle técnico).'
          : 'No encontré acciones de host para ese pedido.'
    // Never leave raw JSON blobs as the only reply
    if (body.trim().startsWith('{') && /"tool"\s*:/.test(body)) {
      const tags = extractModelTagsFromObservations(obs)
      body = formatHostStatusAndModelsReply(obs, tags)
    }
  } catch {
    try {
      const tags = extractModelTagsFromObservations(obs)
      body = formatHostStatusAndModelsReply(obs, tags)
    } catch {
      body =
        obs.length > 0
          ? 'Revisión hecha, pero no pude formatear el detalle. Mira Ajustes → Detectar Ollama / LM Studio.'
          : r.hadActions
            ? 'Listo (sin detalle extra).'
            : 'No encontré acciones de host para ese pedido.'
    }
  }
  return {
    content: body,
    actionLog: r.actionLog,
    observations: r.observations,
    hadActions: r.hadActions,
    planSummary: r.planSummary
  }
}

export async function runActionsFromAssistantText(

  text: string,
  opts?: { userGoal?: string }
): Promise<{
  cleanText: string
  actionLog: string[]
  observations: string[]
  hadActions: boolean
  planSummary?: string
}> {
  const userGoal = opts?.userGoal || ''
  const planned = parseAppPlan(text)
  const { cleanText: afterActions, actions } = parseAppActions(planned.cleanText)
  const cleanText = afterActions

  let plan: AgentPlan | null = planned.plan
  if (!plan) plan = planFromActions(actions, userGoal)
  if (!plan || !plan.steps.length) {
    // Host fallback: only if the user clearly asked for app control
    const host = suggestPlanFromUserGoal(userGoal)
    if (host) plan = host
  }

  if (!plan || !plan.steps.length) {
    return { cleanText, actionLog: [], observations: [], hadActions: false }
  }

  // Adaptive plan: rewrite steps using live app status (skip start_forge if already up, etc.)
  try {
    const snap = await buildAppStatusSnapshot()
    let musicRunning = false
    try {
      const ms = await window.kawaii?.musicStatus?.()
      musicRunning =
        Boolean((ms as { running?: boolean })?.running) ||
        String((ms as { state?: string })?.state || '') === 'running'
    } catch {
      /* ignore */
    }
    const refined = refinePlanWithLiveStatus(plan, {
      forgeState: snap.forgeState,
      forgeOk: /run|ready/i.test(String(snap.forgeState || '')),
      localOk: snap.localOk,
      musicRunning,
      localModel: snap.localModel,
      notes: snap.notes
    })
    if (JSON.stringify(refined.steps) !== JSON.stringify(plan.steps)) {
      plan = {
        ...refined,
        goal: plan.goal || refined.goal,
        source: plan.source
      }
    }
  } catch {
    /* keep original plan */
  }

  if (!plan.steps.length) {
    return {
      cleanText,
      actionLog: ['📋 plan vacío tras adaptar al estado vivo'],
      observations: [],
      hadActions: false,
      planSummary: 'plan vacío (estado ya OK)'
    }
  }

  const actionLog: string[] = []
  actionLog.push(`📋 ${formatPlanForLog(plan)}`)

  const approve = async (toolName: string, risk: string) => {
    if (risk === 'read' || risk === 'reversible') return true
    const reasons: Record<string, string> = {
      start_forge: 'iniciará Forge (RAM/VRAM/disco)',
      start_music: 'iniciará ACE / capa de música (VRAM/CPU)',
      voice_ensure: 'instalará o preparará el motor de voz (red/disco)',
      start_ollama: 'iniciará Ollama (memoria/CPU)',
      download_model: 'descargará un modelo (puede ser varios GB de disco y red)',
      resume_download: 'reanudará una descarga de modelo',
      delete_model: 'ELIMINARÁ un modelo del disco de forma permanente'
    }
    return useAgentApprovalStore.getState().request(
      toolName,
      reasons[toolName] || `acción sensible: ${toolName}`
    )
  }

  const riskOf = (tool: string): string => {
    if (
      [
        'get_app_status',
        'health_forge',
        'list_models',
        'list_installed_models',
        'recommend_model',
        'check_local_runtime',
        'list_download_jobs',
        'run_diagnosis'
      ].includes(tool)
    )
      return 'read'
    if (
      [
        'start_forge',
        'start_music',
        'start_ollama',
        'download_model',
        'resume_download',
        'voice_ensure'
      ].includes(tool)
    )
      return 'resource'
    if (tool === 'delete_model') return 'destructive'
    return 'reversible'
  }

  const { results, stoppedReason } = await executePlan(
    plan,
    async (step) => {
      const tool = String(step.tool)
      const skip = shouldSkipTool(tool)
      if (skip.skip) {
        return { ok: false, summary: skip.reason || 'skipped_by_failure_memory', error: 'cooldown' }
      }
      const risk = riskOf(tool)
      if (!(await approve(tool, risk))) {
        return { ok: false, summary: 'resource_action_requires_approval', error: 'denied' }
      }
      const out = await executeAppTool({ tool: tool as AppToolName, args: step.args })
      if (out.ok) recordToolSuccess(tool)
      else recordToolFailure(tool, out.summary)
      return out
    },
    { maxSteps: 8 }
  )

  for (const step of results) {
    if (step.skipped) {
      actionLog.push(`⏭ ${step.tool}: omitido`)
      agentAudit.push(`skip ${step.tool}`)
      continue
    }
    const output = step.output as { ok?: boolean; summary?: string } | undefined
    const summary = output?.summary || step.error || 'sin resultado'
    actionLog.push(`${step.ok ? '✓' : '✗'} ${step.tool}: ${summary}`)
    agentAudit.push(`${step.tool} ok=${step.ok} ${summary}`)
  }
  if (stoppedReason) {
    actionLog.push(`⏹ plan detenido: ${stoppedReason}`)
  }

  const observations = results
    .filter((s) => !s.skipped)
    .map((step) => {
      const output = step.output as { ok?: boolean; summary?: string } | undefined
      return JSON.stringify({
        tool: step.tool,
        ok: step.ok,
        summary: output?.summary || step.error || null,
        durationMs: step.durationMs
      })
    })

  return {
    cleanText,
    actionLog,
    observations,
    hadActions: results.some((r) => !r.skipped),
    planSummary: formatPlanForLog(plan)
  }
}

export function getAgentAuditLog(): string { return agentAudit.export() }

export { tryHandleAppControl, parseAppActions, parseAppPlan }

export {
  isStatusOrModelsQuery,
  extractModelTagsFromObservations,
  formatHostStatusAndModelsReply,
  formatHostModelListReply,
  isHallucinatedModelList,
  buildToolObservationPrompt
} from './host-formatters'
