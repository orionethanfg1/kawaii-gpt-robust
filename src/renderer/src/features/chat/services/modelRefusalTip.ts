/**
 * Soft tip when the active model refuses content — point user to companion catalog.
 * Cooldown to avoid spam.
 */
import { detectModelRefusal } from '@core/chat/model-refusal'
import { activityInfo } from '@shared/lib/stores/activityStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { isUncensoredCompanionId } from '@core/models/recommendations'

const COOLDOWN_MS = 25 * 60 * 1000
let lastTipAt = 0

export function maybeNotifyModelRefusal(assistantText: string, opts?: { modelId?: string }): void {
  try {
    const hit = detectModelRefusal(assistantText)
    if (!hit.refused || hit.confidence < 0.5) return

    const now = Date.now()
    if (now - lastTipAt < COOLDOWN_MS) return

    const s = useSettingsStore.getState().settings
    const model = (opts?.modelId || s.localModel || s.cloudModel || '').trim()
    // Already on a refusal-reduced model → softer / skip
    if (model && isUncensoredCompanionId(model)) return

    lastTipAt = now
    const adult = Boolean(s.adultIntimacyOptIn)
    const detail = adult
      ? 'Si buscas menos negativas automáticas en cercanía adulta, prueba un modelo local del catálogo «Acompañamiento adulto» (p. ej. Dolphin). El stage y tu consentimiento siguen mandando.'
      : 'Algunos modelos (sobre todo cloud e instruct) recortan temas sensibles. En Modelos puedes ver alternativas locales; activa «Incluir uncensored» si quieres verlas.'

    activityInfo('El modelo parece haberse negado', detail, {
      sticky: true,
      actionLabel: 'Abrir catálogo de modelos',
      actionEvent: 'kawaii:open-settings',
      actionDetail: { section: 'models' }
    })
  } catch {
    /* tip optional */
  }
}
