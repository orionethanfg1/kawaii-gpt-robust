/**
 * Shared types for chat orchestrator modules (avoid circular imports).
 */
import type { AppError } from '@core/errors'
import type { ChatProvider } from '@core/providers'
import type { CloudEndpointWithKey } from '@core/models/cloud-rotation'

export interface RouteInfo {
  target: string
  reason: string
  model: string
  failover?: boolean
  contextPacked?: boolean
  summarySource?: 'model' | 'heuristic'
  useWebSearch?: boolean
  webHitCount?: number
  webSources?: { title: string; snippet: string; url?: string }[]
  at: number
}

export interface OrchestratorCallbacks {
  onToken: (token: string) => void
  onRoute?: (info: RouteInfo) => void
  onDone?: (meta: {
    model: string
    provider: string
    latencyMs: number
    route: RouteInfo
    /** Full assistant text as delivered by the provider (pre-UI collapse) */
    content?: string
  finishReason?: string | null
  limited?: boolean
  }) => void
  onError?: (error: AppError) => void
  onSummary?: (info: {
    summary: string
    coveredCount: number
    source: 'model' | 'heuristic'
  }) => void
  onPhase?: (phase: 'preparing' | 'searching' | 'summarizing' | 'generating' | 'failover') => void
}

export interface OrchestratorDeps {
  local?: ChatProvider | null
  cloudProviders?: Array<{ endpoint: CloudEndpointWithKey; provider: ChatProvider }>
  availability?: { localAvailable: boolean; cloudAvailable: boolean }
}
