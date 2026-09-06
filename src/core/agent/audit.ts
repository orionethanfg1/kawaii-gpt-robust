import { z } from 'zod'
import type { AgentRisk, AgentStepRecord } from './runtime'

export const AgentAuditEntrySchema = z.object({
  id: z.string(),
  at: z.number().int().nonnegative(),
  tool: z.string(),
  risk: z.custom<AgentRisk>(),
  input: z.unknown(),
  output: z.unknown().optional(),
  ok: z.boolean(),
  approved: z.boolean(),
  durationMs: z.number().nonnegative()
})
export type AgentAuditEntry = z.infer<typeof AgentAuditEntrySchema>

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/(api[_-]?key|token|authorization|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]')
  }
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const [key, item] of Object.entries(value)) {
      result[key] = /key|token|secret|authorization/i.test(key) ? '[redacted]' : redact(item)
    }
    return result
  }
  return value
}

export class AgentAuditLog {
  private entries: AgentAuditEntry[] = []

  record(step: AgentStepRecord, approved: boolean): AgentAuditEntry {
    const entry: AgentAuditEntry = {
      id: `${Date.now()}-${this.entries.length}`,
      at: Date.now(),
      tool: step.tool,
      risk: step.risk,
      input: redact(step.input),
      output: redact(step.output),
      ok: step.ok,
      approved,
      durationMs: step.durationMs
    }
    this.entries = [...this.entries, entry].slice(-500)
    return entry
  }

  list(): AgentAuditEntry[] { return [...this.entries] }
  clear(): void { this.entries = [] }
  export(): string { return JSON.stringify(this.entries, null, 2) }
}
