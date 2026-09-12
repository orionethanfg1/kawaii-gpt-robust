import { useRecoveryStore, shouldOfferRecovery } from '@shared/lib/stores/recoveryStore'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { brainSummary } from '@core/diagnostics/mini-brain'
import { useMemo, useState } from 'react'

/**
 * Shown when the previous session ended mid-work (dirty checkpoint).
 */
export function RecoveryBanner() {
  const checkpoint = useRecoveryStore((s) => s.checkpoint)
  const dismiss = useRecoveryStore((s) => s.dismiss)
  const clear = useRecoveryStore((s) => s.clear)
  const markClean = useRecoveryStore((s) => s.markClean)
  const setActive = useChatStore((s) => s.setActive)
  const [showBrain, setShowBrain] = useState(false)

  const offer = useMemo(() => shouldOfferRecovery(), [checkpoint.updatedAt, checkpoint.dirty])

  if (!offer) {
    // Still allow a tiny "learned patterns" hint if any
    const summary = brainSummary()
    if (summary.patternCount === 0) return null
    return null
  }

  const when = checkpoint.updatedAt
    ? new Date(checkpoint.updatedAt).toLocaleString()
    : ''

  return (
    <div className="mx-3 mt-2 rounded-kawaii border border-amber-200/80 bg-amber-50/90 px-3 py-1.5 text-xs text-kawaii-text">
      <p className="font-semibold text-amber-900">Modo recuperación</p>
      <p className="text-kawaii-text-muted">
        La sesión anterior parece haberse interrumpido
        {when ? ` (${when})` : ''}. Puedes retomar el chat o el borrador.
      </p>
      {checkpoint.pendingUserPreview && (
        <p className="text-[11px] text-kawaii-text-muted truncate">
          Último mensaje: “{checkpoint.pendingUserPreview}”
        </p>
      )}
      {checkpoint.ollamaPullModel && (
        <p className="text-[11px] text-kawaii-text-muted">
          Descarga Ollama en curso: {checkpoint.ollamaPullModel}
          {checkpoint.ollamaPullProgress != null
            ? ` (${Math.round(checkpoint.ollamaPullProgress)}%)`
            : ''}
        </p>
      )}
      {checkpoint.lastRemedy && (
        <p className="text-[11px] text-amber-800">
          Última sugerencia de la mini-IA: {checkpoint.lastRemedy}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {checkpoint.activeConversationId && (
          <button
            type="button"
            className="btn-kawaii text-[11px] px-2 py-1"
            onClick={() => {
              setActive(checkpoint.activeConversationId!)
              markClean()
            }}
          >
            Ir al chat
          </button>
        )}
        <button
          type="button"
          className="btn-kawaii-ghost text-[11px] px-2 py-1"
          onClick={() => setShowBrain((v) => !v)}
        >
          {showBrain ? 'Ocultar aprendizaje' : 'Qué aprendió la app'}
        </button>
        <button
          type="button"
          className="btn-kawaii-ghost text-[11px] px-2 py-1"
          onClick={() => {
            markClean()
            dismiss()
          }}
        >
          Descartar
        </button>
        <button
          type="button"
          className="text-[11px] text-kawaii-text-muted underline"
          onClick={() => clear()}
        >
          Limpiar checkpoint
        </button>
      </div>
      {showBrain && (
        <ul className="mt-1 list-disc ml-4 text-[11px] text-kawaii-text-muted">
          {brainSummary().top.map((p) => (
            <li key={p.key}>
              {p.key} ×{p.count} → remedio: {p.remedy}
            </li>
          ))}
          {brainSummary().patternCount === 0 && <li>Aún no hay patrones acumulados.</li>}
        </ul>
      )}
    </div>
  )
}
