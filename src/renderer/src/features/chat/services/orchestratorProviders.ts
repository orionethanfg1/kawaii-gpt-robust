/**
 * E-ORCH-1: provider construction + health for chat orchestrator.
 */
import {
  OpenAICompatibleProvider,
  ChatProvider
} from '@core/providers'
import { globalCircuitBreaker } from '@core/resilience'
import { AppError } from '@core/errors'
import type { Settings } from '@shared/types/settings'

export async function buildProviders(
  settings: Settings,
  apiKey?: string
): Promise<{
  local: ChatProvider | null
  cloud: ChatProvider | null
  localLabel?: string
  localDefaultModel?: string
}> {
  // LocalInferenceBackend: Ollama and/or LM Studio via one interface
  let local: ChatProvider | null = null
  let localLabel: string | undefined
  let localDefaultModel: string | undefined
  try {
    const pref =
      (settings as { localRuntimePreference?: 'auto' | 'ollama' | 'openai-compatible' })
        .localRuntimePreference || 'auto'
    let openAIUrl =
      ((settings as { localOpenAIBaseUrl?: string }).localOpenAIBaseUrl || '').trim() || undefined
    // Guard: never use Ollama port as LM Studio base
    if (openAIUrl && /:11434\b/.test(openAIUrl)) {
      openAIUrl = undefined
      try {
        const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
        useSettingsStore.getState().update({ localOpenAIBaseUrl: '' })
      } catch {
        /* */
      }
    }
    const modelName = (settings.localModel || '').trim()
    const modelPinned = Boolean(
      (settings as { localModelPinned?: boolean }).localModelPinned
    )
    const { createLocalBackend } = await import('@core/providers/local-backend')
    let created: Awaited<ReturnType<typeof createLocalBackend>> | null = null
    created = await createLocalBackend({
      preference: pref,
      ollamaBaseUrl: settings.localBaseUrl,
      openAIBaseUrl: openAIUrl,
      preferredModel: modelName,
      preferredPinned: modelPinned
    })
    const backend = created?.backend ?? null
    const status = created?.status ?? null
    const resolved = created?.resolved ?? null
    if (backend && status?.healthy) {
      local = backend.asChatProvider()
      localDefaultModel =
        created?.resolvedModelId || status.defaultModel || resolved?.defaultModel
      // Catalog id wins over stale settings (qwen3.5:9b → real LM Studio / Ollama id)
      const mid = created?.resolvedModelId || localDefaultModel || modelName
      localLabel = mid ? `${backend.label} · ${mid}` : backend.label
      if (created?.placementNote) {
        localLabel += ' · auto-match'
      }
      if (status.alsoAvailable?.length === 2) {
        localLabel += ' · ambos runtimes OK'
      }
      if (backend.kind === 'openai-compatible' && backend.baseUrl && !openAIUrl) {
        try {
          const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
          useSettingsStore.getState().update({
            localOpenAIBaseUrl: backend.baseUrl,
            localRuntimePreference: 'auto'
          })
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    local = null
    localLabel = undefined
    localDefaultModel = undefined
  }

  // No silent Ollama-only fallback: null → cloud or clear error

  const cloud = settings.cloudBaseUrl
    ? new OpenAICompatibleProvider({
        id: 'cloud',
        displayName: 'Cloud',
        baseUrl: settings.cloudBaseUrl,
        apiKey,
        timeoutMs: settings.cloudTimeoutMs
      })
    : null

  return { local, cloud, localLabel, localDefaultModel }
}

export async function checkAvailability(
  local: ChatProvider | null,
  cloud: ChatProvider | null
): Promise<{ localAvailable: boolean; cloudAvailable: boolean }> {
  const [l, c] = await Promise.all([
    local ? local.healthCheck().then((h) => h.ok).catch(() => false) : Promise.resolve(false),
    cloud && globalCircuitBreaker.canRequest(cloud.id)
      ? cloud.healthCheck().then((h) => h.ok).catch(() => false)
      : Promise.resolve(false)
  ])
  return { localAvailable: l, cloudAvailable: c }
}

export function isContextOrLimitError(err: AppError): boolean {
  return (
    err.code === 'CONTEXT_OVERFLOW' ||
    err.code === 'PROVIDER_RATE_LIMIT' ||
    err.code === 'PROVIDER_QUOTA'
  )
}

/** Prefer local for summarization (cheap/private); else cloud. */
export function pickSummarizer(
  local: ChatProvider | null,
  cloud: ChatProvider | null,
  localModel: string,
  cloudModel: string,
  localAvailable: boolean,
  cloudAvailable: boolean
): { provider: ChatProvider; model: string } | null {
  if (local && localModel && localAvailable) {
    return { provider: local, model: localModel }
  }
  if (cloud && cloudModel && cloudAvailable) {
    return { provider: cloud, model: cloudModel }
  }
  return null
}

