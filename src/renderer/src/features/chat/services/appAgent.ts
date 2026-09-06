/**
 * App self-agent: status snapshot + tool execution.
 * Pattern: status in system prompt + model emits <<<APP_ACTION>>> JSON; host executes.
 * Works with local models (no native function-calling required).
 */

import { AgentAuditLog, formatStatusForPrompt, AgentRuntime, type AppStatusSnapshot } from '@core/agent'
import { parseAppActions, type AppToolCall, type AppToolName } from '@core/agent'
import { z } from 'zod'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { APP_VERSION } from '@shared/version'
import { runSelfDiagnosis } from '@core/diagnostics/self-heal'
import { tryHandleAppControl } from './appControl'
import { useAgentApprovalStore } from '@shared/lib/stores/agentApprovalStore'
import { ModelRegistry } from '@core/models'
import { discoverLocalModels } from '@core/providers'

const agentAudit = new AgentAuditLog()
const modelRegistry = new ModelRegistry()

export async function buildAppStatusSnapshot(): Promise<AppStatusSnapshot> {
  const s = useSettingsStore.getState().settings
  const notes: string[] = []
  let localOk: boolean | null = null
  try {
    const snap = await discoverLocalModels({
      ollamaBaseUrl: s.localBaseUrl,
      openAIBaseUrl: (s.localOpenAIBaseUrl || '').trim() || undefined
    })
    localOk = Boolean(snap.ollama || snap.openAI)
    if (snap.ollama) notes.push('Ollama OK')
    if (snap.openAI) notes.push(`${snap.openAI.label} OK`)
    if (!localOk) notes.push('Sin runtime local (Ollama/LM Studio) — start_ollama o abre LM Studio Server')
  } catch {
    try {
      const st = await window.kawaii?.ollamaStatus?.(s.localBaseUrl)
      localOk = Boolean(st?.reachable)
    } catch {
      localOk = false
    }
    if (!localOk) notes.push('No se pudo consultar runtime local')
  }

  let forgeState = 'unknown'
  let forgeApi: string | null = null
  try {
    const f = await window.kawaii?.forgeStatus?.()
    forgeState = (f as { state?: string })?.state || 'unknown'
    forgeApi = (f as { baseUrl?: string })?.baseUrl || null
    if (forgeState === 'starting') {
      notes.push('Forge aún arrancando; si lleva >2 min tras Startup time, health_forge o reinicio')
    }
    if (forgeState === 'error') notes.push('Forge en error — start_forge o diagnóstico')
  } catch {
    notes.push('Estado Forge no disponible')
  }

  const cloudEnabled = (s.cloudSlots || [])
    .filter((c) => c.enabled)
    .map((c) => c.id)

  return {
    version: APP_VERSION,
    providerMode: s.providerMode || 'smart',
    localModel: s.localModel || '',
    localOk,
    cloudEnabled,
    imageGen: s.imageGenEnabled !== false,
    imageMode: s.imageProviderMode || 'smart',
    forgeState,
    forgeApi,
    characterName: s.character?.name || '',
    notes
  }
}

let statusCache: { at: number; text: string } | null = null
const STATUS_TTL_MS = 45_000

export async function buildAppAgentSystemBlock(): Promise<string> {
  const now = Date.now()
  if (statusCache && now - statusCache.at < STATUS_TTL_MS) {
    return statusCache.text
  }
  // Parallel probes (faster than sequential discover + forge)
  const snap = await buildAppStatusSnapshot()
  const text = formatStatusForPrompt(snap)
  statusCache = { at: now, text }
  return text
}

/** Force refresh on next chat turn (after tool actions that change status) */
export function invalidateAppAgentStatusCache(): void {
  statusCache = null
}


async function listOllamaModelNames(baseUrl: string): Promise<string[]> {
  try {
    const url = `${(baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')}/api/tags`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = (await res.json()) as { models?: Array<{ name?: string }> }
    return (data.models || []).map((m) => String(m.name || '')).filter(Boolean)
  } catch {
    return []
  }
}

