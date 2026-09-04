import { Loader2, RefreshCw, Sparkles, Cloud, Server, Search } from 'lucide-react'
import type { RouteInfo } from '../services/chatOrchestrator'

export type LivePhase =
  | 'idle'
  | 'preparing'
  | 'summarizing'
  | 'generating'
  | 'failover'
  | 'done'

export interface LiveStatus {
  phase: LivePhase
  route: RouteInfo | null
  /** Short human label */
  label: string
  /** Models already attempted this turn (rotation / failover) */
  tried: string[]
}

const PHASE_ICON = {
  preparing: Loader2,
  summarizing: Sparkles,
  generating: Loader2,
  failover: RefreshCw,
  done: Sparkles,
  idle: Loader2
} as const

function targetIcon(target?: string) {
  if (!target) return Cloud
  if (target.includes('web')) return Search
  if (target === 'local') return Server
  return Cloud
}

function targetLabel(target?: string): string {
  if (!target) return ''
  if (target === 'local') return 'local'
  if (target.includes('web')) return 'cloud + web'
  return 'cloud'
}

interface Props {
  status: LiveStatus | null
  visible: boolean
}

export function RouteLiveIndicator({ status, visible }: Props) {
  if (!visible || !status || status.phase === 'idle' || status.phase === 'done') {
    return null
  }

  const Icon = PHASE_ICON[status.phase] ?? Loader2
  const TargetIcon = targetIcon(status.route?.target)
  const spinning = status.phase !== 'done'

  return (
    <div
      className="px-4 py-1.5 border-t border-kawaii-border bg-kawaii-pink-soft/40 text-[11px] text-kawaii-text"
      role="status"
      aria-live="polite"
    >
      <div className="max-w-4xl mx-auto flex items-center gap-2 min-w-0">
        <Icon
          className={`w-3.5 h-3.5 shrink-0 text-kawaii-pink-deep ${
            spinning ? 'animate-spin' : ''
          }`}
        />
        <TargetIcon className="w-3.5 h-3.5 shrink-0 text-kawaii-text-muted" />
        <p className="truncate flex-1">
          <span className="font-semibold">{status.label}</span>
          {status.route?.model ? (
            <span className="text-kawaii-text-muted">
              {' '}
              · {status.route.model}
              {status.route.target ? ` (${targetLabel(status.route.target)})` : ''}
            </span>
          ) : null}
        </p>
        {status.tried.length > 1 && (
          <span className="shrink-0 text-kawaii-text-muted hidden sm:inline">
            probados: {status.tried.join(' → ')}
          </span>
        )}
        {status.route?.failover && (
          <span className="shrink-0 text-amber-700 font-semibold">failover</span>
        )}
      </div>
      {status.route?.reason && (
        <p className="max-w-4xl mx-auto text-[10px] text-kawaii-text-muted truncate mt-0.5 pl-6">
          {status.route.reason}
        </p>
      )}
    </div>
  )
}

/** Build a short Spanish label from phase + route */
export function labelForPhase(phase: LivePhase, route: RouteInfo | null): string {
  switch (phase) {
    case 'preparing':
      return 'Preparando…'
    case 'summarizing':
      return 'Resumiendo contexto…'
    case 'failover':
      return route?.model
        ? `Cambiando a ${route.model}…`
        : 'Cambiando de proveedor…'
    case 'generating':
      if (route?.failover) {
        return `Generando con ${route.model || 'otro proveedor'}…`
      }
      return route?.model ? `Usando ${route.model}…` : 'Generando respuesta…'
    case 'done':
      return 'Listo'
    default:
      return ''
  }
}
