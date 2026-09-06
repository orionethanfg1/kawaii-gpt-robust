/**
 * User thumbs up/down → short developer reports (local, no secrets).
 */

export type FeedbackVote = 'up' | 'down'

export type FeedbackReport = {
  id: string
  at: number
  vote: FeedbackVote
  report: string
  context: {
    messageId?: string
    role?: string
    contentPreview?: string
    isImage?: boolean
    imagePrompt?: string
    model?: string
    provider?: string
    route?: string
    characterName?: string
  }
}

const MAX = 200
const memory: FeedbackReport[] = []

function uid(): string {
  return `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function buildFeedbackReport(
  vote: FeedbackVote,
  ctx: FeedbackReport['context']
): FeedbackReport {
  const bits: string[] = []
  bits.push(vote === 'up' ? '👍 Me gusta' : '👎 No me gusta')
  if (ctx.isImage) {
    bits.push('tipo=imagen')
    if (ctx.imagePrompt) bits.push(`prompt="${ctx.imagePrompt.slice(0, 120)}"`)
  } else {
    bits.push('tipo=texto')
  }
  if (ctx.model) bits.push(`model=${ctx.model}`)
  if (ctx.provider) bits.push(`provider=${ctx.provider}`)
  if (ctx.route) bits.push(`route=${ctx.route}`)
  if (ctx.characterName) bits.push(`char=${ctx.characterName}`)
  if (ctx.contentPreview) bits.push(`preview="${ctx.contentPreview.slice(0, 80)}"`)
  if (vote === 'down' && ctx.isImage) {
    bits.push('hint=revisar_prompt_sd|checkpoint|cfg|identidad')
  }
  if (vote === 'down' && !ctx.isImage) {
    bits.push('hint=revisar_routing|contexto|personalidad')
  }
  return {
    id: uid(),
    at: Date.now(),
    vote,
    report: bits.join(' · '),
    context: ctx
  }
}

export function recordFeedback(report: FeedbackReport): void {
  memory.unshift(report)
  if (memory.length > MAX) memory.length = MAX
  try {
    if (typeof localStorage !== 'undefined') {
      const prev = JSON.parse(localStorage.getItem('kawaii_feedback_v1') || '[]') as FeedbackReport[]
      const next = [report, ...prev].slice(0, MAX)
      localStorage.setItem('kawaii_feedback_v1', JSON.stringify(next))
    }
  } catch {
    /* ignore */
  }
}

export function listFeedbackReports(limit = 50): FeedbackReport[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const prev = JSON.parse(localStorage.getItem('kawaii_feedback_v1') || '[]') as FeedbackReport[]
      if (prev.length) return prev.slice(0, limit)
    }
  } catch {
    /* ignore */
  }
  return memory.slice(0, limit)
}

export function feedbackSummary(): string {
  const all = listFeedbackReports(100)
  const up = all.filter((r) => r.vote === 'up').length
  const down = all.filter((r) => r.vote === 'down').length
  const imgDown = all.filter((r) => r.vote === 'down' && r.context.isImage).length
  return (
    `Feedback local: ${up} 👍 / ${down} 👎 (${imgDown} imágenes negativas). Últimos: ` +
    all
      .slice(0, 5)
      .map((r) => r.report)
      .join(' || ')
  )
}
