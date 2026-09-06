import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AgentRuntime } from './runtime'
import { runAgentLoop } from './loop'

describe('runAgentLoop', () => {
  it('returns tool results to the next decision turn', async () => {
    const runtime = new AgentRuntime()
    runtime.register({
      name: 'status',
      description: 'status',
      risk: 'read',
      input: z.object({}),
      execute: async () => ({ ready: true })
    })
    let observed = ''
    const result = await runAgentLoop({
      runtime,
      initialObservation: 'start',
      maxTurns: 3,
      driver: {
        decide: async (observation) => observation.includes('ready') ? [] : [{ tool: 'status', input: {} }],
        observe: (run) => { observed = JSON.stringify(run.steps[0]?.output); return observed }
      }
    })
    expect(result.ok).toBe(true)
    expect(result.turns).toBe(1)
    expect(observed).toContain('ready')
  })
})
