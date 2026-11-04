import { describe, it, expect } from 'vitest'
import { validatePluginManifest, normalizePluginManifest } from './validate'

describe('plugin validate', () => {
  it('accepts minimal valid manifest', () => {
    const r = validatePluginManifest({
      id: 'demo_tool',
      name: 'Demo',
      tools: [{ name: 'demo_run', description: 'x' }]
    })
    expect(r.ok).toBe(true)
    expect(r.normalized?.id).toBe('demo_tool')
  })

  it('rejects bad id', () => {
    const r = validatePluginManifest({ id: '1bad', name: 'X', tools: ['a'] })
    expect(r.ok).toBe(false)
  })

  it('normalizes string tools', () => {
    const n = normalizePluginManifest({ id: 'ok_id', name: 'Ok', tools: ['alpha_tool'] })
    expect(n.tools?.[0]?.name).toBe('alpha_tool')
  })

  it('respects enabled false', () => {
    const n = normalizePluginManifest({
      id: 'off_plug',
      name: 'Off',
      tools: ['t'],
      enabled: false
    })
    expect(n.enabled).toBe(false)
  })
})
