/**
 * Multi-layer generative system: text is the hub; image/music/video are
 * optional capabilities invoked only when intent + availability require them.
 */

export type GenerativeModality = 'text' | 'image' | 'music' | 'video'

export type GenerativeCapabilityStatus =
  | 'available'
  | 'degraded'
  | 'unavailable'
  | 'not_configured'

export interface GenerativeCapability {
  id: string
  modality: GenerativeModality
  displayName: string
  /** Prefer lower = tried first within modality */
  priority: number
  status: GenerativeCapabilityStatus
  reason?: string
  /** Rough cost: local GPU vs free cloud */
  kind: 'local' | 'cloud' | 'hybrid'
}

export type GenerativeIntent =
  | { modality: 'text'; confidence: number }
  | {
      modality: 'image' | 'music' | 'video'
      confidence: number
      /** Clean prompt for the generator (lyrics/style stripped of command noise) */
      prompt: string
      /** Original user text */
      raw: string
    }

export interface GenerativePlan {
  /** Always respond with text unless user only wants a pure media dump */
  useText: boolean
  /** Optional side generations to run (in order) */
  sideJobs: Array<{
    modality: 'image' | 'music' | 'video'
    prompt: string
    capabilityId?: string
  }>
  /** Human-readable reason for UI / route meta */
  reason: string
}

export interface GenerativeJobResult {
  modality: GenerativeModality
  ok: boolean
  /** File path, data URL, or remote URL */
  assetUrl?: string
  mimeType?: string
  error?: string
  capabilityId?: string
  durationMs?: number
}
