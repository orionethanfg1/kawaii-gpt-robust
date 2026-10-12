import { useActivityStore } from '@shared/lib/stores/activityStore'
import { openActivity, endActivityWithComment, companionName } from './companion'

/** Compact chips for chat header (not a full-width bar). */
export function ActivitiesBar() {
  const mode = useActivityStore((s) => s.mode)
  const name = companionName()

  return (
    <div className="flex flex-wrap items-center gap-1 justify-end">
      <span className="text-[10px] text-kawaii-text-muted hidden sm:inline mr-0.5" title="Juega con el personaje">
        Con {name}:
      </span>
      <button
        type="button"
        className={
          'text-[11px] px-2 py-0.5 rounded-full border transition-colors ' +
          (mode === 'chess'
            ? 'bg-violet-100 border-violet-400 text-violet-900 font-medium'
            : 'bg-white/80 border-kawaii-border text-kawaii-text-muted hover:border-violet-300')
        }
        onClick={() => openActivity('chess')}
      >
        ♞ Ajedrez
      </button>
      <button
        type="button"
        className={
          'text-[11px] px-2 py-0.5 rounded-full border transition-colors ' +
          (mode === 'adventure'
            ? 'bg-amber-100 border-amber-400 text-amber-950 font-medium'
            : 'bg-white/80 border-kawaii-border text-kawaii-text-muted hover:border-amber-300')
        }
        onClick={() => openActivity('adventure')}
      >
        🗺 Aventura
      </button>
      {mode !== 'none' ? (
        <button
          type="button"
          className="text-[11px] px-2 py-0.5 rounded-full border border-rose-200 text-rose-700 bg-white/90"
          onClick={() => endActivityWithComment('stop')}
        >
          Salir
        </button>
      ) : null}
    </div>
  )
}
