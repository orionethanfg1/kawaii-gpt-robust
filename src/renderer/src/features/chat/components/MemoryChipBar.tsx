/**
 * M5 — reusable chip bar for onboarding, nickname proposals, and memory UI.
 */
export type MemoryChipItem = {
  id: string
  label: string
  /** dashed outline for secondary actions */
  variant?: "default" | "muted" | "danger"
}

type Props = {
  hint?: string
  chips: MemoryChipItem[]
  onPick: (id: string) => void
  className?: string
}

export function MemoryChipBar({ hint, chips, onPick, className }: Props) {
  if (!chips.length && !hint) return null
  return (
    <div className={"flex flex-wrap gap-1.5 px-1 pb-1.5 " + (className || "")}>
      {hint ? (
        <span className="text-[10px] text-kawaii-text-muted w-full">{hint}</span>
      ) : null}
      {chips.map((c) => {
        const base =
          "text-[11px] px-2.5 py-1 rounded-full border text-kawaii-text "
        const style =
          c.variant === "muted"
            ? base + "border-dashed border-kawaii-border text-kawaii-text-muted"
            : c.variant === "danger"
              ? base + "border-rose-200 bg-rose-50 hover:bg-rose-100"
              : base + "border-kawaii-border bg-white hover:bg-violet-50"
        return (
          <button key={c.id} type="button" className={style} onClick={() => onPick(c.id)}>
            {c.label}
          </button>
        )
      })}
    </div>
  )
}
