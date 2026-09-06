import { describe, expect, it } from 'vitest'
import { ModelRegistry } from './registry'

describe('ModelRegistry', () => {
  it('keeps an offline catalog and recommends compatible models', () => {
    const registry = new ModelRegistry()
    const recommendations = registry.recommend('chat', 8)
    expect(recommendations.length).toBeGreaterThan(0)
    expect(recommendations.every((model) => model.minRamGB <= 8)).toBe(true)
  })

  it('does not activate unknown or incapable models', () => {
    const registry = new ModelRegistry()
    expect(registry.setActive('vision', 'qwen2.5-3b-ollama')).toBe(false)
    expect(registry.setActive('chat', 'missing')).toBe(false)
  })

  it('rejects malformed remote catalogs without damaging the current one', () => {
    const registry = new ModelRegistry()
    const before = registry.getCatalog().catalogVersion
    expect(registry.loadCatalog({ schemaVersion: 1, catalogVersion: '' })).toBe(false)
    expect(registry.getCatalog().catalogVersion).toBe(before)
  })
})
