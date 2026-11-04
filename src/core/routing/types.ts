export type RouteTarget = 'local' | 'cloud' | 'web-augmented-cloud'

export interface RouteDecision {
  target: RouteTarget
  reason: string
  /** Suggested temperature override */
  temperature?: number
  /** Suggested max tokens override */
  maxTokens?: number
  topP?: number
  topK?: number
  preferThinkingOff?: boolean
  /** Whether to attach web search context */
  useWebSearch: boolean
  confidence: number // 0–1
  /** Host-visible routing tags */
  tags?: string[]
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
  /** When false, never route to cloud (offline / local-only policy) */
  networkOnline?: boolean
  /** User preference when mode is smart: bias local harder */
  preferLocal?: boolean
}
