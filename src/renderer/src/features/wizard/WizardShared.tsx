import type { ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { Button } from '@shared/ui/Button'

export function FeatureCard({
  emoji,
  title,
  desc
}: {
  emoji: string
  title: string
  desc: string
}) {
  return (
    <div className="bg-white border border-kawaii-border rounded-kawaii p-3 shadow-kawaii">
      <div className="text-2xl mb-1">{emoji}</div>
      <div className="font-bold text-xs text-kawaii-text">{title}</div>
      <div className="text-[11px] text-kawaii-text-muted mt-0.5">{desc}</div>
    </div>
  )
}

export function ModeCard({
  active,
  icon,
  title,
  desc,
  onClick
}: {
  active: boolean
  icon: ReactNode
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-kawaii border-2 p-4 flex gap-3 transition ${
        active
          ? 'border-kawaii-pink-deep bg-kawaii-pink-soft/40 shadow-kawaii'
          : 'border-kawaii-border bg-white hover:border-kawaii-pink'
      }`}
    >
      <div className="text-kawaii-pink-deep mt-0.5">{icon}</div>
      <div>
        <div className="font-bold text-sm text-kawaii-text flex items-center gap-2">
          {title}
          {active && <Check className="w-3.5 h-3.5" />}
        </div>
        <p className="text-xs text-kawaii-text-muted mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </button>
  )
}

export function NavRow({
  onBack,
  onNext,
  nextDisabled,
  nextLabel = 'Siguiente'
}: {
  onBack: () => void
  onNext: () => void
  nextDisabled?: boolean
  nextLabel?: string
}) {
  return (
    <div className="flex justify-between items-center pt-2">
      <button
        type="button"
        className="text-sm text-kawaii-text-muted hover:underline"
        onClick={onBack}
      >
        ← Atrás
      </button>
      <Button onClick={onNext} disabled={nextDisabled}>
        {nextLabel} <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  )
}