/** Mark catalog entries installed when Ollama tags match modelRef */
async function syncInstalledFromOllama(baseUrl: string, names?: string[]): Promise<void> {
  const live = names ?? (await listOllamaModelNames(baseUrl))
  const lower = live.map((n) => n.toLowerCase())
  for (const model of modelRegistry.getCatalog().models) {
    if (model.runtime !== 'ollama') continue
    const ref = model.modelRef.toLowerCase()
    const hit = lower.some(
      (n) => n === ref || n.startsWith(ref + '-') || n.startsWith(ref.split(':')[0] + ':')
    )
    if (hit) modelRegistry.markInstalled(model.id)
  }
}

export async function executeAppTool(call: AppToolCall): Promise<{ ok: boolean; summary: string }> {
  invalidateAppAgentStatusCache()
  const s = useSettingsStore.getState()
  switch (call.tool) {
    case 'get_app_status': {
      const snap = await buildAppStatusSnapshot()
      return { ok: true, summary: formatStatusForPrompt(snap) }
    }
    case 'set_provider_mode': {
      const mode = String(call.args?.mode || '')
      if (!['local', 'cloud', 'smart'].includes(mode)) {
        return { ok: false, summary: 'mode debe ser local|cloud|smart' }
      }
      s.update({ providerMode: mode as 'local' | 'cloud' | 'smart' })
      return { ok: true, summary: `Modo de chat → ${mode}` }
    }
    case 'set_local_model': {
      const model = String(call.args?.model || '').trim()
      if (!model) return { ok: false, summary: 'Falta args.model' }
      s.update({ localModel: model })
      return { ok: true, summary: `Modelo local → ${model}` }
    }
    case 'list_models': {
      await syncInstalledFromOllama(s.settings.localBaseUrl)
      const models = modelRegistry.getCatalog().models
      const installed = new Set(modelRegistry.listInstalled().map((m) => m.id))
      return {
        ok: true,
        summary: models
          .map(
            (model) =>
              `${model.displayName} [${model.id}] ref=${model.modelRef} · ${model.capabilities.join('/')} · RAM≥${model.minRamGB}GB · ${installed.has(model.id) ? 'INSTALADO' : 'no instalado'} · ${model.license}`
          )
          .join(' | ')
      }
    }
    case 'list_installed_models': {
      try {
        let ram = 32
        try {
          const p = await window.kawaii?.machineEnsureProfile?.()
          const mem = (p as { profile?: { totalMemoryGB?: number } })?.profile?.totalMemoryGB
          if (typeof mem === 'number') ram = mem
        } catch {
          /* ignore */
        }
        const snap = await discoverLocalModels({
          ollamaBaseUrl: s.settings.localBaseUrl,
          openAIBaseUrl: (s.settings.localOpenAIBaseUrl || '').trim() || undefined,
          ramGB: ram
        })
        if (!snap.models.length) {
          return {
            ok: false,
            summary:
              'Ningún modelo local. Inicia Ollama o en LM Studio: Developer → Start Server (puerto 1234) y carga un modelo.'
          }
        }
        const parts = snap.models.map(
          (m) =>
            `${m.name} [${m.source}]${m.paramsB ? ` ~${m.paramsB}B` : ''}${
              snap.recommended?.id === m.id ? ' ★recomendado' : ''
            }`
        )
        return {
          ok: true,
          summary:
            `Runtime: ${snap.ollama ? 'Ollama ' : ''}${snap.openAI ? snap.openAI.label : ''} · ` +
            parts.slice(0, 12).join(' · ')
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'recommend_model': {
      await syncInstalledFromOllama(s.settings.localBaseUrl)
      const task = String(call.args?.task || 'chat') as
        | 'chat'
        | 'code'
        | 'vision'
        | 'tools'
        | 'summary'
      let ram = 64
      try {
        const p = await window.kawaii?.machineEnsureProfile?.()
        const mem = (p as { profile?: { totalMemoryGB?: number } })?.profile?.totalMemoryGB
        if (typeof mem === 'number' && mem > 0) ram = mem
      } catch {
        /* ignore */
      }
      const recommendations = modelRegistry.recommend(task, ram)
      return {
        ok: recommendations.length > 0,
        summary: recommendations.length
          ? recommendations
              .slice(0, 4)
              .map(
                (model) =>
                  `${model.displayName} [${model.id}] · ref ${model.modelRef} · minRAM ${model.minRamGB}GB`
              )
              .join(' · ')
          : `No hay modelos compatibles con ${task} para ~${ram}GB RAM`
      }
    }
    case 'check_local_runtime': {
      const health = await window.kawaii?.ollamaStatus?.(s.settings.localBaseUrl)
      const jobs = await window.kawaii?.ollamaListPullJobs?.()
      const jobN = jobs?.jobs?.length ?? 0
      return {
        ok: Boolean(health?.reachable),
        summary: health?.reachable
          ? `Ollama OK${jobN ? ` · ${jobN} descarga(s) en recovery` : ''}`
          : 'Ollama no disponible — usa start_ollama o instálalo'
      }
    }
    case 'set_active_model': {
      await syncInstalledFromOllama(s.settings.localBaseUrl)
      const modelId = String(call.args?.modelId || call.args?.model || '').trim()
      const model =
        modelRegistry.find(modelId) ||
        modelRegistry.getCatalog().models.find(
          (m) => m.modelRef === modelId || m.displayName === modelId
        )
      if (!model) {
        // Allow raw ollama tag if already installed
        const live = await listOllamaModelNames(s.settings.localBaseUrl)
        if (live.includes(modelId)) {
          s.update({ localModel: modelId })
          return { ok: true, summary: `Modelo activo → ${modelId} (tag Ollama)` }
        }
        return { ok: false, summary: 'Modelo desconocido. Usa list_models o list_installed_models.' }
      }
      if (!model.capabilities.includes('chat')) {
        return { ok: false, summary: 'El modelo no tiene capacidad chat' }
      }
      modelRegistry.setActive('chat', model.id)
      s.update({ localModel: model.modelRef })
      const installed = modelRegistry.listInstalled().some((m) => m.id === model.id)
      return {
        ok: true,
        summary: installed
          ? `Modelo activo → ${model.displayName} (${model.modelRef})`
          : `Modelo activo → ${model.displayName}, pero NO está instalado. Usa download_model modelId=${model.id}`
      }
    }
    case 'download_model': {
      const raw = String(call.args?.modelId || call.args?.model || '').trim()
      if (!raw) return { ok: false, summary: 'Falta args.modelId o args.model' }
      const model =
        modelRegistry.find(raw) ||
        modelRegistry.getCatalog().models.find((m) => m.modelRef === raw)
      const ref = model?.modelRef || raw
      if (model && model.runtime !== 'ollama') {
        return { ok: false, summary: `Runtime ${model.runtime} aún no soporta descarga desde el agente` }
      }
      try {
        // Fire-and-forget pull; progress goes to DownloadBar via IPC
        const pullPromise = window.kawaii?.ollamaPull?.(ref, s.settings.localBaseUrl)
        // Don't block agent forever on multi-GB pulls
        void pullPromise?.then((r) => {
          if (r && (r as { ok?: boolean }).ok && model) modelRegistry.markInstalled(model.id)
        })
        return {
          ok: true,
          summary: `Descarga iniciada: ${ref}${model ? ` [${model.id}] · licencia ${model.license} · minRAM ${model.minRamGB}GB` : ''}. Progreso en la barra de descargas. pause/cancel_download model=${ref}`
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'pause_download':
    case 'cancel_download': {
      const model = String(call.args?.model || call.args?.modelId || '').trim()
      try {
        await window.kawaii?.ollamaPullCancel?.(model || undefined)
        return {
          ok: true,
          summary: model
            ? `Descarga cancelada/pausada: ${model}. resume_download model=${model} reanuda el pull de Ollama.`
            : 'Todas las descargas Ollama canceladas'
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'resume_download': {
      const raw = String(call.args?.model || call.args?.modelId || '').trim()
      if (!raw) return { ok: false, summary: 'Falta args.model' }
      const model =
        modelRegistry.find(raw) ||
        modelRegistry.getCatalog().models.find((m) => m.modelRef === raw)
      const ref = model?.modelRef || raw
      try {
        void window.kawaii?.ollamaPull?.(ref, s.settings.localBaseUrl)
        return { ok: true, summary: `Reanudando pull Ollama: ${ref}` }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'delete_model': {
      const raw = String(call.args?.modelId || call.args?.model || '').trim()
      if (!raw) return { ok: false, summary: 'Falta args.modelId o args.model' }
      const model =
        modelRegistry.find(raw) ||
        modelRegistry.getCatalog().models.find((m) => m.modelRef === raw)
      const ref = model?.modelRef || raw
      try {
        const r = await window.kawaii?.ollamaDelete?.(ref, s.settings.localBaseUrl)
        if (model) modelRegistry.markUninstalled(model.id)
        const ok = Boolean((r as { ok?: boolean })?.ok !== false)
        return {
          ok,
          summary: ok ? `Modelo eliminado: ${ref}` : `No se pudo eliminar ${ref}: ${JSON.stringify(r).slice(0, 120)}`
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'list_download_jobs': {
      try {
        const r = await window.kawaii?.ollamaListPullJobs?.()
        const jobs = r?.jobs || []
        if (!jobs.length) return { ok: true, summary: 'No hay descargas Ollama pendientes' }
        return {
          ok: true,
          summary: jobs
            .map(
              (j) =>
                `${j.model}: ${j.status}${typeof j.progress === 'number' ? ` ${Math.round(j.progress)}%` : ''}${j.error ? ` · ${j.error}` : ''}`
            )
            .join(' · ')
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'set_image_mode': {
      const mode = String(call.args?.mode || '')
      if (!['off', 'local', 'cloud', 'smart'].includes(mode)) {
        return { ok: false, summary: 'mode=off|local|cloud|smart' }
      }
      s.update({
        imageProviderMode: mode as 'off' | 'local' | 'cloud' | 'smart',
        imageGenEnabled: mode !== 'off'
      })
      return { ok: true, summary: `Imágenes → ${mode}` }
    }
    case 'set_ui_mode': {
      const mode = String(call.args?.mode || '')
      if (!['smart', 'advanced'].includes(mode)) {
        return { ok: false, summary: 'mode=smart|advanced' }
      }
      s.update({ uiComplexity: mode as 'smart' | 'advanced' })
      return { ok: true, summary: `UI → ${mode}` }
    }
    case 'start_forge': {
      try {
        await window.kawaii?.forgeStart?.()
        return { ok: true, summary: 'Arranque de Forge solicitado' }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'stop_forge': {
      try {
        await window.kawaii?.forgeStop?.()
        return { ok: true, summary: 'Forge detenido' }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'health_forge': {
      try {
        const h = await window.kawaii?.forgeRefreshHealth?.() || await window.kawaii?.imageA1111Health?.()
        return { ok: true, summary: JSON.stringify(h).slice(0, 300) }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'start_ollama': {
      try {
        const r = await window.kawaii?.ollamaStart?.(s.settings.localBaseUrl)
        return { ok: Boolean((r as { ok?: boolean })?.ok !== false), summary: JSON.stringify(r).slice(0, 200) }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'run_diagnosis': {
      try {
        const live = s.settings
        const report = await runSelfDiagnosis({
          localBaseUrl: live.localBaseUrl,
          localModel: live.localModel,
          cloudBaseUrl: live.cloudBaseUrl,
          hasCloudKey: false,
          providerMode: live.providerMode,
          ollamaStart: async () => {
            const result = await window.kawaii?.ollamaStart?.(live.localBaseUrl)
            return { ok: Boolean(result?.ok), message: result?.message || 'Ollama solicitado' }
          },
          imageGenEnabled: live.imageGenEnabled,
          imageProviderMode: live.imageProviderMode,
          a1111BaseUrl: live.a1111BaseUrl,
          cloudflareAccountId: live.cloudflareAccountId,
          cloudflareProbe: async (id: string) =>
            (await window.kawaii?.imageCloudflareProbe?.(id)) ?? { ok: false, error: 'n/a' },
          imageA1111Health: async (url?: string) =>
            (await window.kawaii?.imageA1111Health?.(url)) ?? { ok: false, error: 'n/a' }
        })
        return {
          ok: Boolean(report?.healthy),
          summary: (report?.checks || [])
            .map((c) => `${c.status}: ${c.label}`)
            .slice(0, 8)
            .join(' · ') || 'Diagnóstico listo'
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'open_settings_hint':
      return { ok: true, summary: 'Abre Ajustes (icono engranaje) para cambios manuales.' }
    default:
      return { ok: false, summary: `Herramienta desconocida: ${call.tool}` }
  }
}

export async function runActionsFromAssistantText(text: string): Promise<{
  cleanText: string
  actionLog: string[]
  /** Structured observations for a follow-up model turn */
  observations: string[]
  hadActions: boolean
}> {
  const { cleanText, actions } = parseAppActions(text)
  const actionLog: string[] = []
  const runtime = new AgentRuntime({
    maxSteps: 4,
    timeoutMs: 30_000,
    approve: async (tool) => {
      if (tool.risk === 'read' || tool.risk === 'reversible') return true
      const reasons: Record<string, string> = {
        start_forge: 'iniciará Forge (RAM/VRAM/disco)',
        start_ollama: 'iniciará Ollama (memoria/CPU)',
        download_model: 'descargará un modelo (puede ser varios GB de disco y red)',
        resume_download: 'reanudará una descarga de modelo',
        delete_model: 'ELIMINARÁ un modelo del disco de forma permanente'
      }
      return useAgentApprovalStore.getState().request(
        tool.name,
        reasons[tool.name] || `acción sensible: ${tool.name}`
      )
    }
  })
  const toolNames: AppToolName[] = [
    'get_app_status',
    'set_provider_mode',
    'set_local_model',
    'set_image_mode',
    'set_ui_mode',
    'start_forge',
    'stop_forge',
    'health_forge',
    'start_ollama',
    'run_diagnosis',
    'open_settings_hint',
    'list_models',
    'list_installed_models',
    'recommend_model',
    'check_local_runtime',
    'set_active_model',
    'download_model',
    'pause_download',
    'resume_download',
    'cancel_download',
    'delete_model',
    'list_download_jobs'
  ]
  for (const tool of toolNames) {
    runtime.register({
      name: tool,
      description: `KawaiiGPT action: ${tool}`,
      risk:
        tool === 'get_app_status' ||
        tool === 'health_forge' ||
        tool === 'list_models' ||
        tool === 'list_installed_models' ||
        tool === 'recommend_model' ||
        tool === 'check_local_runtime' ||
        tool === 'list_download_jobs'
          ? 'read'
          : tool === 'start_forge' ||
              tool === 'start_ollama' ||
              tool === 'download_model' ||
              tool === 'resume_download'
            ? 'resource'
            : tool === 'delete_model'
              ? 'destructive'
              : 'reversible',
      input: z.record(z.unknown()),
      execute: async (args) => executeAppTool({ tool, args: args as AppToolCall['args'] })
    })
  }
  const uniqueActions = actions.filter(
    (action, index, all) => all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(action)) === index
  )
  if (!uniqueActions.length) {
    return { cleanText, actionLog: [], observations: [], hadActions: false }
  }
  const result = await runtime.run(uniqueActions.map((action) => ({ tool: action.tool, input: action.args })))
  for (const step of result.steps) {
    agentAudit.record(step, step.error !== 'resource_action_requires_approval' && step.error !== 'destructive_action_requires_approval')
    const output = step.output as { ok?: boolean; summary?: string } | undefined
    actionLog.push(`${step.ok ? '✓' : '✗'} ${step.tool}: ${output?.summary || step.error || 'sin resultado'}`)
  }
  if (result.stoppedReason === 'max_steps') {
    actionLog.push('✗ agente: límite de 4 acciones por turno alcanzado')
  }
  const observations = result.steps.map((step) => {
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
    hadActions: uniqueActions.length > 0
  }
}

/**
 * Build a compact follow-up user message so the model can react to tool results
 * (second micro-turn — Phase A of the continuation plan).
 */
export function buildToolObservationPrompt(observations: string[], userGoal: string): string {
  if (!observations.length) return ''
  return [
    '[Resultados de herramientas de la app — úsalos para responder al usuario]',
    ...observations.map((o, i) => `${i + 1}. ${o}`),
    '',
    `Pedido original del usuario: ${userGoal.slice(0, 400)}`,
    'Responde en lenguaje natural (sin etiquetas APP_ACTION salvo que haga falta otra acción concreta).',
    'Si algo falló, explica el siguiente paso práctico.'
  ].join('\n')
}

export function getAgentAuditLog(): string { return agentAudit.export() }

export { tryHandleAppControl, parseAppActions }
