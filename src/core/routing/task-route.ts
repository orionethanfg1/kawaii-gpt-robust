/**
 * Automatic model routing by task — classify user intent and pick best installed local model.
 */

export type ChatTask = 'chat' | 'code' | 'vision' | 'summary' | 'tools'

export function classifyChatTask(
  text: string,
  opts?: { hasImageAttachment?: boolean }
): ChatTask {
  const t = (text || '').toLowerCase()
  if (opts?.hasImageAttachment) return 'vision'
  if (
    /\b(qu[eé] hay en (esta|la) (foto|imagen)|describe (esta |la )?(foto|imagen)|analiza (esta |la )?(foto|imagen)|what do you see|ocr|lee el texto de la imagen)\b/i.test(
      t
    ) ||
    /\b(visi[oó]n|llava|moondream)\b/.test(t)
  ) {
    return 'vision'
  }
  if (
    /\b(c[oó]digo|program|bug|error de compil|typescript|javascript|python|refactor|funci[oó]n|clase |stack trace|eslint|typeerror)\b/i.test(
      t
    ) ||
    /```[\s\S]{20,}/.test(text || '')
  ) {
    return 'code'
  }
  if (
    /\b(resum(e|ir|en)|sintetiza|tl;?dr|recapitul|haz un resumen|en pocas palabras lo (anterior|de arriba))\b/i.test(
      t
    )
  ) {
    return 'summary'
  }
  if (
    /\b(arranca|inicia|configura|diagn[oó]stic|forge|ollama|ajusta (la )?app|herramienta de la app)\b/i.test(
      t
    )
  ) {
    return 'tools'
  }
  return 'chat'
}

/** Higher is better for the given task among installed Ollama/LM tags */
export function scoreModelForTask(modelId: string, task: ChatTask, ramGB = 16): number {
  const x = modelId.toLowerCase()
  let s = 0

  // Global penalties
  if (/embed|whisper|tts|clip/.test(x)) s -= 20
  if (/uncensored|abliterated/.test(x)) s += 0.5 // neutral; available but not preferred for default

  if (task === 'vision') {
    if (/llava|moondream|bakllava|vision|minicpm-v|qwen2(\.|-)?vl|pixtral/.test(x)) s += 12
    else s -= 8
    return s
  }

  if (task === 'code') {
    if (/coder|code|deepseek-coder|starcoder|codellama|qwen2\.5-coder|codestral/.test(x)) s += 12
    if (/qwen2\.5:14b|qwen2\.5:32b|llama3\.1:70b/.test(x)) s += 4
    if (/moondream|llava|vision/.test(x)) s -= 6
  } else if (task === 'summary') {
    if (/instruct|chat/.test(x)) s += 2
    if (/14b|13b|12b|32b|70b/.test(x)) s += 5
    if (/7b|8b|9b/.test(x)) s += 3
    if (/1b|3b/.test(x)) s += 1
    if (/moondream|llava|vision|coder/.test(x)) s -= 4
  } else if (task === 'tools') {
    // Prefer capable general chat for tool-following
    if (/qwen2\.5:14b|qwen2\.5:32b|llama3\.1:8b|mistral|command-r/.test(x)) s += 6
    if (/instruct|chat/.test(x)) s += 2
    if (/moondream|llava|vision/.test(x)) s -= 5
  } else {
    // chat
    if (/qwen2\.5:14b/.test(x)) s += 8
    if (/qwen2\.5:7b|llama3\.1:8b|mistral|gemma2:9b/.test(x)) s += 6
    if (/qwen2\.5:32b|llama3\.1:70b/.test(x)) s += 5
    if (/instruct|chat/.test(x)) s += 2
    if (/moondream|llava|vision|coder|embed/.test(x)) s -= 6
  }

  // RAM-aware soft bias
  if (ramGB < 16 && /(3b|1\.5b|1b)/.test(x)) s += 2
  if (ramGB >= 16 && ramGB < 32 && /(7b|8b|9b)/.test(x)) s += 2
  if (ramGB >= 32 && /(14b|13b|12b)/.test(x)) s += 2
  if (ramGB < 24 && /(32b|70b)/.test(x)) s -= 4

  return s
}

export type AutoRouteResult = {
  task: ChatTask
  applied: boolean
  from: string
  to: string
  reason: string
  candidates: Array<{ id: string; score: number }>
}

/**
 * Pick best installed model for task. Only recommend a switch if clearly better.
 */
export function pickBestInstalledForTask(input: {
  installed: string[]
  task: ChatTask
  current?: string
  ramGB?: number
  /** Minimum score delta to switch away from current (default 3) */
  minDelta?: number
}): AutoRouteResult {
  const ram = input.ramGB ?? 16
  const minDelta = input.minDelta ?? 3
  const current = (input.current || '').trim()
  const installed = [...new Set(input.installed.map((x) => x.trim()).filter(Boolean))]
  const scored = installed
    .map((id) => ({ id, score: scoreModelForTask(id, input.task, ram) }))
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best || best.score < 0) {
    return {
      task: input.task,
      applied: false,
      from: current,
      to: current,
      reason: `sin modelo local adecuado para tarea «${input.task}»`,
      candidates: scored.slice(0, 5)
    }
  }

  const curScore = current ? scoreModelForTask(current, input.task, ram) : -99
  if (current && best.id === current) {
    return {
      task: input.task,
      applied: false,
      from: current,
      to: current,
      reason: `ya es buen match para «${input.task}» (${current})`,
      candidates: scored.slice(0, 5)
    }
  }
  if (current && best.score < curScore + minDelta) {
    return {
      task: input.task,
      applied: false,
      from: current,
      to: current,
      reason: `se mantiene ${current} (Δ insuficiente vs ${best.id})`,
      candidates: scored.slice(0, 5)
    }
  }

  return {
    task: input.task,
    applied: true,
    from: current || '(ninguno)',
    to: best.id,
    reason: `tarea «${input.task}» → ${best.id} (score ${best.score}${current ? ` vs ${current}=${curScore}` : ''})`,
    candidates: scored.slice(0, 5)
  }
}
