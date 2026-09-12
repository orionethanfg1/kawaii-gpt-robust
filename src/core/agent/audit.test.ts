import { describe, expect, it } from 'vitest'
import { AgentAuditLog } from './audit'

describe('AgentAuditLog', () => {
  it('redacts secret-like values', () => {
    const log = new AgentAuditLog()
    log.record({ tool: 'test', risk: 'reversible', input: { apiKey: 'secret' }, output: { text: 'ok' }, ok: true, durationMs: 2 }, true)
    expect(log.export()).not.toContain('secret')
    expect(log.list()).toHaveLength(1)
  })
})
