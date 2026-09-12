/**
 * App self-agent: status snapshot + tool execution.
 * Pattern: status in system prompt + model emits <<<APP_ACTION>>> JSON; host executes.
 * Works with local models (no native function-calling required).
 */

import {
  AgentAuditLog,
  formatStatusForPrompt,
  AgentRuntime,
  parseAppActions,
  parseAppPlan,
  planFromActions,
  suggestPlanFromUserGoal,
  executePlan,
  refinePlanWithLiveStatus,
  formatPlanForLog,
  type AppStatusSnapshot,
  type AppToolCall,
  type AppToolName,
  type AgentPlan,
  recordToolFailure,
  recordToolSuccess,
  shouldSkipTool,
  formatFailureMemoryForPrompt,
  formatSuccessMemoryForPrompt,
  recordPreferredLocalModel,
  recordHarnessSuccess,
  pruneAppDiagnostics,
  listAppDataKeys,
  clearAllKawaiiLocalData
} from '@core/agent'
import { z } from 'zod'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { APP_VERSION } from '@shared/version'
import { runSelfDiagnosis } from '@core/diagnostics/self-heal'
import { tryHandleAppControl } from './appControl'
import { useAgentApprovalStore } from '@shared/lib/stores/agentApprovalStore'
import { ModelRegistry } from '@core/models'
import { discoverLocalModels } from '@core/providers'
import {
  classifyChatTask,
  pickBestInstalledForTask,
  type ChatTask
} from '@core/routing'

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

  let musicRunning = false
  let musicDetail = ''
  try {
    const ms = await window.kawaii?.musicStatus?.()
    musicRunning =
      Boolean((ms as { running?: boolean })?.running) ||
      String((ms as { state?: string })?.state || '') === 'running'
    musicDetail = String((ms as { detail?: string; message?: string })?.detail || (ms as { message?: string })?.message || '')
    if (!musicRunning) notes.push('Música (ACE): detenida / on-demand')
    else notes.push('Música (ACE): en marcha')
  } catch {
    notes.push('Música: estado no disponible')
  }

  let voiceReady: boolean | null = null
  try {
    const vs = await window.kawaii?.voiceStatus?.()
    voiceReady = Boolean((vs as { ready?: boolean; ok?: boolean })?.ready ?? (vs as { ok?: boolean })?.ok)
    notes.push(voiceReady ? 'Voz TTS: lista' : 'Voz TTS: no lista / no instalada')
  } catch {
    notes.push('Voz TTS: sin datos')
  }

  // Honest layer summary for the model (never "todo OK" if something is down)
  const layerLines = [
    `Chat local: ${localOk ? 'OK' : 'CAÍDO'} (modelo activo: ${s.localModel || 'ninguno'})`,
    `Forge/imagen: ${forgeState}${forgeApi ? ' @ ' + forgeApi : ''}`,
    `Música: ${musicRunning ? 'running' : 'stopped'}`,
    `Voz: ${voiceReady === true ? 'ready' : voiceReady === false ? 'not ready' : 'unknown'}`,
    `Cloud keys configuradas: ${(cloudEnabled || []).join(', ') || 'ninguna'} (NO son modelos locales instalados)`
  ]

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
    musicRunning,
    voiceReady,
    characterName: s.character?.name || '',
    notes,
    layers: layerLines
  }
}

let statusCache: { at: number; text: string } | null = null
const STATUS_TTL_MS = 45_000

