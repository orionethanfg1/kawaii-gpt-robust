/**
 * Infer model capabilities for catalog badges (Reason / Tools / Vision),
 * similar to LM Studio staff-picks signals — heuristics from model id + tags.
 */

export type ModelCap = 'reason' | 'tools' | 'vision' | 'code' | 'chat'

export type ModelCapInfo = {
  caps: ModelCap[]
  /** Human labels for UI */
  labels: string[]
  /** Param class: 2B, 4B, 9B, 27B… */
  paramLabel?: string
  /** Effective / MoE style notes from id (E4B, A4B…) */
  architectureNote?: string
  /** 0–100 fit score for this machine + preferred use */
  fitScore: number
  fitReason: string
}

const VISION_RE =
  /llava|moondream|bakllava|vision|minicpm-v|qwen2(\.|-)?vl|qwen2\.5-vl|pixtral|gemma[- ]?3.*vision|internvl|phi-3-vision|llama[-.]?3\.2.*vision|gemma.?4/i

const REASON_RE =
  /r1|reason|thinking|qwq|deepseek-r1|qwen3(\.|$)|qwen3\.5|qwen\/qwen3|o1|o3|gpt-oss|openthinker|marco-o1|exames|sky-t1/i

const TOOLS_RE =
  /tool|function|agent|qwen2\.5|qwen3|llama-3\.1|llama3\.1|mistral|command-r|hermes|nous|firefunction|gorilla/i

const CODE_RE =
  /coder|code|deepseek-coder|starcoder|codellama|codestral|qwen2\.5-coder|devstral/i

/** Parse size tags: 7B, 27B, E4B (effective), A4B (attention/arch variants), 26B, etc. */
export function parseParamLabel(modelId: string): {
  paramLabel?: string
  architectureNote?: string
  approxB: number
} {
  const x = modelId || ''
  // Effective param (MoE): E4B, e2b
  const eff = x.match(/\bE(\d+(?:\.\d+)?)\s*B\b/i) || x.match(/\be(\d+(?:\.\d+)?)\s*b\b/)
  if (eff) {
    const n = parseFloat(eff[1])
    return {
      paramLabel: `E${n}B`,
      architectureNote:
        'E = parámetros efectivos activos (p. ej. MoE): menos coste que el total denso',
      approxB: n
    }
  }
  // Dense size first when both "26B" and "A4B" appear (Gemma 4 catalog style)
  const dense = x.match(/(?:^|[^\w])(\d+(?:\.\d+)?)\s*B(?:\b|[-_\s]|$)/i)
  const arch = x.match(/\bA(\d+(?:\.\d+)?)\s*B\b/i)
  if (dense) {
    const n = parseFloat(dense[1])
    if (n >= 0.5 && n <= 200) {
      // Skip if this capture is actually the A4B / E4B letter form
      const slice = dense[0]
      if (!/^[AE]/i.test(slice.trim()) && !arch) {
        return { paramLabel: `${n}B`, approxB: n }
      }
      if (arch && n > parseFloat(arch[1])) {
        return {
          paramLabel: `${n}B`,
          architectureNote: `Variante catálogo A${arch[1]}B (familia/arquitectura); tamaño denso ~${n}B`,
          approxB: n
        }
      }
      if (!/^[AE]/i.test(slice.trim())) {
        return { paramLabel: `${n}B`, approxB: n }
      }
    }
  }
  if (arch) {
    const n = parseFloat(arch[1])
    return {
      paramLabel: `A${n}B`,
      architectureNote:
        'A = etiqueta de variante de arquitectura/familia en el catálogo (no es cuantización)',
      approxB: n
    }
  }
  const plain = x.match(/(\d+(?:\.\d+)?)\s*[Bb](?:\b|[-_]|$)/)
  if (plain) {
    const n = parseFloat(plain[1])
    // Ignore years like 2024
    if (n >= 0.5 && n <= 200) {
      return { paramLabel: `${n}B`, approxB: n }
    }
  }
  // qwen3.5-9b style
  const dash = x.match(/[-_](\d+(?:\.\d+)?)[Bb]/)
  if (dash) {
    const n = parseFloat(dash[1])
    if (n >= 0.5 && n <= 200) return { paramLabel: `${n}B`, approxB: n }
  }
  return { approxB: 8 }
}

