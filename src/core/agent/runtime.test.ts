import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AgentRuntime } from './runtime'

describe('AgentRuntime', () => {
  it('validates tools and executes bounded multi-step calls', async () => {
    const runtime = new AgentRuntime({ maxSteps: 2 })
    runtime.register({
      name: 'echo',
      description: 'Returns text',
      risk: 'read',
      input: z.object({ text: z.string().min(1) }),
      execute: async ({ text }) => text
    })

    const result = await runtime.run([
      { tool: 'echo', input: { text: 'one' } },
      { tool: 'echo', input: { text: 'two' } },
      { tool: 'echo', input: { text: 'three' } }
    ])

    expect(result.ok).toBe(true)
    expect(result.steps).toHaveLength(2)
    expect(result.stoppedReason).toBe('max_steps')
  })

  it('blocks resource actions until policy grants them', async () => {
    const runtime = new AgentRuntime()
    runtime.register({
      name: 'download',
      description: 'Downloads a model',
      risk: 'resource',
      input: z.object({ id: z.string() }),
      execute: async () => ({ downloaded: true })
    })

    const result = await runtime.run([{ tool: 'download', input: { id: 'model' } }])

    expect(result.ok).toBe(false)
    expect(result.stoppedReason).toBe('policy')
    expect(result.steps[0]?.error).toBe('resource_action_requires_approval')
  })

  it('executes a resource action only after explicit approval', async () => {
    const runtime = new AgentRuntime({
      approve: async (tool) => tool.name === 'download'
    })
    runtime.register({
      name: 'download',
      description: 'Downloads a model',
      risk: 'resource',
      input: z.object({ id: z.string() }),
      execute: async () => ({ downloaded: true })
    })

    const result = await runtime.run([{ tool: 'download', input: { id: 'model' } }])

    expect(result.ok).toBe(true)
    expect(result.steps[0]?.output).toEqual({ downloaded: true })
  })
})
