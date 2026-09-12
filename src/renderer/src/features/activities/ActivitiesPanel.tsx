import { useActivityStore } from '@shared/lib/stores/activityStore'
import { openActivity, endActivityWithComment } from './companion'

export function ActivitiesPanel() {
  const mode = useActivityStore((s) => s.mode)
  const adventure = useActivityStore((s) => s.adventure)
  const chess = useActivityStore((s) => s.chess)

  return (
    <div className="space-y-3 text-sm">
      <div>
        <h3 className="font-semibold text-kawaii-text">Actividades / mini-juegos</h3>
        <p className="text-[11px] text-kawaii-text-muted mt-0.5">
          Tu compañera te acompaña (avatar, comentarios y voz). Puedes doblar las reglas y volver al
          chat cuando quieras. Enlaces{' '}
          <code className="text-[10px]">kawaii-activity://</code> en el chat abren el juego.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-3 py-1.5 rounded-xl bg-kawaii-pink text-white text-xs font-medium"
          onClick={() => openActivity('adventure')}
        >
          Aventura (ventana + chat)
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded-xl border border-kawaii-border text-xs font-medium hover:bg-kawaii-pink-soft/40"
          onClick={() => openActivity('chess')}
        >
          Ajedrez (ventana visual)
        </button>
        {mode !== 'none' ? (
          <button
            type="button"
            className="px-3 py-1.5 rounded-xl border border-red-200 text-red-700 text-xs"
            onClick={() => endActivityWithComment('stop')}
          >
            Terminar + comentario
          </button>
        ) : null}
      </div>

      {mode === 'adventure' && adventure ? (
        <div className="rounded-xl border border-kawaii-border bg-white/60 p-3 text-[12px] space-y-1">
          <p className="font-semibold">{adventure.title}</p>
          <p>
            Turno {adventure.turn} · HP {adventure.hp}/10 · {adventure.location}
          </p>
        </div>
      ) : null}

      {mode === 'chess' && chess ? (
        <div className="rounded-xl border border-kawaii-border bg-white/60 p-3 text-[12px]">
          <p className="font-semibold">Ajedrez activo</p>
          <p className="text-kawaii-text-muted text-[10px] font-mono break-all">{chess.fen}</p>
        </div>
      ) : null}
    </div>
  )
}
