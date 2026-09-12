import { describe, expect, it } from 'vitest'
import { buildIpAdapterConfig, pickIpAdapterModel } from './ip-adapter'

describe('local IP-Adapter selection', () => {
  it('prefers FaceID over a generic adapter', () => {
    expect(
      pickIpAdapterModel(['ip-adapter_sd15.safetensors', 'ip-adapter-faceid-plusv2_sd15.safetensors'])
    ).toEqual({
      name: 'ip-adapter-faceid-plusv2_sd15.safetensors',
      kind: 'faceid'
    })
  })

  it('builds a bounded ControlNet payload', () => {
    const config = buildIpAdapterConfig(
      { name: 'ip-adapter-faceid-plusv2_sd15.safetensors', kind: 'faceid' },
      'data:image/png;base64,abc',
      2
    )
    expect(config.module).toBe('ip-adapter-faceid-plusv2_sd15')
    expect(config.weight).toBe(1.2)
    expect(config.image).toContain('data:image/png')
  })
})