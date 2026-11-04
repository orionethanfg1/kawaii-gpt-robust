/**
 * Multi-provider cloud rotation: ordered failover across OpenRouter, Groq, Gemini, etc.
 */

import {
  resolveModelIdForProvider,
  SAFE_DEFAULT_MODEL
} from './free-cloud-catalog'
import { isProviderCoolingDown } from './model-memory'

export interface CloudEndpoint {
  id: string
  name: string
  baseUrl: string
  model: string
  enabled: boolean
  /** Priority: lower = tried first */
  priority: number
}

export interface CloudEndpointWithKey extends CloudEndpoint {
  apiKey: string
}

export const BUILTIN_CLOUD_PROVIDERS: Omit<CloudEndpoint, 'model' | 'enabled' | 'priority'>[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1'
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1'
  },
  {
    id: 'gemini',
    name: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1'
  }
]

export const DEFAULT_MODELS: Record<string, string> = {
  openrouter: SAFE_DEFAULT_MODEL.openrouter || 'openrouter/free',
  groq: SAFE_DEFAULT_MODEL.groq || 'llama-3.1-8b-instant',
  gemini: SAFE_DEFAULT_MODEL.gemini || 'gemini-2.0-flash',
  openai: SAFE_DEFAULT_MODEL.openai || 'gpt-5.6-luna'
}

/** Build default slots for settings */
export function defaultCloudSlots(): CloudEndpoint[] {
  return BUILTIN_CLOUD_PROVIDERS.map((p, i) => ({
    ...p,
    model: DEFAULT_MODELS[p.id] ?? '',
    enabled: i === 0,
    priority: i
  }))
}

/**
 * Order endpoints that have a key and are enabled.
 * Always rewrite model ids to free-safe variants before calling the API.
 */
/**
 * A4: build the live cloud queue from user toggles only.
 * Disabled providers never receive traffic — even if a key exists.
 */
export function orderCloudEndpoints(
  slots: CloudEndpoint[],
  keys: Record<string, string>,
  primaryBaseUrl?: string
): CloudEndpointWithKey[] {
  const withKeys: CloudEndpointWithKey[] = []
  for (const slot of slots) {
    if (!slot.enabled) continue
    // Per-provider key only (do not bleed main key into disabled providers)
    const key = (keys[slot.id] || '').trim() || (
      // Legacy: main key only for openrouter / first enabled
      slot.id === 'openrouter' ? (keys.main || '').trim() : ''
    )
    if (!key || key.length < 8) continue
    if (!slot.baseUrl || !slot.model) continue
    if (isProviderCoolingDown(slot.id)) continue
    const safeModel = resolveModelIdForProvider(slot.id, slot.model)
    withKeys.push({ ...slot, model: safeModel, apiKey: key })
  }

  // Intelligence first, then speed: OR/Gemini (quality) before Groq (fast)
  // Lower number = preferred earlier. Quality/capability first, then speed.
  const rank = (id: string) =>
    id === 'openrouter' ? -20 : id === 'gemini' ? -15 : id === 'openai' ? -5 : id === 'groq' ? 10 : 0

  withKeys.sort((a, b) => {
    const ra = rank(a.id) + a.priority
    const rb = rank(b.id) + b.priority
    if (ra !== rb) return ra - rb
    const aPrimary =
      primaryBaseUrl && a.baseUrl.replace(/\/$/, '') === primaryBaseUrl.replace(/\/$/, '')
        ? 0
        : 1
    const bPrimary =
      primaryBaseUrl && b.baseUrl.replace(/\/$/, '') === primaryBaseUrl.replace(/\/$/, '')
        ? 0
        : 1
    if (aPrimary !== bPrimary) return aPrimary - bPrimary
    return a.priority - b.priority
  })

  return withKeys
}

/** Errors that justify rotating to the next cloud provider */
export function shouldRotateCloud(code: string): boolean {
  return (
    code === 'PROVIDER_RATE_LIMIT' ||
    code === 'PROVIDER_QUOTA' ||
    code === 'PROVIDER_UNAVAILABLE' ||
    code === 'NETWORK_ERROR' ||
    code === 'PROVIDER_TIMEOUT' ||
    code === 'PROVIDER_MODEL_NOT_FOUND' ||
    code === 'CONTEXT_OVERFLOW'
  )
}

/** Why a slot was not included in the active queue (for UI / debug). */
export function explainCloudQueue(
  slots: CloudEndpoint[],
  keys: Record<string, string>
): Array<{ id: string; included: boolean; reason: string }> {
  return slots.map((slot) => {
    if (!slot.enabled) {
      return { id: slot.id, included: false, reason: 'desactivado en Ajustes' }
    }
    const key = (keys[slot.id] || (slot.id === 'openrouter' ? keys.main : '') || '').trim()
    if (!key || key.length < 8) {
      return { id: slot.id, included: false, reason: 'sin API key' }
    }
    if (!slot.baseUrl || !slot.model) {
      return { id: slot.id, included: false, reason: 'modelo o URL incompletos' }
    }
    if (isProviderCoolingDown(slot.id)) {
      return { id: slot.id, included: false, reason: 'en cooldown (fallos recientes)' }
    }
    return { id: slot.id, included: true, reason: 'activo' }
  })
}
