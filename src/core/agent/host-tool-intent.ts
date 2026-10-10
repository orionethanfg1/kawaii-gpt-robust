import { isHostOnlyToolQuery, suggestPlanFromUserGoal } from './planner'

export function isHostToolIntent(text: string): boolean {
  return isHostOnlyToolQuery(text) || Boolean(suggestPlanFromUserGoal(text))
}
