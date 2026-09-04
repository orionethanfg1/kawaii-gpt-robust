export type RouteTarget = 'local' | 'cloud' | 'web-augmented-cloud'

export interface RouteDecision {
  target: RouteTarget
  reason: string
  /** Suggested temperature override */
  temperature?: number
  /** Suggested max tokens override */
  maxTokens?: number
  /** Whether to attach web search context */
  useWebSearch: boolean
  confidence: number // 0–1
}

export interface RoutingContext {
  prompt: string
  promptLength: number
  hasAttachments: boolean
  localAvailable: boolean
  cloudAvailable: boolean
  webSearchEnabled: boolean
  longPromptThreshold: number
  localMaxTokens: number
  cloudMaxTokens: number
}
