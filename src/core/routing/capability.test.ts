import { describe, expect, it } from 'vitest'
import { ModelRegistry } from '@core/models'
import { routeByCapability } from './capability'

describe('routeByCapability', () => {
  it('selects a model by task capability and explains the choice', () => {
    const route = routeByCapability({ registry: new ModelRegistry(), task: 'code', ramGB: 8 })
    expect(route.model?.id).toBe('qwen2.5-3b-ollama')
    expect(route.reason).toContain('code')
  })
})
