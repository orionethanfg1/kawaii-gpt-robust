/**
 * App self-agent: status snapshot + tool execution.
 * Pattern: status in system prompt + model emits <<<APP_ACTION>>> JSON; host executes.
 * Works with local models (no native function-calling required).
 */

import { formatStatusForPrompt, type AppStatusSnapshot } from '@core/agent'
import { parseAppActions, type AppToolCall } from '@core/agent'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { APP_VERSION } from '@shared/version'
import { runSelfDiagnosis } from '@core/diagnostics/self-heal'
import { tryHandleAppControl } from './appControl'

export async function buildAppStatusSnapshot(): Promise<AppStatusSnapshot> {
  const s = useSettingsStore.getState().settings
  const notes: string[] = []
  let localOk: boolean | null = null
  try {
    const st = await window.kawaii?.ollamaStatus?.(s.localBaseUrl)
    localOk = Boolean(st?.reachable)
    if (!localOk) notes.push('Ollama no responde — puedo intentar start_ollama')
  } catch {
    localOk = false
    notes.push('No se pudo consultar Ollama')
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

export async function buildAppAgentSystemBlock(): Promise<string> {
  const snap = await buildAppStatusSnapshot()
  return formatStatusForPrompt(snap)
}

export async function executeAppTool(call: AppToolCall): Promise<{ ok: boolean; summary: string }> {
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
        const report = await runSelfDiagnosis({
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
}> {
  const { cleanText, actions } = parseAppActions(text)
  const actionLog: string[] = []
  for (const a of actions) {
    const r = await executeAppTool(a)
    actionLog.push(`${r.ok ? '✓' : '✗'} ${a.tool}: ${r.summary}`)
  }
  return { cleanText, actionLog }
}

export { tryHandleAppControl, parseAppActions }
