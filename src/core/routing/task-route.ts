import { telemetryModelBias } from '../telemetry/route-telemetry'
import {
  inferModelCapabilities,
  scoreModelFit,
  type ModelCap
} from '../models/capabilities'

/**
 * Automatic model routing by task — prefer installed models that *have*
 * the needed capability (vision / code / reason / tools), within hardware budget.
 */

export type ChatTask = 'chat' | 'code' | 'vision' | 'summary' | 'tools' | 'reason'

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
    /\b(razona|razonamiento|explica con detalle|analiza en profundidad|piensa paso a paso|step by step|plan detallado)\b/i.test(
      t
    )
  ) {
    return 'reason'
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

function taskToPrefer(task: ChatTask): 'chat' | 'reason' | 'vision' | 'code' | 'tools' | 'balanced' {
  switch (task) {
    case 'vision':
      return 'vision'
    case 'code':
      return 'code'
    case 'tools':
      return 'tools'
    case 'summary':
      return 'reason'
    case 'reason':
      return 'reason'
    default:
      return 'balanced'
  }
}

function requiredCap(task: ChatTask): ModelCap | null {
  if (task === 'vision') return 'vision'
  if (task === 'code') return 'code'
  return null
}

/**
 * Score model for task: capability match dominates, then hardware fit, then telemetry.
 * Higher is better.
 */
export function scoreModelForTask(
  modelId: string,
  task: ChatTask,
  ramGB = 16,
  vramGB?: number | null
): number {
  const x = modelId.toLowerCase()
  if (/embed|whisper|tts|clip/.test(x)) return -50

  const caps = inferModelCapabilities(modelId).caps
  const prefer = taskToPrefer(task)
  const fit = scoreModelFit(modelId, { ramGB, vramGB, prefer })

  let s = fit.fitScore / 5 // 0–20 base from hardware+caps preference
  if (task === 'reason') {
    // Prefer models good at reasoning; penalize huge defaults less here
    if (/reason|thinking|r1|qwq|qwen3/i.test(x)) s += 12
    if (/(27b|28b|32b|70b)/i.test(x)) s -= 8 // still careful with VRAM
  } else {
    if (/(27b|28b|32b|70b)/i.test(x)) s -= 15 // B4: avoid silent 27B on casual chat
  }

  const need = requiredCap(task)
  if (need) {
    if (caps.includes(need)) s += 25
    else s -= 20 // strongly avoid models lacking required modality
  }

  if (task === 'code') {
    if (caps.includes('code')) s += 12
    if (caps.includes('reason')) s += 4
    if (caps.includes('vision') && !caps.includes('code')) s -= 4
  } else if (task === 'vision') {
    if (caps.includes('vision')) s += 15
  } else if (task === 'tools') {
    if (caps.includes('tools')) s += 8
    if (caps.includes('reason')) s += 6
  } else if (task === 'summary') {
    if (caps.includes('reason')) s += 6
    if (caps.includes('chat')) s += 2
  } else {
    // chat: prefer mid-size; penalize 27B+ (timeout / VRAM)
    if (caps.includes('reason')) s += 3
    if (caps.includes('tools')) s += 3
    if (caps.includes('vision')) s += 2
    if (caps.includes('code')) s += 1
    const pb = modelId.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b\b/) || modelId.toLowerCase().match(/[-_/](\d{1,3})b([-_/]|$)/)
    const params = pb ? parseFloat(pb[1]) : null
    if (params != null) {
      if (params >= 24) s -= 18
      else if (params >= 16 && params < 24) s -= 4
      else if (params >= 7 && params <= 15) s += 8
    }
  }

  try {
    s += telemetryModelBias(modelId, task)
  } catch {
    /* optional */
  }

  return s
}

export type AutoRouteResult = {
  task: ChatTask
  applied: boolean
  from: string
  to: string
  reason: string
  candidates: Array<{ id: string; score: number; caps?: string[] }>
}

export function pickBestInstalledForTask(input: {
  installed: string[]
  task: ChatTask
  current?: string
  ramGB?: number
  vramGB?: number | null
  minDelta?: number
}): AutoRouteResult {
  const ram = input.ramGB ?? 16
  const vram = input.vramGB
  const minDelta = input.minDelta ?? 3
  const current = (input.current || '').trim()
  const installed = [...new Set(input.installed.map((x) => x.trim()).filter(Boolean))]

  const scored = installed
    .map((id) => ({
      id,
      score: scoreModelForTask(id, input.task, ram, vram),
      caps: inferModelCapabilities(id).caps
    }))
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best || best.score < -10) {
    return {
      task: input.task,
      applied: false,
      from: current,
      to: current,
      reason: `sin modelo local adecuado para tarea «${input.task}»`,
      candidates: scored.slice(0, 5).map(({ id, score, caps }) => ({ id, score, caps }))
    }
  }

  const curScore = current ? scoreModelForTask(current, input.task, ram, vram) : -99
  const capNote = best.caps?.length
    ? ` [${best.caps.filter((c) => c !== 'chat').join(', ') || 'chat'}]`
    : ''

  if (current && best.id === current) {
    return {
      task: input.task,
      applied: false,
      from: current,
      to: current,
      reason: `ya es buen match para «${input.task}» (${current})${capNote}`,
      candidates: scored.slice(0, 5).map(({ id, score, caps }) => ({ id, score, caps }))
    }
  }
  if (current && best.score < curScore + minDelta) {
    return {
      task: input.task,
      applied: false,
      from: current,
      to: current,
      reason: `se mantiene ${current} (Δ insuficiente vs ${best.id})`,
      candidates: scored.slice(0, 5).map(({ id, score, caps }) => ({ id, score, caps }))
    }
  }

  return {
    task: input.task,
    applied: true,
    from: current || '(ninguno)',
    to: best.id,
    reason: `tarea «${input.task}» → ${best.id} (score ${best.score.toFixed(1)}${current ? ` vs ${current}=${curScore.toFixed(1)}` : ''})${capNote}`,
    candidates: scored.slice(0, 5).map(({ id, score, caps }) => ({ id, score, caps }))
  }
}
