export type AppStatusSnapshot = {
  version?: string
  providerMode?: string
  localModel?: string
  localOk?: boolean | null
  cloudEnabled?: string[]
  cloudKeys?: string[]
  imageGen?: boolean
  imageEnabled?: boolean
  imageMode?: string
  musicEnabled?: boolean
  forgeState?: string
  forgeApi?: string | null
  characterName?: string
  notes?: string[]
  [key: string]: unknown
}

export function formatStatusForPrompt(snap: AppStatusSnapshot): string {
  const layers = snap.layers
  if (Array.isArray(layers) && layers.length) {
    const extra = snap.notes?.length ? `notes: ${snap.notes.slice(0, 8).join(' · ')}` : ''
    return [...layers, extra].filter(Boolean).join(' | ')
  }
  const lines = [
    `version=${snap.version ?? '?'}`,
    `localOk=${snap.localOk ?? '?'}`,
    `localModel=${snap.localModel ?? ''}`,
    `forge=${snap.forgeState ?? 'unknown'}`,
    `image=${snap.imageGen ?? snap.imageEnabled ?? '?'}`,
    `music=${snap.musicRunning ?? snap.musicEnabled ?? '?'}`,
    `voice=${snap.voiceReady ?? '?'}`,
    `cloudKeys=${(snap.cloudEnabled || snap.cloudKeys || []).join(',') || 'none'} (not local models)`
  ]
  if (snap.notes?.length) lines.push(`notes: ${snap.notes.slice(0, 8).join(' · ')}`)
  return lines.join('\n')
}

export class AgentAuditLog {
  private lines: string[] = []
  push(line: string) {
    this.lines.push(`${new Date().toISOString()} ${line}`)
    if (this.lines.length > 200) this.lines.shift()
  }
  export(): string {
    return this.lines.join('\n')
  }
  clear() {
    this.lines = []
  }
}

export type AppToolName =
  | 'get_app_status'
  | 'health_forge'
  | 'start_forge'
  | 'start_music'
  | 'stop_music'
  | 'voice_ensure'
  | 'start_ollama'
  | 'list_models'
  | 'list_installed_models'
  | 'recommend_model'
  | 'auto_route_model'
  | 'check_local_runtime'
  | 'list_download_jobs'
  | 'download_model'
  | 'resume_download'
  | 'delete_model'
  | 'run_diagnosis'
  | 'open_settings_hint'
  | string

export type AppToolCall = {
  tool: AppToolName
  args?: Record<string, unknown>
}


