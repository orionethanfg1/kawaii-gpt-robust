import { describe, it, expect } from 'vitest'
import { buildToolCatalog, formatToolCatalogForLlm, formatToolCatalogSummary } from './tool-catalog'

describe('PLUG tool-catalog', () => {
  it('builds catalog from builtin capabilities', () => {
    const cat = buildToolCatalog([])
    expect(cat.length).toBeGreaterThan(3)
    expect(cat.some((t) => t.name === 'get_app_status' || t.name.includes('forge'))).toBe(true)
  })

  it('merges disk manifests', () => {
    const cat = buildToolCatalog([
      {
        id: 'demo',
        name: 'Demo',
        tools: [{ name: 'demo_tool', description: 'x' }],
        summary: 'demo'
      }
    ])
    expect(cat.some((t) => t.name === 'demo_tool')).toBe(true)
  })

  it('formats human LLM brief', () => {
    const s = formatToolCatalogForLlm([])
    expect(s.length).toBeGreaterThan(20)
    expect(s).toMatch(/herramientas|Grupos|host/i)
  })

  it('summary line', () => {
    expect(formatToolCatalogSummary([])).toMatch(/Plugins/)
  })
})
