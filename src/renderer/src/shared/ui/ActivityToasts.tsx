import { useActivityStore } from '@shared/lib/stores/activityStore'
import { CheckCircle2, AlertCircle, Info, Loader2, X } from 'lucide-react'

const KIND_STYLES: Record<string, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-950',
  progress: 'border-kawaii-border bg-white text-kawaii-text',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  error: 'border-amber-300 bg-amber-50 text-amber-950'
}

export function ActivityToasts() {
  const items = useActivityStore((s) => s.items)
  const dismiss = useActivityStore((s) => s.dismiss)

  if (items.length === 0) return null

  return (
    <div
      className="fixed bottom-4 right-4 z-[80] flex flex-col gap-2 w-[min(100vw-2rem,22rem)] pointer-events-none"
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={`pointer-events-auto rounded-kawaii border shadow-md px-3 py-2 text-xs ${KIND_STYLES[item.kind] || KIND_STYLES.info}`}
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">
              {item.kind === 'progress' && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-kawaii-pink-deep" />
              )}
              {item.kind === 'success' && (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              )}
              {item.kind === 'error' && (
                <AlertCircle className="w-3.5 h-3.5 text-amber-700" />
              )}
              {item.kind === 'info' && <Info className="w-3.5 h-3.5 text-sky-600" />}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold leading-snug">{item.title}</p>
              {item.detail && (
                <p className="text-[11px] opacity-90 mt-0.5 break-words leading-relaxed">
                  {item.detail}
                </p>
              )}
              {item.kind === 'progress' && typeof item.progress === 'number' && (
                <div className="mt-1.5 h-1 rounded-full bg-kawaii-pink-soft overflow-hidden">
                  <div
                    className="h-full bg-kawaii-pink-deep transition-all duration-300"
                    style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                  />
                </div>
              )}
            </div>
            <button
              type="button"
              className="shrink-0 p-0.5 rounded hover:bg-black/5"
              aria-label="Cerrar"
              onClick={() => dismiss(item.id)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