/** Remove APP_ACTION / APP_PLAN / raw plan JSON so they never show in the chat UI. */
export function stripHarnessMarkup(text: string): string {
  let t = text || ''
  t = t.replace(/<<<APP_ACTION>>>[\s\S]*?(<<<END_APP_ACTION>>>|$)/gi, '')
  t = t.replace(/<<<APP_PLAN>>>[\s\S]*?(<<<END_APP_PLAN>>>|$)/gi, '')
  t = t.replace(/<<<END_APP_ACTION>>>/gi, '')
  t = t.replace(/<<<END_APP_PLAN>>>/gi, '')
  t = t.replace(/<<<APP_(ACTION|PLAN)>>>[\s\S]*$/i, '')
  // Single-tool JSON blobs
  t = t.replace(/\{\s*"tool"\s*:\s*"[^"]+"[^}]*\}/g, '')
  // Full or partial plan JSON the model dumps without markers
  t = t.replace(
    /\{\s*"goal"\s*:\s*"[^"]*"\s*,\s*"steps"\s*:\s*\[[\s\S]*?\]\s*(,\s*"[^"]+"\s*:\s*[^}]*)?\}/g,
    ''
  )
  // Incomplete plan JSON still streaming (goal present, steps cut off)
  t = t.replace(/\{\s*"goal"\s*:\s*"[^"]*"\s*,\s*"steps"\s*:\s*\[[\s\S]*$/g, '')
  t = t.replace(/\{\s*"goal"\s*:\s*"[^"]*"\s*,?\s*$/g, '')
  // Orphaned goal/steps fragments
  t = t.replace(/^\s*"goal"\s*:\s*"[^"]*"\s*,?\s*/gm, '')
  t = t.replace(/^\s*"steps"\s*:\s*\[[\s\S]*$/gm, '')
  return t.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

export function parseAppActions(text: string): { cleanText: string; actions: AppToolCall[] } {
  const actions: AppToolCall[] = []
  let clean = text || ''
  const blockRe = /<<<APP_ACTION>>>\s*([\s\S]*?)\s*<<<END_APP_ACTION>>>/gi
  clean = clean.replace(blockRe, (_, body: string) => {
    try {
      const parsed = JSON.parse(String(body).trim()) as AppToolCall
      if (parsed?.tool) actions.push({ tool: parsed.tool, args: parsed.args })
    } catch {
      /* ignore */
    }
    return ''
  })
  const lineRe = /\{\s*"tool"\s*:\s*"([^"]+)"[^}]*\}/g
  clean = clean.replace(lineRe, (full) => {
    try {
      const parsed = JSON.parse(full) as AppToolCall
      if (parsed.tool) {
        actions.push(parsed)
        return ''
      }
    } catch {
      /* keep */
    }
    return full
  })
  return { cleanText: stripHarnessMarkup(clean).trim(), actions }
}

export type AgentTool = {
  name: string
  description?: string
  risk?: 'read' | 'reversible' | 'resource' | 'destructive'
  run?: (args?: Record<string, unknown>) => Promise<{ ok: boolean; summary?: string; output?: unknown }>
  execute?: (args?: Record<string, unknown>) => Promise<{ ok: boolean; summary?: string; output?: unknown }>
}

export type AgentRuntimeOptions = {
  maxSteps?: number
  timeoutMs?: number
  approve?: (tool: AgentTool) => Promise<boolean>
  audit?: AgentAuditLog
}

export class AgentRuntime {
  private tools = new Map<string, AgentTool>()
  private maxSteps: number
  private timeoutMs: number
  private approve?: (tool: AgentTool) => Promise<boolean>
  private audit: AgentAuditLog

  constructor(opts?: AgentRuntimeOptions) {
    this.maxSteps = opts?.maxSteps ?? 4
    this.timeoutMs = opts?.timeoutMs ?? 30_000
    this.approve = opts?.approve
    this.audit = opts?.audit || new AgentAuditLog()
  }

  register(tool: AgentTool) {
    this.tools.set(tool.name, tool)
  }

  async run(
    calls: Array<{ tool: string; args?: Record<string, unknown>; input?: Record<string, unknown> }>
  ): Promise<{
    steps: Array<{
      tool: string
      ok: boolean
      error?: string
      durationMs: number
      output?: unknown
    }>
    stoppedReason?: string
  }> {
    const out: Array<{
      tool: string
      ok: boolean
      error?: string
      durationMs: number
      output?: unknown
    }> = []
    const slice = calls.slice(0, this.maxSteps)
    for (const call of slice) {
      const tool = this.tools.get(call.tool)
      const t0 = Date.now()
      if (!tool) {
        out.push({ tool: call.tool, ok: false, error: 'unknown tool', durationMs: 0 })
        continue
      }
      try {
        if (this.approve && !(await this.approve(tool))) {
          out.push({
            tool: call.tool,
            ok: false,
            error: 'resource_action_requires_approval',
            durationMs: Date.now() - t0
          })
          continue
        }
        const fn = tool.execute || tool.run
        const args = call.args || call.input
        const result = await Promise.race([
          fn
            ? fn(args)
            : Promise.resolve({ ok: false, summary: 'no handler' }),
          new Promise<{ ok: false; summary: string }>((resolve) =>
            setTimeout(() => resolve({ ok: false, summary: 'timeout' }), this.timeoutMs)
          )
        ])
        this.audit.push(`${call.tool} ok=${result.ok} ${result.summary || ''}`)
        out.push({
          tool: call.tool,
          ok: result.ok,
          output: result,
          durationMs: Date.now() - t0,
          error: result.ok ? undefined : result.summary
        })
      } catch (e) {
        out.push({
          tool: call.tool,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - t0
        })
      }
    }
    return {
      steps: out,
      stoppedReason: calls.length > this.maxSteps ? 'max_steps' : undefined
    }
  }
}

export * from './planner'
export * from './failure-memory'
export * from './success-memory'
export * from './data-cleanup'
