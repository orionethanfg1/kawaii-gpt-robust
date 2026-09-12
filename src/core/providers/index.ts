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

export { discoverLocalModels } from './discover-local'
export type { LocalModelEntry, LocalModelsSnapshot } from './discover-local'
