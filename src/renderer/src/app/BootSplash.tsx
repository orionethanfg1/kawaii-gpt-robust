/**
 * Welcome / boot progress while disk + runtimes warm up.
 */
export type BootStep = {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'skip' | 'error'
  detail?: string
}

type Props = {
  steps: BootStep[]
  progress: number
  title?: string
  subtitle?: string
}

export function BootSplash({
  steps,
  progress,
  title = 'KawaiiGPT Robust',
  subtitle = 'Cargando datos locales…'
}: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)))
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-gradient-to-b from-[#FFF5F8] via-[#FFF8F0] to-[#F5F0FF] text-kawaii-text">
      <div className="w-full max-w-md mx-4 rounded-2xl border border-kawaii-border/60 bg-white/90 shadow-xl px-6 py-7 space-y-5">
        <div className="text-center space-y-1">
          <div className="text-3xl" aria-hidden>
            🌸
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-[12px] text-kawaii-text-muted">{subtitle}</p>
        </div>

        <div className="space-y-1.5">
          <div className="h-2.5 rounded-full bg-kawaii-pink-soft/80 overflow-hidden border border-kawaii-border/40">
            <div
              className="h-full rounded-full bg-kawaii-pink-deep transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-kawaii-text-muted text-right tabular-nums">{pct}%</p>
        </div>

        <ul className="space-y-1.5 max-h-48 overflow-y-auto text-[11px]">
          {steps.map((s) => {
            const icon =
              s.status === 'done'
                ? '✓'
                : s.status === 'running'
                  ? '…'
                  : s.status === 'error'
                    ? '!'
                    : s.status === 'skip'
                      ? '–'
                      : '○'
            const color =
              s.status === 'done'
                ? 'text-emerald-700'
                : s.status === 'running'
                  ? 'text-kawaii-pink-deep'
                  : s.status === 'error'
                    ? 'text-amber-800'
                    : 'text-kawaii-text-muted'
            return (
              <li key={s.id} className={`flex gap-2 ${color}`}>
                <span className="w-4 shrink-0 font-mono">{icon}</span>
                <span className="min-w-0">
                  <span className="font-medium">{s.label}</span>
                  {s.detail ? (
                    <span className="block text-[10px] opacity-80 truncate">{s.detail}</span>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>

        <p className="text-[10px] text-center text-kawaii-text-muted leading-snug">
          Avatar, memoria y modelos se leen desde disco para no saturar el almacenamiento del
          navegador. Solo la primera vez tras abrir puede tardar un poco.
        </p>
      </div>
    </div>
  )
}
