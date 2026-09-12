/**
 * Compact app capability snapshot for the model (token-efficient).
 */

export interface AppStatusSnapshot {
  version: string
  providerMode: string
  localModel: string
  localOk: boolean | null
  cloudEnabled: string[]
  imageGen: boolean
  imageMode: string
  forgeState: string
  forgeApi: string | null
  characterName: string
  notes: string[]
}

export function formatStatusForPrompt(s: AppStatusSnapshot): string {
  const lines = [
    `[ESTADO_APP v${s.version}]`,
    `Chat: modo=${s.providerMode} · local=${s.localModel || '(ninguno)'} (ok=${s.localOk ?? '?'})`,
    `Cloud activos: ${s.cloudEnabled.length ? s.cloudEnabled.join(', ') : '(ninguno)'}`,
    `Imágenes: ${s.imageGen ? 'ON' : 'OFF'} (${s.imageMode}) · Forge=${s.forgeState}${s.forgeApi ? ' ' + s.forgeApi : ''}`,
    `Personaje: ${s.characterName || '(default)'}`,
    ...s.notes.map((n) => `· ${n}`),
    `IMPORTANTE: si el usuario pide generar una foto/imagen/dibujo, la app lo hace sola en el chat; NO digas que active un botón ni solo uses set_image_mode. Puedes set_image_mode=smart y start_forge si hace falta, pero el generador local/cloud lo ejecuta el host.
Herramientas: si debes cambiar algo de la app, emite al FINAL del mensaje un bloque:`,
    `<<<APP_ACTION>>>{"tool":"NOMBRE","args":{...}}<<<END_APP_ACTION>>>`,
    `IMPORTANTE: si el usuario pide generar una foto/imagen/dibujo, la app lo hace sola en el chat; NO digas que active un botón ni solo uses set_image_mode. Puedes set_image_mode=smart y start_forge si hace falta, pero el generador local/cloud lo ejecuta el host.
Herramientas: get_app_status, list_models, list_installed_models, recommend_model(task=chat|code|vision|tools|summary), check_local_runtime, set_active_model(modelId=...), download_model(modelId|model=...), pause_download/cancel_download(model=...), resume_download(model=...), delete_model(modelId|model=...), list_download_jobs, set_provider_mode(mode=local|cloud|smart), set_local_model(model=...), set_image_mode(mode=off|local|cloud|smart), set_ui_mode(mode=smart|advanced), start_forge, stop_forge, health_forge, start_ollama, run_diagnosis. download_model y delete_model requieren aprobación del usuario.`,
    `No inventes herramientas. No pidas API keys en claro. Una acción por respuesta salvo que el usuario pida varias.`
  ]
  return lines.join('\n')
}
