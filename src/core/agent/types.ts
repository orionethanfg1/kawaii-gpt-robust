export type AppToolName =
  | 'get_app_status'
  | 'set_provider_mode'
  | 'set_local_model'
  | 'set_image_mode'
  | 'set_ui_mode'
  | 'start_forge'
  | 'stop_forge'
  | 'health_forge'
  | 'start_ollama'
  | 'run_diagnosis'
  | 'open_settings_hint'

export interface AppToolCall {
  tool: AppToolName
  args?: Record<string, string | number | boolean>
}

export interface AppToolResult {
  ok: boolean
  summary: string
  data?: unknown
}
