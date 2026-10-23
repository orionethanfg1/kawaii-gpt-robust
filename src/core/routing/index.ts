export * from './types'
export { decideRoute, routeTargetToProviderKind } from './engine'
export * from './capability'

export type { RoutingContext, RouteTarget } from './types'
export * from './task-route'
export {
  decideAutoRoute,
  applyStickyFromDecision,
  type ModelRouterDecision,
  type ModelRouterInput
} from './model-router'
export {
  armIntimateSticky,
  clearIntimateSticky,
  isIntimateStickyActive,
  onConversationChanged,
  onAdultOptInChanged,
  INTIMATE_STICKY_MS
} from './intimate-sticky'
