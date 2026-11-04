import { describe, expect, it } from 'vitest'
import { buildDecisionPacket } from '@core/agent/decision-packet'
import { buildTurnSystemLayers } from './turn-system-layers'

describe('buildTurnSystemLayers', () => {
  it('skips library catalog on pure chat packet', async () => {
    const packet = buildDecisionPacket({ userText: 'hola qué tal' })
    expect(packet.inject.library).toBe(false)
    const text = await buildTurnSystemLayers({
      trimmed: 'hola qué tal',
      hasMediaJob: false,
      decisionPacket: packet,
      buildAppAgentSystemBlock: async () => 'FULL_HARNESS_SHOULD_NOT_APPEAR'
    })
    expect(text).not.toMatch(/FULL_HARNESS_SHOULD_NOT_APPEAR/)
    expect(text).toMatch(/HARNESS — mínimo|Identidad|hora|Clima|$/i)
  })
})
