import type { AgentRunResult, AgentRuntime } from './runtime'

export interface AgentLoopTurn {
  tool: string
  input?: unknown
}

export interface AgentLoopDriver {
  decide: (observation: string, signal: AbortSignal) => Promise<AgentLoopTurn[]>
  observe: (result: AgentRunResult) => string
}

export interface AgentLoopResult {
  ok: boolean
  turns: number
  runs: AgentRunResult[]
  stoppedReason?: 'completed' | 'max_turns' | 'cancelled' | 'error'
}

export async function runAgentLoop(options: {
  runtime: AgentRuntime
  driver: AgentLoopDriver
  initialObservation: string
  maxTurns?: number
  signal?: AbortSignal
}): Promise<AgentLoopResult> {
  const maxTurns = Math.max(1, options.maxTurns ?? 3)
  const runs: AgentRunResult[] = []
  let observation = options.initialObservation

  for (let turn = 0; turn < maxTurns; turn++) {
    if (options.signal?.aborted) {
      return { ok: false, turns: turn, runs, stoppedReason: 'cancelled' }
    }
    const calls = await options.driver.decide(observation, options.signal ?? new AbortController().signal)
    if (calls.length === 0) return { ok: true, turns: turn, runs, stoppedReason: 'completed' }
    const result = await options.runtime.run(calls, options.signal)
    runs.push(result)
    if (!result.ok) return { ok: false, turns: turn + 1, runs, stoppedReason: 'error' }
    observation = options.driver.observe(result)
  }

  return { ok: false, turns: maxTurns, runs, stoppedReason: 'max_turns' }
}
