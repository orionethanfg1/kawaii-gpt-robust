/**
 * M2 — shared host agent state: status snapshot, model registry, routing helpers.
 */
import {
  formatStatusForPrompt,
  type AppStatusSnapshot,
  formatFailureMemoryForPrompt,
  formatSuccessMemoryForPrompt,
  recordPreferredLocalModel
} from '@core/agent'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { APP_VERSION } from '@shared/version'
import { ModelRegistry } from '@core/models'
import { discoverLocalModelsFull } from '@core/providers'
import {
  decideAutoRoute,
  applyStickyFromDecision,
  type ChatTask
} from '@core/routing'

export const modelRegistry = new ModelRegistry()

export async function buildAppStatusSnapshot(): Promise<AppStatusSnapshot> {
  const s = useSettingsStore.getState().settings
  const notes: string[] = []
  let localOk: boolean | null = null
  try {
    const snap = await discoverLocalModelsFull({
      ollamaBaseUrl: s.localBaseUrl,
      openAIBaseUrl: (s.localOpenAIBaseUrl || '').trim() || undefined
    })
    localOk = Boolean(snap.ollama || snap.openAI || (snap.models?.length ?? 0) > 0)
    if (snap.ollama) notes.push('Ollama OK')
    if (snap.openAI) notes.push(`${snap.openAI.label} OK`)
    if (snap.diskCount) notes.push(`${snap.diskCount} modelo(s) en disco (servidor puede estar parado)`)
    if (!snap.ollama && !snap.openAI) {
      notes.push(
        snap.models?.length
          ? 'Runtime parado — hay modelos en disco; start_ollama o abre LM Studio Server'
          : 'Sin runtime local (Ollama/LM Studio) — start_ollama o abre LM Studio Server'
      )
    }
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

  // Resource ledger (host facts for governor-aware plans)
  let ramGB = 16
  let vramGB: number | null = null
  let hasDiscreteGpu: boolean | null = null
  try {
    const p = await window.kawaii?.machineEnsureProfile?.()
    const prof = (p as { profile?: { totalMemoryGB?: number; vramGB?: number | null; hasDiscreteGpu?: boolean | null } })
      ?.profile
    if (typeof prof?.totalMemoryGB === 'number' && prof.totalMemoryGB > 0) ramGB = prof.totalMemoryGB
    if (typeof prof?.vramGB === 'number') vramGB = prof.vramGB
    if (typeof prof?.hasDiscreteGpu === 'boolean') hasDiscreteGpu = prof.hasDiscreteGpu
  } catch {
    /* ignore */
  }

  let resourceLine = ''
  try {
    const { buildLedger, formatLedgerForPrompt, canAdmit, LAYER_DEFAULT_ESTIMATE_GB } =
      await import('@core/resources')
    const ledger = buildLedger({
      ramGB,
      vramGB,
      hasDiscreteGpu,
      forgeState,
      musicRunning,
      localModel: s.localModel
    })
    resourceLine = formatLedgerForPrompt(ledger)
    const forgeAdmit = canAdmit(ledger, {
      layer: 'forge',
      estimateGB: LAYER_DEFAULT_ESTIMATE_GB.forge
    })
    if (!forgeAdmit.ok) notes.push(`Governor: Forge justo — ${forgeAdmit.reason}`)
  } catch {
    /* optional */
  }

  // Honest layer summary for the model (never "todo OK" if something is down)
  const layerLines = [
    `Chat local: ${localOk ? 'OK' : 'CAÍDO'} (modelo activo: ${s.localModel || 'ninguno'})`,
    `Forge/imagen: ${forgeState}${forgeApi ? ' @ ' + forgeApi : ''}`,
    `Música: ${musicRunning ? 'running' : 'stopped'}`,
    `Voz: ${voiceReady === true ? 'ready' : voiceReady === false ? 'not ready' : 'unknown'}`,
    `Cloud keys configuradas: ${(cloudEnabled || []).join(', ') || 'ninguna'} (NO son modelos locales instalados)`,
    resourceLine || `recursos: RAM~${ramGB}GB`
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
    ramGB,
    vramGB,
    hasDiscreteGpu,
    notes,
    layers: layerLines
  }
}

let statusCache: { at: number; text: string } | null = null

export function setStatusCache(v: typeof statusCache): void {
  statusCache = v
}

export function getStatusCache(): typeof statusCache {
  return statusCache
}
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

Mutación (solo userData; dryRun o confirm + aprobación UI): copy_file, move_file, rename_file, delete_file (papelera).
Lectura: get_app_status, health_forge, check_local_runtime, list_installed_models, list_models, recommend_model, auto_route_model, list_download_jobs, run_diagnosis, list_library, describe_file, classify_file, copy_file, move_file, rename_file, delete_file, read_text_file, propose_file_edit, apply_file_edit, show_in_folder, open_external_url
Acción: start_forge, stop_forge, health_forge, scan_local_models, list_model_scores, assess_image_stack, probe_forge, check_faceid, ensure_faceid, ensure_controlnet, preview_scene, clean_diagnostics_exports, start_music, stop_music, start_ollama, voice_ensure, set_provider_mode, set_local_model, set_image_mode, set_ui_mode, download_model, resume_download, pause_download, cancel_download, delete_model, open_settings_hint, clear_app_logs, list_app_logs, rename_conversation, run_chat_self_check, list_host_commands, recover_settings
clear_app_logs modes: soft | hard | smart (tests/logs obsoletos, conserva settings) | tests | all

Política:
1) Imagen local sin Forge → plan health_forge → start_forge → health_forge. El host REESCRIBE el plan si Forge ya está running (no vuelve a start_forge).
2) Música → start_music
3) Local caído → check_local_runtime → start_ollama → list_installed_models
4) Si el usuario pide código/visión/resumen, puedes usar auto_route_model o dejar que el host rote el modelo local.
5) Charla normal → sin APP_PLAN ni APP_ACTION. Si el usuario solo cuenta su día o dice «trabajando en esta app / mi libro» sin pedir revisión, NO emitas plan ni get_app_status.
6) Solo diagnostica si pide explícitamente: «estado de la app», «autodiagnóstico», «revisa Ollama», «lista modelos», etc.
7) No inventes archivos ni éxitos sin resultado del host
`.trim()


/**
 * Harness step 1: auto-select local model by task (chat/code/vision/summary).
 * Safe no-op if routing disabled, cloud-only mode, or no better installed model.
 */
/** Unpin and pick best local model for general chat (RAM-aware). */
export async function applySmartLocalModelAuto(): Promise<{
  ok: boolean
  model: string
  reason: string
  candidates: Array<{ id: string; score: number }>
}> {
  const store = useSettingsStore.getState()
  const s = store.settings
  let ram = 16
  try {
    const p = await window.kawaii?.machineEnsureProfile?.()
    const mem = (p as { profile?: { totalMemoryGB?: number } })?.profile?.totalMemoryGB
    if (typeof mem === 'number' && mem > 0) ram = mem
  } catch {
    /* */
  }
  let installed: string[] = []
  try {
    const snap = await discoverLocalModelsFull({
      ollamaBaseUrl: s.localBaseUrl,
      openAIBaseUrl: (s.localOpenAIBaseUrl || '').trim() || undefined,
      ramGB: ram
    })
    installed = snap.models.map((m) => m.id || m.name).filter(Boolean)
  } catch {
    installed = await listOllamaModelNames(s.localBaseUrl)
  }
  if (!installed.length) {
    store.update({ localModelPinned: false })
    return { ok: false, model: '', reason: 'sin modelos locales', candidates: [] }
  }
  const pick = pickBestInstalledForTask({
    installed,
    preferUncensoredCompanion: Boolean(s.adultIntimacyOptIn),
    task: 'chat',
    current: '', // force pure best, ignore sticky current
    ramGB: ram,
    minDelta: 0
  })
  const model = pick.to || installed[0]
  store.update({ localModel: model, localModelPinned: false, autoModelRouting: true })
  try {
    recordPreferredLocalModel(model)
  } catch {
    /* */
  }
  invalidateAppAgentStatusCache()
  return {
    ok: Boolean(model),
    model,
    reason: pick.reason || `Auto → ${model}`,
    candidates: pick.candidates || []
  }
}


/** A3 — single lifecycle path (Ollama + LMS). Returns detail for A5 route meta. */
export async function freeOtherLocalModels(
  keepModel: string
): Promise<{ detail: string; unloaded: string[] }> {
  const keep = (keepModel || '').trim()
  if (!keep) return { detail: '', unloaded: [] }
  const s = useSettingsStore.getState().settings
  try {
    const { switchToModel } = await import('@core/resources/model-lifecycle')
    const r = await switchToModel(keep, {
      ollamaBaseUrl: s.localBaseUrl || 'http://127.0.0.1:11434',
      openAIBaseUrl: (s.localOpenAIBaseUrl || '').trim() || undefined,
      lmStudioBaseUrl:
        (s as { lmStudioBaseUrl?: string }).lmStudioBaseUrl ||
        (s.localOpenAIBaseUrl || '').trim() ||
        'http://127.0.0.1:1234',
      lmStudioApiToken: (s as { lmStudioApiToken?: string }).lmStudioApiToken
    })
    console.info('[auto-route] lifecycle', r.detail)
    return { detail: r.detail, unloaded: r.unloaded }
  } catch (e) {
    console.warn('[auto-route] lifecycle skip', e)
    return {
      detail: e instanceof Error ? e.message : String(e),
      unloaded: []
    }
  }
}

export async function applyAutoModelRouting(
  userText: string,
  opts?: {
    hasImageAttachment?: boolean
    forceTask?: ChatTask
    conversationId?: string | null
  }
): Promise<{
  applied: boolean
  task: ChatTask
  from: string
  to: string
  reason: string
  /** A5 — lifecycle one-liner for message meta */
  lifecycle?: string
}> {
  const store = useSettingsStore.getState()
  const s = store.settings

  let ram = 16
  let vram: number | null = null
  try {
    const p = await window.kawaii?.machineEnsureProfile?.()
    const mem = (p as { profile?: { totalMemoryGB?: number } })?.profile?.totalMemoryGB
    if (typeof mem === 'number' && mem > 0) ram = mem
    const v = (p as { profile?: { vramGB?: number } })?.profile?.vramGB
    if (typeof v === 'number') vram = v
  } catch {
    /* ignore */
  }

  let installed: string[] = []
  let installedMeta: Array<{ id: string; source?: string }> = []
  try {
    const snap = await discoverLocalModelsFull({
      ollamaBaseUrl: s.localBaseUrl,
      openAIBaseUrl: (s.localOpenAIBaseUrl || '').trim() || undefined,
      ramGB: ram
    })
    installedMeta = snap.models
      .map((m) => ({
        id: (m.id || m.name || '').trim(),
        source: String(m.source || ''),
        autoEligible: m.autoEligible !== false && !m.diskOnly
      }))
      .filter((m) => m.id)
    installed = installedMeta.map((m) => m.id)
  } catch {
    installed = await listOllamaModelNames(s.localBaseUrl)
    installedMeta = installed.map((id) => ({ id, source: 'ollama' }))
  }

  let conversationId = opts?.conversationId ?? null
  if (conversationId == null) {
    try {
      const { useChatStore } = await import('@shared/lib/stores/chatStore')
      conversationId = useChatStore.getState().activeId
    } catch {
      conversationId = null
    }
  }

  // Detect resident in VRAM; never prefer a user-disabled model (avoids load-then-eject)
  const { isLocalModelDisabled } = await import('@core/models/disabled-local-models')
  const disabledList = s.disabledLocalModels || []
  if ((s.localModel || '').trim() && isLocalModelDisabled(s.localModel || '', disabledList)) {
    store.update({ localModel: '', localModelPinned: false })
  }
  let residentModelId = ''
  try {
    const openAI =
      (s.localOpenAIBaseUrl || '').trim() ||
      (s as { lmStudioBaseUrl?: string }).lmStudioBaseUrl ||
      'http://127.0.0.1:1234'
    const { listLmStudioModels } = await import('@core/providers/lmstudio-lifecycle')
    const listed = await listLmStudioModels(openAI, {
      apiToken: (s as { lmStudioApiToken?: string }).lmStudioApiToken
    })
    const loaded = listed.filter(
      (m) =>
        m.state &&
        /^(loaded|active)$/i.test(m.state) &&
        !/embed|mmproj|clip/i.test(m.id) &&
        !isLocalModelDisabled(m.id, disabledList)
    )
    if (loaded.length === 1) {
      residentModelId = loaded[0]!.id
    } else if (loaded.length > 1) {
      const want = (s.localModel || '').trim()
      const match = loaded.find((m) => m.id === want) || loaded[0]
      residentModelId = match!.id
    }
  } catch {
    /* optional */
  }

  const localModelForDecision =
    residentModelId ||
    ((s.localModel || '').trim() && !isLocalModelDisabled(s.localModel || '', disabledList)
      ? s.localModel
      : '')

  // R1 — pure decision (classify → pick); side effects below
  const decision = decideAutoRoute({
    userText,
    settings: {
      autoModelRouting: s.autoModelRouting,
      localModelPinned: s.localModelPinned,
      localModel: localModelForDecision,
      localModelIntimate: (s as { localModelIntimate?: string }).localModelIntimate,
      providerMode: s.providerMode,
      adultIntimacyOptIn: s.adultIntimacyOptIn,
      userBirthDate: (s as { userBirthDate?: string }).userBirthDate,
      relationshipState: s.relationshipState,
      relationshipRole: (s as { relationshipRole?: string }).relationshipRole,
      character: s.character,
      disabledLocalModels: s.disabledLocalModels
    },
    installed,
    installedMeta,
    ramGB: ram,
    vramGB: vram,
    hasImageAttachment: opts?.hasImageAttachment,
    forceTask: opts?.forceTask,
    conversationId,
    residentModelId: residentModelId || null
  })

  applyStickyFromDecision(decision)

  if (!decision.runLifecycle && !decision.applied) {
    // Still sync settings if resident differs from stored localModel
    if (residentModelId && residentModelId !== (s.localModel || '').trim()) {
      store.update({ localModel: residentModelId })
    }
    return {
      applied: false,
      task: decision.task,
      from: decision.from,
      to: decision.to || residentModelId || decision.from,
      reason:
        (decision.reason || 'sin cambio') +
        (residentModelId ? ` · residente ${residentModelId}` : '')
    }
  }

  if (decision.applied && decision.to) {
    store.update({
      localModel: decision.to,
      // Cede pin when Auto (incl. intimacy exception R4) changes model
      localModelPinned: false
    })
    try {
      recordPreferredLocalModel(decision.to)
    } catch {
      /* */
    }
    invalidateAppAgentStatusCache()
  }

  let life = { detail: '', unloaded: [] as string[] }
  const target = (decision.to || '').trim()
  const alreadySoleResident =
    Boolean(target) &&
    Boolean(residentModelId) &&
    (residentModelId === target ||
      residentModelId.toLowerCase().replace(/[^a-z0-9]+/g, '') ===
        target.toLowerCase().replace(/[^a-z0-9]+/g, ''))
  // Skip expensive unload/load when the chosen model is already the only resident
  if (decision.runLifecycle && target && !alreadySoleResident) {
    life = await freeOtherLocalModels(target)
  } else if (alreadySoleResident) {
    life = { detail: `ya residente «${residentModelId}» — sin reload`, unloaded: [] }
  }

  let reason = decision.reason
  try {
    const { largeModelWarning } = await import('@core/models/local-model-scorer')
    const w = largeModelWarning(decision.to)
    if (w) reason = (reason || '') + ' · ⚠ ' + w
  } catch {
    /* */
  }
  if (life.detail) reason = (reason || '') + ' · ' + life.detail

  return {
    applied: decision.applied,
    task: decision.task,
    from: decision.from,
    to: decision.to,
    reason,
    lifecycle:
      decision.runLifecycle || decision.applied
        ? `lifecycle: ${decision.from || '(ninguno)'}→${decision.to}` +
          (life.detail ? ` · ${life.detail}` : '')
        : undefined
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
    'Responde en personaje, sin plantillas rígidas ni listas vacías de marketing. ' +
    'Si preguntan qué puedes hacer, usa list_host_commands o habla con naturalidad de capas reales (chat, visión, Forge, voz…). ' +
    'Si una acción falló hace poco, no la repitas igual: diagnostica o explica el límite.'
  statusCache = { at: now, text }
  return text
}

/** Force refresh on next chat turn (after tool actions that change status) */
export function invalidateAppAgentStatusCache(): void {
  statusCache = null
}


export async function listOllamaModelNames(baseUrl: string): Promise<string[]> {
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
export async function syncInstalledFromOllama(baseUrl: string, names?: string[]): Promise<void> {
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