const HARNESS_TOOL_PROTOCOL = `
[HARNESS — control multi-paso de la app]
Eres el asistente de KawaiiGPT con herramientas REALES. No inventes estados.

Cuando necesites VARIOS pasos (diagnóstico + arranque + verificación), emite un PLAN:
<<<APP_PLAN>>>
{"goal":"descripción corta","steps":[
  {"tool":"get_app_status","onFail":"continue"},
  {"tool":"health_forge","onFail":"continue"},
  {"tool":"start_forge","onFail":"stop","why":"capa imagen"},
  {"tool":"health_forge","onFail":"continue"}
]}
<<<END_APP_PLAN>>>

onFail: "continue" | "stop" | "skip_rest"
Máximo 8 pasos. El host ejecuta en orden y te devuelve resultados.

Una sola acción:
<<<APP_ACTION>>>
{"tool":"NOMBRE","args":{}}
<<<END_APP_ACTION>>>

Lectura: get_app_status, health_forge, check_local_runtime, list_installed_models, list_models, recommend_model, auto_route_model, list_download_jobs, run_diagnosis
Acción: start_forge, stop_forge, start_music, stop_music, start_ollama, voice_ensure, set_provider_mode, set_local_model, set_image_mode, set_ui_mode, download_model, resume_download, pause_download, cancel_download, delete_model, open_settings_hint, clear_app_logs, list_app_logs, rename_conversation

Política:
1) Imagen local sin Forge → plan health_forge → start_forge → health_forge. El host REESCRIBE el plan si Forge ya está running (no vuelve a start_forge).
2) Música → start_music
3) Local caído → check_local_runtime → start_ollama → list_installed_models
4) Si el usuario pide código/visión/resumen, puedes usar auto_route_model o dejar que el host rote el modelo local.
5) Charla normal → sin APP_PLAN ni APP_ACTION
5) No inventes archivos ni éxitos sin resultado del host
`.trim()


/**
 * Harness step 1: auto-select local model by task (chat/code/vision/summary).
 * Safe no-op if routing disabled, cloud-only mode, or no better installed model.
 */
export async function applyAutoModelRouting(
  userText: string,
  opts?: { hasImageAttachment?: boolean; forceTask?: ChatTask }
): Promise<{
  applied: boolean
  task: ChatTask
  from: string
  to: string
  reason: string
}> {
  const store = useSettingsStore.getState()
  const s = store.settings
  if (s.autoModelRouting === false) {
    return {
      applied: false,
      task: 'chat',
      from: s.localModel || '',
      to: s.localModel || '',
      reason: 'autoModelRouting desactivado'
    }
  }
  if (s.providerMode === 'cloud') {
    return {
      applied: false,
      task: 'chat',
      from: s.localModel || '',
      to: s.localModel || '',
      reason: 'modo solo cloud'
    }
  }

  const task =
    opts?.forceTask ||
    classifyChatTask(userText, { hasImageAttachment: opts?.hasImageAttachment })

  let ram = 16
  try {
    const p = await window.kawaii?.machineEnsureProfile?.()
    const mem = (p as { profile?: { totalMemoryGB?: number } })?.profile?.totalMemoryGB
    if (typeof mem === 'number' && mem > 0) ram = mem
  } catch {
    /* ignore */
  }

  let installed: string[] = []
  try {
    const snap = await discoverLocalModels({
      ollamaBaseUrl: s.localBaseUrl,
      openAIBaseUrl: (s.localOpenAIBaseUrl || '').trim() || undefined,
      ramGB: ram
    })
    installed = snap.models.map((m) => m.id || m.name).filter(Boolean)
  } catch {
    installed = await listOllamaModelNames(s.localBaseUrl)
  }

  if (!installed.length) {
    return {
      applied: false,
      task,
      from: s.localModel || '',
      to: s.localModel || '',
      reason: 'sin modelos locales detectados'
    }
  }

  const pick = pickBestInstalledForTask({
    installed,
    task,
    current: s.localModel,
    ramGB: ram,
    minDelta: task === 'vision' || task === 'code' ? 2 : 3
  })

  if (!pick.applied) {
    return {
      applied: false,
      task,
      from: pick.from,
      to: pick.to,
      reason: pick.reason
    }
  }

  store.update({ localModel: pick.to })
  try { recordPreferredLocalModel(pick.to) } catch { /* ignore */ }
  invalidateAppAgentStatusCache()
  return {
    applied: true,
    task,
    from: pick.from,
    to: pick.to,
    reason: pick.reason
  }
}


