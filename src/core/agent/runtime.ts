import { z } from 'zod'

export const AgentRiskSchema = z.enum(['read', 'reversible', 'resource', 'destructive'])
export type AgentRisk = z.infer<typeof AgentRiskSchema>

export interface AgentToolContext { signal: AbortSignal }

export interface AgentTool<I = unknown, O = unknown> {
  name: string
  description: string
  risk: AgentRisk
  input: z.ZodType<I>
  execute: (input: I, context: AgentToolContext) => Promise<O>
}

export interface AgentPolicy {
  maxSteps: number
  timeoutMs: number
  allowResourceActions: boolean
  allowDestructiveActions: boolean
  approve?: (tool: AgentTool, input: unknown) => boolean | Promise<boolean>
}

export interface AgentStepRecord {
  tool: string
  risk: AgentRisk
  input: unknown
  output?: unknown
  ok: boolean
  error?: string
  durationMs: number
}

export interface AgentRunResult {
  ok: boolean
  steps: AgentStepRecord[]
  stoppedReason?: 'max_steps' | 'timeout' | 'cancelled' | 'policy' | 'error'
}

const DEFAULT_POLICY: AgentPolicy = {
  maxSteps: 4,
  timeoutMs: 30_000,
  allowResourceActions: false,
  allowDestructiveActions: false
}

export class AgentRuntime {
  private readonly tools = new Map<string, AgentTool<any, any>>()
  private readonly policy: AgentPolicy

  constructor(policy: Partial<AgentPolicy> = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy }
  }

  register<I, O>(tool: AgentTool<I, O>): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`)
    this.tools.set(tool.name, tool)
  }

  listTools(): Array<Pick<AgentTool, 'name' | 'description' | 'risk'>> {
    return [...this.tools.values()].map(({ name, description, risk }) => ({ name, description, risk }))
  }

  async run(calls: Array<{ tool: string; input?: unknown }>, signal?: AbortSignal): Promise<AgentRunResult> {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), this.policy.timeoutMs)
    const steps: AgentStepRecord[] = []

    try {
      for (const call of calls.slice(0, this.policy.maxSteps)) {
        if (controller.signal.aborted) return { ok: false, steps, stoppedReason: signal?.aborted ? 'cancelled' : 'timeout' }
        const tool = this.tools.get(call.tool)
        if (!tool) {
          steps.push({ tool: call.tool, risk: 'read', input: call.input, ok: false, error: 'unknown_tool', durationMs: 0 })
          return { ok: false, steps, stoppedReason: 'error' }
        }
        const approved = this.policy.approve
          ? await this.policy.approve(tool, call.input)
          : false
        if (tool.risk === 'resource' && !this.policy.allowResourceActions && !approved) {
          steps.push({ tool: tool.name, risk: tool.risk, input: call.input, ok: false, error: 'resource_action_requires_approval', durationMs: 0 })
          return { ok: false, steps, stoppedReason: 'policy' }
        }
        if (tool.risk === 'destructive' && !this.policy.allowDestructiveActions && !approved) {
          steps.push({ tool: tool.name, risk: tool.risk, input: call.input, ok: false, error: 'destructive_action_requires_approval', durationMs: 0 })
          return { ok: false, steps, stoppedReason: 'policy' }
        }
        const parsed = tool.input.safeParse(call.input ?? {})
        if (!parsed.success) {
          steps.push({ tool: tool.name, risk: tool.risk, input: call.input, ok: false, error: 'invalid_input', durationMs: 0 })
          return { ok: false, steps, stoppedReason: 'error' }
        }
        const started = Date.now()
        try {
          const output = await tool.execute(parsed.data, { signal: controller.signal })
          steps.push({ tool: tool.name, risk: tool.risk, input: parsed.data, output, ok: true, durationMs: Date.now() - started })
        } catch (error) {
          steps.push({ tool: tool.name, risk: tool.risk, input: parsed.data, ok: false, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started })
          return { ok: false, steps, stoppedReason: 'error' }
        }
      }
      return { ok: true, steps, stoppedReason: calls.length > this.policy.maxSteps ? 'max_steps' : undefined }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}
