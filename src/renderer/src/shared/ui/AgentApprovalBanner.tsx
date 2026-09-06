import { Check, ShieldAlert, X } from 'lucide-react'
import { useAgentApprovalStore } from '@shared/lib/stores/agentApprovalStore'

export function AgentApprovalBanner() {
  const pending = useAgentApprovalStore((state) => state.pending)
  const resolve = useAgentApprovalStore((state) => state.resolve)
  if (!pending) return null

  return (
    <div className="border-t border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">
      <div className="mx-auto flex max-w-4xl items-center gap-3">
        <ShieldAlert className="h-5 w-5 shrink-0 text-amber-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">El agente necesita tu aprobación</p>
          <p className="truncate text-xs">{pending.tool}: {pending.reason}</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-kawaii border border-emerald-600 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
          onClick={() => resolve(true)}
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
          Permitir
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-kawaii border border-amber-700 px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          onClick={() => resolve(false)}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Rechazar
        </button>
      </div>
    </div>
  )
}