export async function buildAppAgentSystemBlock(): Promise<string> {
  const now = Date.now()
  if (statusCache && now - statusCache.at < STATUS_TTL_MS) {
    return statusCache.text
  }
  const snap = await buildAppStatusSnapshot()
  const status = formatStatusForPrompt(snap)
  const failMem = formatFailureMemoryForPrompt()
  const successMem = formatSuccessMemoryForPrompt()
  const text =
    HARNESS_TOOL_PROTOCOL +
    '\n\n[ESTADO_APP ahora]\n' +
    status +
    (failMem ? '\n\n' + failMem : '') +
    (successMem ? '\n\n' + successMem : '') +
    '\nUsa este estado como verdad; si está desactualizado, llama get_app_status. ' +
    'Si una acción falló hace poco, no la repitas igual: diagnostica o explica el límite. ' +
    'La memoria de éxitos es solo un sesgo suave (p. ej. modelo local preferido).'
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


/**
 * Deterministic path: always run tools and format the reply in host code.
 * Best practice: LLM does not invent inventory; harness owns facts.
 */
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
  const tags = extractModelTagsFromObservations(observations)
  const content = formatHostStatusAndModelsReply(observations, tags)
  try {
    recordHarnessSuccess('status_report', `${tags.length} models`)
    const active = useSettingsStore.getState().settings.localModel
    if (active) recordPreferredLocalModel(active)
  } catch {
    /* ignore */
  }
  return { content, observations, tags, actionLog }
}


export function isStatusOrModelsQuery(text: string): boolean {
  const t = (text || '').toLowerCase()
  return (
    /\b(estado de la app|estado de la aplicaci|status de la app|diagn[oó]stic)\b/.test(t) ||
    (/\b(estado|status|capas)\b/.test(t) && /\b(app|aplicaci|forge|ollama)\b/.test(t)) ||
    /\b(lista|listar|pasame|p[aá]same|dame)\b.*\bmodelos\b/.test(t) ||
    /\bmodelos\b.*\b(lista|listar|instalados|disponibles|completos?|tenemos|hay)\b/.test(t) ||
    (/\brevisa\b/.test(t) && /\b(estado|modelos|forge|app)\b/.test(t))
  )
}