export function inferModelCapabilities(modelId: string, extraTags?: string[]): ModelCapInfo {
  const x = `${modelId} ${(extraTags || []).join(' ')}`.toLowerCase()
  const caps: ModelCap[] = ['chat']
  if (VISION_RE.test(x)) caps.push('vision')
  if (REASON_RE.test(x)) caps.push('reason')
  if (TOOLS_RE.test(x) || /qwen|llama|mistral|gemma|phi|deepseek/.test(x)) {
    if (!caps.includes('tools')) caps.push('tools')
  }
  if (CODE_RE.test(x)) caps.push('code')
  // Default modern instruct models handle tools reasonably
  if (
    !caps.includes('tools') &&
    /instruct|chat|it\b/.test(x) &&
    !/embed|whisper|tts/.test(x)
  ) {
    caps.push('tools')
  }

  const parsed = parseParamLabel(modelId)
  const labels: string[] = []
  if (caps.includes('reason')) labels.push('Razonar')
  if (caps.includes('tools')) labels.push('Herramientas')
  if (caps.includes('vision')) labels.push('Visión')
  if (caps.includes('code')) labels.push('Código')

  return {
    caps: [...new Set(caps)],
    labels,
    paramLabel: parsed.paramLabel,
    architectureNote: parsed.architectureNote,
    fitScore: 50,
    fitReason: ''
  }
}

/**
 * Score how well a model fits this PC + intended use (0–100).
 */
export function scoreModelFit(
  modelId: string,
  opts: {
    ramGB: number
    vramGB?: number | null
    prefer?: 'chat' | 'reason' | 'vision' | 'code' | 'tools' | 'balanced'
  }
): ModelCapInfo {
  const info = inferModelCapabilities(modelId)
  const { approxB } = parseParamLabel(modelId)
  const ram = opts.ramGB || 16
  const vram = opts.vramGB
  const prefer = opts.prefer || 'balanced'

  let score = 55
  // Size vs RAM (Q4-ish rule of thumb ~0.6–0.7 GB per B)
  const needGB = approxB * 0.65
  const budget = vram && vram > 4 ? vram : ram * 0.45
  if (needGB <= budget * 0.5) score += 15
  else if (needGB <= budget * 0.85) score += 8
  else if (needGB > budget * 1.2) score -= 25
  else if (needGB > budget) score -= 12

  if (info.caps.includes('reason') && (prefer === 'reason' || prefer === 'balanced')) score += 10
  if (info.caps.includes('vision') && prefer === 'vision') score += 18
  if (info.caps.includes('code') && prefer === 'code') score += 12
  if (info.caps.includes('tools') && (prefer === 'tools' || prefer === 'balanced')) score += 6

  // Prefer mid-size for general chat on typical PCs
  if (prefer === 'chat' || prefer === 'balanced') {
    if (approxB >= 6 && approxB <= 14) score += 8
    if (approxB >= 20) score -= 5
    if (approxB <= 3) score -= 2
  }

  if (/embed|whisper|tts|clip/.test(modelId.toLowerCase())) score -= 40

  score = Math.max(0, Math.min(100, score))
  let fitReason = ''
  if (score >= 75) fitReason = 'Muy adecuado para este equipo'
  else if (score >= 55) fitReason = 'Razonable en este equipo'
  else if (score >= 40) fitReason = 'Ajustado — puede ir lento'
  else fitReason = 'Pesado para este equipo — mejor otro o cloud'

  return { ...info, fitScore: score, fitReason }
}

/** Pick best installed model for a use-case */
export function recommendBestInstalled(
  installedIds: string[],
  opts: {
    ramGB: number
    vramGB?: number | null
    prefer?: 'chat' | 'reason' | 'vision' | 'code' | 'tools' | 'balanced'
  }
): { id: string; info: ModelCapInfo } | null {
  if (!installedIds.length) return null
  const scored = installedIds.map((id) => ({
    id,
    info: scoreModelFit(id, opts)
  }))
  scored.sort((a, b) => b.info.fitScore - a.info.fitScore)
  return scored[0] || null
}
