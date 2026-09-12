/**
 * Multi-step harness planner: ordered tool plans with fail policies.
 */

export type PlanFailPolicy = 'continue' | 'stop' | 'skip_rest'

export type PlanStep = {
  tool: string
  args?: Record<string, unknown>
  /** What to do if this step fails (default: continue for read, stop for resource starts) */
  onFail?: PlanFailPolicy
  /** Human label for logs */
  why?: string
}

export type AgentPlan = {
  goal: string
  steps: PlanStep[]
  source: 'model' | 'host' | 'actions'
}

export type PlanStepResult = {
  tool: string
  ok: boolean
  error?: string
  durationMs: number
  output?: unknown
  skipped?: boolean
}

const DEFAULT_ON_FAIL: Record<string, PlanFailPolicy> = {
  start_forge: 'stop',
  start_music: 'stop',
  start_ollama: 'continue',
  download_model: 'stop',
  delete_model: 'stop',
  health_forge: 'continue',
  check_local_runtime: 'continue',
  get_app_status: 'continue',
  run_diagnosis: 'continue'
}

export function defaultOnFail(tool: string): PlanFailPolicy {
  return DEFAULT_ON_FAIL[tool] || 'continue'
}

/** Parse <<<APP_PLAN>>> JSON block from model output */
export function parseAppPlan(text: string): { cleanText: string; plan: AgentPlan | null } {
  let clean = text || ''
  let plan: AgentPlan | null = null
  const re = /<<<APP_PLAN>>>\s*([\s\S]*?)\s*<<<END_APP_PLAN>>>/gi
  clean = clean.replace(re, (_, body: string) => {
    try {
      const raw = JSON.parse(String(body).trim()) as {
        goal?: string
        steps?: Array<{ tool?: string; args?: Record<string, unknown>; onFail?: PlanFailPolicy; why?: string }>
      }
      const steps: PlanStep[] = (raw.steps || [])
        .filter((s) => s && typeof s.tool === 'string' && s.tool.trim())
        .map((s) => ({
          tool: String(s.tool).trim(),
          args: s.args,
          onFail: s.onFail,
          why: s.why
        }))
      if (steps.length) {
        plan = {
          goal: String(raw.goal || '').slice(0, 400),
          steps,
          source: 'model'
        }
      }
    } catch {
      /* ignore malformed plan */
    }
    return ''
  })
  // Light clean of residual plan markers (full strip is stripHarnessMarkup in UI)
  clean = clean
    .replace(/<<<APP_PLAN>>>[\s\S]*?(<<<END_APP_PLAN>>>|$)/gi, '')
    .replace(/\{\s*"goal"\s*:\s*"[^"]*"\s*,\s*"steps"\s*:\s*\[[\s\S]*$/g, '')
  return { cleanText: clean.trim(), plan }
}

/** Turn a flat list of tool calls into an ordered plan */
export function planFromActions(
  actions: Array<{ tool: string; args?: Record<string, unknown> }>,
  goal = ''
): AgentPlan | null {
  if (!actions.length) return null
  return {
    goal,
    source: 'actions',
    steps: actions.map((a) => ({
      tool: a.tool,
      args: a.args,
      onFail: defaultOnFail(String(a.tool))
    }))
  }
}

/**
 * Host-side heuristic planner when the model asks for multi-step work
 * but forgets to emit APP_PLAN / APP_ACTION.
 */
export function suggestPlanFromUserGoal(userGoal: string): AgentPlan | null {
  const g = (userGoal || '').toLowerCase()
  if (!g.trim()) return null

  // Rename chat — extract ONLY the new title (not "este chat a …")
  if (/renombra|cambia(?:r)?\s+(?:el\s+)?(?:nombre|t[ií]tulo)|pon(?:le)?\s+de\s+t[ií]tulo|title\s+/i.test(userGoal)) {
    let title = ''
    const patterns = [
      /renombra(?:r)?\s+(?:este\s+)?(?:chat|conversaci[oó]n)\s+a\s+[«"']?([^»"'\n]+?)[«"']?\s*$/i,
      /(?:nombre|t[ií]tulo)\s+(?:del\s+chat\s+)?(?:a|como|→|->)\s+[«"']?([^»"'\n]+?)[«"']?\s*$/i,
      /pon(?:le)?\s+(?:de\s+)?(?:nombre|t[ií]tulo)\s+[«"']?([^»"'\n]+?)[«"']?\s*$/i,
      /a\s+[«"']([^»"']+)[«"']/i
    ]
    for (const re of patterns) {
      const m = userGoal.match(re)
      if (m && m[1]) {
        title = m[1].trim()
        break
      }
    }
    // Strip leftover "este chat a" if still present
    title = title
      .replace(/^(?:este\s+)?(?:chat|conversaci[oó]n)\s+a\s+/i, '')
      .replace(/^[«"']|[»"']$/g, '')
      .trim()
      .slice(0, 60)
    if (!title) title = 'Conversación'
    return {
      goal: `renombrar chat a ${title}`,
      source: 'host' as const,
      steps: [{ tool: 'rename_conversation', args: { title }, onFail: 'continue' as const }]
    }
  }
  if (/limpia(?:r)?\s+(?:los\s+)?logs|borra(?:r)?\s+(?:el\s+)?historial\s+de\s+(?:tests|errores)|clear.?logs|autolimpieza/i.test(g)) {
    return {
      goal: 'limpiar logs y diagnósticos viejos',
      source: 'host' as const,
      steps: [
        { tool: 'list_app_logs', onFail: 'continue' as const },
        { tool: 'clear_app_logs', args: { mode: 'soft' }, onFail: 'continue' as const }
      ]
    }
  }


  const wantsStatus = /estado|status|qu[eé] hay|diagn[oó]stic|revisa la app|autodiagn/.test(g)
  const wantsForge =
    /forge|stable diffusion|genera(r)? imagen|capa de imagen|sd local|webui/.test(g) &&
    (/arranc|inic|levant|start|prepara|activa|usa local|revisa|estado|corri?endo|fallo|error/.test(g) ||
      /forge/.test(g))
  // "revisa Forge y modelos" → también listar modelos
  const wantsForgeAndModels = /forge/.test(g) && /modelos/.test(g)
  const wantsMusic =
    /m[uú]sica|ace|canci[oó]n|pista de audio/.test(g) &&
    /arranc|inic|levant|start|prepara|genera/.test(g)
  const wantsLocal =
    /ollama|modelo local|lm studio|runtime local/.test(g) &&
    /arranc|inic|lista|qu[eé] modelos|no responde/.test(g)
  const wantsModels = /qu[eé] modelos|lista.*modelos|modelos (instalados|disponibles|que tenemos)|dame.*modelos|modelos que tenemos|recomienda.*modelo|\bmodelos\b.*\b(lista|listar|tenemos|hay)\b/.test(g)
  const wantsVoice = /voz|tts|habla|motor de voz/.test(g) && /instala|prepara|arranc|activa/.test(g)

  const steps: PlanStep[] = []

  if (wantsStatus || wantsForge || wantsMusic || wantsLocal) {
    steps.push({ tool: 'get_app_status', onFail: 'continue', why: 'baseline' })
  }
  if (wantsLocal || wantsModels || wantsForgeAndModels) {
    steps.push({ tool: 'check_local_runtime', onFail: 'continue', why: 'runtime' })
    if (/arranc|inic|start|no responde/.test(g)) {
      steps.push({ tool: 'start_ollama', onFail: 'continue', why: 'try start ollama' })
    }
    steps.push({ tool: 'list_installed_models', onFail: 'continue', why: 'list' })
  }
  if (wantsModels && !wantsLocal) {
    steps.push({ tool: 'list_installed_models', onFail: 'continue' })
    steps.push({ tool: 'recommend_model', args: { task: 'chat' }, onFail: 'continue' })
  }
  if (wantsForge) {
    steps.push({ tool: 'health_forge', onFail: 'continue', why: 'probe' })
    steps.push({ tool: 'start_forge', onFail: 'stop', why: 'ensure image layer' })
    steps.push({ tool: 'health_forge', onFail: 'continue', why: 'verify' })
  }
  if (wantsMusic) {
    steps.push({ tool: 'start_music', onFail: 'stop', why: 'ensure music layer' })
  }
  if (wantsVoice) {
    steps.push({ tool: 'voice_ensure', onFail: 'continue', why: 'tts' })
  }
  if (wantsStatus && steps.length <= 1) {
    steps.push({ tool: 'run_diagnosis', onFail: 'continue', why: 'full check' })
  }

  // Deduplicate consecutive same tool
  const dedup: PlanStep[] = []
  for (const s of steps) {
    const last = dedup[dedup.length - 1]
    if (last && last.tool === s.tool && JSON.stringify(last.args) === JSON.stringify(s.args)) continue
    dedup.push(s)
  }

  if (!dedup.length) return null
  return {
    goal: userGoal.slice(0, 400),
    steps: dedup.slice(0, 8),
    source: 'host'
  }
}

export type PlanExecutor = (
  step: PlanStep
) => Promise<{ ok: boolean; summary?: string; output?: unknown; error?: string }>

/**
 * Execute plan sequentially with onFail policies.
 */
export async function executePlan(
  plan: AgentPlan,
  exec: PlanExecutor,
  opts?: { maxSteps?: number }
): Promise<{ results: PlanStepResult[]; stoppedReason?: string }> {
  const max = opts?.maxSteps ?? 8
  const results: PlanStepResult[] = []
  let skipRest = false

  for (const step of plan.steps.slice(0, max)) {
    if (skipRest) {
      results.push({
        tool: String(step.tool),
        ok: false,
        skipped: true,
        durationMs: 0,
        error: 'skipped_after_failure'
      })
      continue
    }
    const t0 = Date.now()
    try {
      const r = await exec(step)
      const ok = Boolean(r.ok)
      results.push({
        tool: String(step.tool),
        ok,
        durationMs: Date.now() - t0,
        output: r.output ?? { ok, summary: r.summary },
        error: ok ? undefined : r.error || r.summary || 'failed'
      })
      if (!ok) {
        const policy = step.onFail || defaultOnFail(String(step.tool))
        if (policy === 'stop') {
          return { results, stoppedReason: `stop_on_fail:${step.tool}` }
        }
        if (policy === 'skip_rest') skipRest = true
      }
    } catch (e) {
      results.push({
        tool: String(step.tool),
        ok: false,
        durationMs: Date.now() - t0,
        error: e instanceof Error ? e.message : String(e)
      })
      const policy = step.onFail || defaultOnFail(String(step.tool))
      if (policy === 'stop') return { results, stoppedReason: `stop_on_fail:${step.tool}` }
      if (policy === 'skip_rest') skipRest = true
    }
  }

  if (plan.steps.length > max) {
    return { results, stoppedReason: 'max_steps' }
  }
  return { results }
}

export function formatPlanForLog(plan: AgentPlan): string {
  return `plan[${plan.source}] "${plan.goal.slice(0, 80)}" → ${plan.steps.map((s) => s.tool).join(' → ')}`
}

/** Live status snapshot used to rewrite plans before/during execution */
export type LiveAppStatus = {
  forgeState?: string
  forgeOk?: boolean
  localOk?: boolean | null
  musicRunning?: boolean
  localModel?: string
  notes?: string[]
}

/**
 * Drop or rewrite steps that are redundant given current app state.
 * Example: skip start_forge if Forge is already running and healthy.
 */
export function refinePlanWithLiveStatus(plan: AgentPlan, status: LiveAppStatus): AgentPlan {
  const forgeUp =
    status.forgeOk === true ||
    status.forgeState === 'running' ||
    status.forgeState === 'ready'
  const forgeStarting = status.forgeState === 'starting'
  const forgeBad = status.forgeState === 'error' || status.forgeState === 'stopped'
  const localUp = status.localOk === true
  const musicUp = status.musicRunning === true

  const steps: PlanStep[] = []
  for (const step of plan.steps) {
    const tool = String(step.tool)
    if (tool === 'start_forge') {
      if (forgeUp) {
        steps.push({
          tool: 'health_forge',
          onFail: 'continue',
          why: 'Forge ya running — solo verificar API'
        })
        continue
      }
      if (forgeStarting) {
        steps.push({
          tool: 'health_forge',
          onFail: 'continue',
          why: 'Forge arrancando — esperar health'
        })
        continue
      }
    }
    if (tool === 'stop_forge' && !forgeUp && !forgeStarting) {
      continue // nothing to stop
    }
    if (tool === 'start_ollama' && localUp) {
      steps.push({
        tool: 'list_installed_models',
        onFail: 'continue',
        why: 'runtime local OK — listar modelos'
      })
      continue
    }
    if (tool === 'start_music' && musicUp) {
      continue
    }
    if (tool === 'stop_music' && !musicUp) {
      continue
    }
    if (tool === 'health_forge' && forgeBad && !plan.steps.some((s) => s.tool === 'start_forge')) {
      // keep health, but ensure a start follows if user wanted forge up
      steps.push(step)
      if (forgeBad && /forge|imagen|sd/i.test(plan.goal)) {
        steps.push({ tool: 'start_forge', onFail: 'stop', why: 'Forge en error/stopped tras health' })
      }
      continue
    }
    steps.push(step)
  }

  // Dedup consecutive identical tools
  const dedup: PlanStep[] = []
  for (const s of steps) {
    const last = dedup[dedup.length - 1]
    if (last && last.tool === s.tool && JSON.stringify(last.args) === JSON.stringify(s.args)) continue
    dedup.push(s)
  }

  return {
    ...plan,
    steps: dedup,
    source: plan.source
  }
}