export async function executeAppTool(call: AppToolCall): Promise<{ ok: boolean; summary: string }> {
  invalidateAppAgentStatusCache()
  const s = useSettingsStore.getState()
  switch (call.tool) {
    case 'get_app_status': {
      const snap = await buildAppStatusSnapshot()
      invalidateAppAgentStatusCache()
      const layerTxt = Array.isArray((snap as { layers?: string[] }).layers)
        ? (snap as { layers: string[] }).layers.join(' | ')
        : formatStatusForPrompt(snap)
      const summary =
        layerTxt +
        (snap.notes?.length ? ' || notas: ' + snap.notes.slice(0, 6).join(' · ') : '')
      statusCache = { at: Date.now(), text: summary }
      return { ok: true, summary }
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
        const parts = snap.models.map((m) => {
          const role =
            /moondream|llava|vision|bakllava|minicpm-v/i.test(m.name)
              ? 'visión'
              : /coder|code|deepseek-coder/i.test(m.name)
                ? 'código'
                : 'chat'
          return `${m.name} (${role}${m.source ? `, ${m.source}` : ''}${
            snap.recommended?.id === m.id ? ', ★recomendado' : ''
          })`
        })
        return {
          ok: true,
          summary:
            `Runtime: ${snap.ollama ? 'Ollama' : ''}${snap.openAI ? (snap.ollama ? ' + ' : '') + snap.openAI.label : ''} | Modelos: ` +
            parts.slice(0, 14).join(' · ')
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'auto_route_model': {
      const taskArg = call.args?.task ? String(call.args.task) : undefined
      const text = String(call.args?.text || call.args?.goal || 'chat')
      const r = await applyAutoModelRouting(text, {
        forceTask: taskArg as ChatTask | undefined,
        hasImageAttachment: Boolean(call.args?.hasImage)
      })
      return {
        ok: true,
        summary: r.applied
          ? `Routing: ${r.from} → ${r.to} (${r.task}) · ${r.reason}`
          : `Sin cambio: ${r.reason}`
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
    case 'start_music': {
      try {
        const r = await window.kawaii?.musicEnsureReady?.()
        const ok = Boolean((r as { ok?: boolean })?.ok !== false)
        return {
          ok,
          summary: ok
            ? `Música lista: ${JSON.stringify(r).slice(0, 180)}`
            : `Música no lista: ${JSON.stringify(r).slice(0, 180)}`
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'stop_music': {
      try {
        const r = await window.kawaii?.musicStop?.()
        return { ok: true, summary: `Música detenida ${JSON.stringify(r).slice(0, 120)}` }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'voice_ensure': {
      try {
        const r = await window.kawaii?.voiceEnsure?.()
        return {
          ok: Boolean((r as { ok?: boolean })?.ok),
          summary: JSON.stringify(r).slice(0, 200)
        }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    case 'open_settings_hint':
      return { ok: true, summary: 'Abre Ajustes (icono engranaje) para cambios manuales.' }
    case 'list_app_logs': {
      const keys = listAppDataKeys()
      return {
        ok: true,
        summary: keys.length ? `Claves locales: ${keys.join(', ')}` : 'Sin datos kawaii-gpt en localStorage'
      }
    }
    case 'clear_app_logs': {
      const mode = String(call.args?.mode || 'soft').toLowerCase()
      if (mode === 'all') {
        const r = clearAllKawaiiLocalData()
        return { ok: r.ok, summary: `Limpieza total: ${r.detail} · ${r.cleared.join(', ')}` }
      }
      const r = pruneAppDiagnostics({
        clearFailures: true,
        clearSuccess: mode === 'success' || mode === 'soft',
        clearFeedbackActive: mode === 'feedback' || mode === 'hard',
        clearFeedbackArchives: mode === 'feedback' || mode === 'hard',
        clearTestHistory: mode === 'tests' || mode === 'hard' || mode === 'soft'
      })
      return {
        ok: r.ok,
        summary: `Limpieza (${mode}): ${r.detail}. Borrado: ${r.cleared.join(', ') || 'nada'}`
      }
    }
    case 'rename_conversation': {
      let title = String(call.args?.title || call.args?.name || '').trim()
      title = title
        .replace(/^(?:este\s+)?(?:chat|conversaci[oó]n)\s+a\s+/i, '')
        .replace(/^renombra(?:r)?\s+/i, '')
        .replace(/^[«"']|[»"']$/g, '')
        .trim()
        .slice(0, 60)
      if (!title) return { ok: false, summary: 'Falta args.title' }
      try {
        const { useChatStore } = await import('@shared/lib/stores/chatStore')
        const store = useChatStore.getState()
        const id = store.activeId
        if (!id) return { ok: false, summary: 'No hay chat activo' }
        store.rename(id, title)
        return { ok: true, summary: `Chat renombrado → «${title}»` }
      } catch (e) {
        return { ok: false, summary: String(e) }
      }
    }
    default:
      return { ok: false, summary: `Herramienta desconocida: ${call.tool}` }
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

/**
 * Build a compact follow-up user message so the model can react to tool results
 * (second micro-turn — Phase A of the continuation plan).
 */

/** Extract local model tags from harness observation strings (never cloud provider ids). */
export function extractModelTagsFromObservations(observations: string[]): string[] {
  const tags: string[] = []
  const skip =
    /^(runtime|ollama|openai|studio|compatible|recomendado|forge|ok|error|http|local|cloud|true|false|label|source|models?|modelos|installed|groq|gemini|openrouter|openai|cloudflare|main|music|voz|tts|ace|chat|vision|codigo|código|tool|summary)$/i

  const push = (id: string) => {
    const clean = id.split('[')[0].trim()
    if (!clean || clean.length < 3 || clean.length > 96) return
    if (!/^[a-zA-Z0-9][\w./:@-]+$/.test(clean)) return
    if (skip.test(clean)) return
    if (/^(groq|gemini|openrouter|openai|cloudflare)$/i.test(clean)) return
    if (!tags.includes(clean)) tags.push(clean)
  }

  for (const o of observations) {
    // Prefer explicit "Modelos:" segment from list_installed_models
    const m = o.match(/Modelos:\s*([^"]+)/i)
    const segment = m ? m[1] : o
    for (const part of segment.split(/[·|,;]/)) {
      let p = part.trim().replace(/^["']|["']$/g, '')
      p = p.replace(/\s*[\(（].*$/, '').replace(/\s*★.*$/, '').trim()
      push(p)
    }
  }
  return tags.slice(0, 20)
}

/** Deterministic reply for status + model list — avoids LLM formatting failures. */
export function formatHostStatusAndModelsReply(
  observations: string[],
  tags: string[]
): string {
  const joined = observations.join('\n')

  const layer = (patterns: RegExp[], okLabel: string, badLabel: string, unknown = 'sin datos'): string => {
    for (const re of patterns) {
      if (re.test(joined)) {
        const m = joined.match(re)
        return m && m[1] ? m[1].trim() : okLabel
      }
    }
    // negative
    return unknown
  }

  let chat = 'sin datos'
  if (/Chat local:\s*([^|"\\]+)/i.test(joined)) {
    chat = joined.match(/Chat local:\s*([^|"\\]+)/i)![1].trim()
  } else if (/localOk["\s:=]*true|Ollama OK|Runtime:.*Ollama/i.test(joined)) {
    chat = 'OK (Ollama/LM detectado)'
  } else if (/localOk["\s:=]*false|Sin runtime|CA[IÍ]DO/i.test(joined)) {
    chat = 'no disponible'
  }

  let forge = 'sin datos (on-demand)'
  if (/Forge\/imagen:\s*([^|"\\]+)/i.test(joined)) {
    forge = joined.match(/Forge\/imagen:\s*([^|"\\]+)/i)![1].trim()
  } else if (/forge["\s:=]*(running|ready)/i.test(joined) || /"ok":\s*true.*"health_forge"/i.test(joined)) {
    forge = 'running'
  } else if (/forge["\s:=]*(stopped|error)/i.test(joined) || /health_forge.*"ok":\s*false/i.test(joined)) {
    const m = joined.match(/forge["\s:=]*(\w+)/i)
    forge = m ? m[1] : 'stopped/error'
  }

  let music = 'detenida / on-demand'
  if (/Música:\s*([^|"\\]+)/i.test(joined)) {
    music = joined.match(/Música:\s*([^|"\\]+)/i)![1].trim()
  } else if (/Música \(ACE\): en marcha|musicRunning["\s:=]*true/i.test(joined)) {
    music = 'en marcha'
  }

  let voice = 'sin datos'
  if (/Voz:\s*([^|"\\]+)/i.test(joined)) {
    voice = joined.match(/Voz:\s*([^|"\\]+)/i)![1].trim()
  } else if (/Voz TTS: lista|voiceReady["\s:=]*true/i.test(joined)) {
    voice = 'lista'
  } else if (/Voz TTS: no lista|voiceReady["\s:=]*false/i.test(joined)) {
    voice = 'no lista'
  }

  let active = ''
  const am = joined.match(/localModel["\s:=]+([^|"\\}\s,]+)/i) || joined.match(/modelo activo:\s*([^|)]+)/i)
  if (am) active = am[1].replace(/["']/g, '').trim()

  const lines: string[] = [
    'Revisé la app con datos reales (no inventados):',
    '',
    '**Capas**',
    `- **Chat local:** ${chat}${active ? ` · activo: \`${active}\`` : ''}`,
    `- **Forge / imagen:** ${forge}`,
    `- **Música (ACE):** ${music}`,
    `- **Voz TTS:** ${voice}`,
    '',
    '**Modelos locales en disco**'
  ]

  if (!tags.length) {
    lines.push('- Ninguno detectado ahora. Abre Ollama o LM Studio (Server :1234) y vuelve a preguntar.')
  } else {
    for (const id of tags) {
      const role = /moondream|llava|vision|bakllava|minicpm-v/i.test(id)
        ? 'visión'
        : /coder|code|deepseek-coder/i.test(id)
          ? 'código'
          : 'chat'
      const star = active && (id === active || id.startsWith(active) || active.startsWith(id.split(':')[0]))
        ? ' ← en uso'
        : ''
      lines.push(`- **${id}** — ${role}${star}`)
    }
  }

  lines.push('')
  lines.push(
    '_Groq / Gemini / OpenRouter son proveedores cloud (API keys), no modelos instalados en tu PC._'
  )
  return lines.join('\n')
}

export function formatHostModelListReply(tags: string[], characterName?: string): string {
  const name = characterName || ''
  if (!tags.length) {
    return (
      'Ahora mismo no veo modelos locales cargados. ' +
      'Prueba a arrancar Ollama o LM Studio (Server en 1234) y vuelve a pedirme la lista.'
    )
  }
  const lines = tags.map((id) => {
    const role = /moondream|llava|vision|bakllava|minicpm-v/i.test(id)
      ? 'vision'
      : /coder|code|deepseek-coder/i.test(id)
        ? 'codigo'
        : 'chat'
    return `- **${id}** — ${role}`
  })
  return (
    'Estos son los **modelos locales** que tengo detectados ahora mismo ' +
    '(no confundir con proveedores cloud como Groq/Gemini):\n\n' +
    lines.join('\n') +
    '\n\nSi quieres, cambio el activo o te recomiendo uno segun la tarea.'
  )
}

export function isHallucinatedModelList(text: string): boolean {
  const t = text || ''
  if (/Nombre del modelo\s*\d/i.test(t)) return true
  if (/\bModelo\s*[ABC]\b/i.test(t)) return true
  if (/<<<APP_/i.test(t)) return true
  // provider listed as if it were an installed local model
  if (/^\s*[-*]\s*\*\*?groq\b/im.test(t) || /^\s*[-*]\s*\*\*?gemini\b/im.test(t)) return true
  return false
}

export function buildToolObservationPrompt(
  observations: string[],
  userGoal: string,
  planSummary?: string
): string {
  if (!observations.length) return ''
  const asksModels =
    /\b(lista|listar|modelos|qué modelos|que modelos|instalados|disponibles)\b/i.test(
      userGoal
    )
  // Pull ollama-style tags from tool summaries (e.g. "qwen2.5:14b [ollama] · moondream:latest")
  const tags: string[] = []
  const skip = /^(runtime|ollama|openai|studio|compatible|recomendado|forge|ok|error|http|local|cloud|true|false|label|source|models?|installed)$/i
  for (const o of observations) {
    for (const part of o.split(/[·|,;]/)) {
      let p = part.trim()
      if (!p) continue
      // strip JSON wrappers / trailing annotations
      p = p.replace(/^["']|["']$/g, '')
      p = p.replace(/\s*[\(（].*$/, '') // role notes
      p = p.replace(/\s*★.*$/, '').replace(/\s*~\d+(\.\d+)?B$/, '').trim()
      const id = p.split('[')[0].trim()
      if (!id || id.length < 3 || id.length > 96) continue
      if (!/^[a-zA-Z0-9][\w./:@-]+$/.test(id)) continue
      if (skip.test(id)) continue
      if (!tags.includes(id)) tags.push(id)
    }
  }
  const facts =
    tags.length > 0
      ? [
          'DATOS REALES — únicos nombres de modelo válidos (cópialos; no inventes otros):',
          ...tags.slice(0, 16).map((id) => `- ${id}`)
        ]
      : [
          'DATOS REALES del harness (si no hay nombres, sé honesta: no inventes lista):',
          ...observations.map((o) => `- ${o.slice(0, 280)}`)
        ]

  return [
    '[Harness — resultados de herramientas. El usuario NO ve este bloque.]',
    planSummary ? `Plan: ${planSummary}` : '',
    ...facts,
    '',
    `Pedido del usuario: ${userGoal.slice(0, 400)}`,
    'Responde en personaje, natural y breve.',
    asksModels
      ? 'Si pidió lista de modelos: una viñeta por cada nombre de DATOS REALES (locales). Nota corta (chat / visión / código). PROHIBIDO: "Modelo A/B/C", "Nombre del modelo N", y PROHIBIDO listar groq/gemini/openrouter como si fueran modelos instalados en disco.'
      : 'Resume el estado por CAPAS (chat local, Forge, música, voz, cloud keys) usando SOLO los DATOS REALES. Di qué está running y qué está stopped. Nunca digas "todo en orden" si alguna capa está caída o unknown.',
    'Prohibido: inventar modelos, volcar JSON, etiquetas APP_*, "plan[actions]", códigos crudos.',
    'Cloud keys ≠ modelos locales. Sé precisa y honesta.'
  ]
    .filter(Boolean)
    .join('\n')
}

export function getAgentAuditLog(): string { return agentAudit.export() }

export { tryHandleAppControl, parseAppActions }
