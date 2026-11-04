/**
 * Let the model / user phrases control app settings (fail-soft).
 * Detects clear configuration intents in Spanish/English and applies them.
 */

import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import type { Settings } from '@shared/types/settings'

export type AppControlResult = {
  handled: boolean
  reply?: string
  changes?: string[]
}

const CONFIG_HINT =
  /\b(configura|configuración|ajustes|settings|cambia|cambiar|activa|activar|desactiva|desactivar|pon|ponme|usa el modelo|modelo local|modo smart|modo local|modo cloud|abre forge|generaci[oó]n de im[aá]genes)\b/i

export function looksLikeAppConfigIntent(text: string): boolean {
  return CONFIG_HINT.test(text)
}

function applyPatch(patch: Partial<Settings>): string[] {
  const changes: string[] = []
  const cur = useSettingsStore.getState().settings
  const next: Partial<Settings> = {}
  for (const [k, v] of Object.entries(patch) as [keyof Settings, Settings[keyof Settings]][]) {
    if (v !== undefined && cur[k] !== v) {
      ;(next as Record<string, unknown>)[k as string] = v
      changes.push(`${String(k)} → ${String(v)}`)
    }
  }
  if (changes.length) useSettingsStore.getState().update(next)
  return changes
}

/**
 * Deterministic helpers for common requests. No LLM required.
 */
export async function tryHandleAppControl(text: string): Promise<AppControlResult> {
  const t = text.trim()
  if (!looksLikeAppConfigIntent(t)) return { handled: false }

  const changes: string[] = []

  if (/\b(modo\s+local|solo\s+local|usa\s+local)\b/i.test(t)) {
    changes.push(...applyPatch({ providerMode: 'local' }))
  }
  if (/\b(modo\s+cloud|solo\s+nube|usa\s+cloud)\b/i.test(t)) {
    changes.push(...applyPatch({ providerMode: 'cloud' }))
  }
  if (/\b(modo\s+smart|modo\s+inteligente|routing\s+smart)\b/i.test(t)) {
    changes.push(...applyPatch({ providerMode: 'smart' }))
  }
  if (/\b(activa|activar|enciende|enable).{0,20}(imagen|imágenes|image)/i.test(t)) {
    changes.push(...applyPatch({ imageGenEnabled: true, imageProviderMode: 'smart' }))
  }
  if (/\b(desactiva|apaga|disable).{0,20}(imagen|imágenes|image)/i.test(t)) {
    changes.push(...applyPatch({ imageGenEnabled: false, imageProviderMode: 'off' }))
  }
  if (/\b(ui\s+avanzad|modo\s+avanzad)/i.test(t)) {
    changes.push(...applyPatch({ uiComplexity: 'advanced' }))
  }
  if (/\b(ui\s+smart|modo\s+simple|interfaz\s+simple)/i.test(t)) {
    changes.push(...applyPatch({ uiComplexity: 'smart' }))
  }
  if (/\b(arranca|inicia|abre)\s+forge\b/i.test(t)) {
    try {
      await window.kawaii?.forgeStart?.()
      changes.push('Forge: arranque solicitado')
    } catch (e) {
      return {
        handled: true,
        reply: `No pude arrancar Forge: ${e instanceof Error ? e.message : String(e)}`,
        changes
      }
    }
  }
  if (/\b(modelo\s+local|usa\s+(el\s+)?modelo)\s*[:=]?\s*([a-zA-Z0-9_.:\/-]+)/i.test(t)) {
    const m = t.match(/\b(?:modelo\s+local|usa\s+(?:el\s+)?modelo)\s*[:=]?\s*([a-zA-Z0-9_.:\/-]+)/i)
    if (m?.[1]) changes.push(...applyPatch({ localModel: m[1] }))
  }

  if (changes.length === 0) {
    return {
      handled: true,
      reply:
        'Puedo ayudarte a configurar la app. Prueba frases como:\n' +
        '• «modo local» / «modo cloud» / «modo smart»\n' +
        '• «activa generación de imágenes»\n' +
        '• «usa el modelo llama3.2:3b»\n' +
        '• «arranca Forge»\n' +
        '• «UI avanzada» / «UI smart»\n' +
        'También puedes abrir **Ajustes** para todo lo demás.'
    }
  }

  return {
    handled: true,
    reply: `Listo, apliqué:\n• ${changes.join('\n• ')}`,
    changes
  }
}
