export type {
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatResult,
  ChatChunk,
  HealthResult
} from './types'
export { OpenAICompatibleProvider } from './openai-compatible'
export { OllamaProvider } from './ollama'
export { resolveLocalRuntime } from './resolve-local'
export type { ResolvedLocalRuntime, LocalRuntimeKind } from './resolve-local'

export {
  discoverLocalModels,
  discoverLocalModelsFull,
  mergeDiskIntoSnapshot
} from './discover-local'
export type {
  LocalModelEntry,
  LocalModelsSnapshot,
  LocalModelSource,
  DiskModelHit
} from './discover-local'

export {
  createLocalBackend,
  backendFromResolved,
  probeLocalBackends
} from './local-backend'
export type {
  LocalInferenceBackend,
  LocalBackendStatus,
  LocalModelInfo,
  LocalBackendKind
} from './local-backend'

export {
  unifiedPullModel,
  bridgesFromWindow,
  type UnifiedPullResult,
  type UnifiedPullOptions,
  type PullAttempt
} from './local-pull'

export * from './lmstudio-ports'
