import type { AppToolCall, AppToolName } from './types'

const TOOLS = new Set<string>([
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
])

/**
 * Extract tool calls from model text. Supports:
 * <<<APP_ACTION>>>{json}<<<END_APP_ACTION>>>
 * and legacy [APP_ACTION]...[/APP_ACTION]
 */
export function parseAppActions(text: string): { cleanText: string; actions: AppToolCall[] } {
  const actions: AppToolCall[] = []
  let clean = text

  const patterns = [
    /<<<APP_ACTION>>>\s*([\s\S]*?)\s*<<<END_APP_ACTION>>>/gi,
    /\[APP_ACTION\]\s*([\s\S]*?)\s*\[\/APP_ACTION\]/gi
  ]

  for (const re of patterns) {
    clean = clean.replace(re, (_, body: string) => {
      try {
        const raw = body.trim()
        const obj = JSON.parse(raw) as { tool?: string; args?: Record<string, unknown> }
        if (obj.tool && TOOLS.has(obj.tool)) {
          actions.push({
            tool: obj.tool as AppToolName,
            args: (obj.args || {}) as AppToolCall['args']
          })
        }
      } catch {
        /* ignore bad json */
      }
      return ''
    })
  }

  return { cleanText: clean.replace(/\n{3,}/g, '\n\n').trim(), actions }
}
