import type { ModelCapability, ModelDescriptor, ModelRegistry } from '@core/models'

export type TaskKind = ModelCapability | 'general'

export interface CapabilityRoute {
  task: TaskKind
  model?: ModelDescriptor
  reason: string
}

export function routeByCapability(input: {
  registry: ModelRegistry
  task: TaskKind
  ramGB?: number
  preferredModelId?: string
}): CapabilityRoute {
  if (input.preferredModelId) {
    const preferred = input.registry.find(input.preferredModelId)
    if (preferred && (input.task === 'general' || preferred.capabilities.includes(input.task))) {
      return { task: input.task, model: preferred, reason: 'modelo preferido compatible' }
    }
  }
  if (input.task === 'general') {
    const model = input.registry.recommend('chat', input.ramGB)[0]
    return { task: input.task, model, reason: model ? 'chat compatible por hardware' : 'sin modelo local compatible' }
  }
  const model = input.registry.recommend(input.task, input.ramGB)[0]
  return { task: input.task, model, reason: model ? `capacidad ${input.task} compatible` : `sin modelo con capacidad ${input.task}` }
}
