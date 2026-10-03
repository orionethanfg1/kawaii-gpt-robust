
/**
 * Static scoring for local chat models. Used by catalog cache + placement fallback.
 * Not "biggest wins": generation, size tier, family, task affinity.
 */

export type ModelLayer = 'chat' | 'vision' | 'code' | 'embed' | 'unknown'

export type ScoredLocalModel = {
  id: string
  runtime: 'ollama' | 'openai-compatible' | 'disk'
  layer: ModelLayer
  /** 0–100 overall for general chat */
  scoreChat: number
  scoreReason: number
  scoreFast: number
  paramsB: number | null
  generation: number | null
  family: string
  notes: string[]
}

function parseParamsB(id: string): number | null {
  const m = id.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b\b/)
  if (m) return parseFloat(m[1])
  const m2 = id.toLowerCase().match(/[-_/](\d{1,3})b([-_/]|$)/)
  if (m2) return parseFloat(m2[1])
  return null
}

function parseGeneration(id: string): number | null {
  const low = id.toLowerCase()
  // qwen3.8 > qwen3.5 > qwen3 > qwen2.5
  const q = low.match(/qwen[^\d]*(\d+(?:\.\d+)?)/)
  if (q) return parseFloat(q[1])
  const l = low.match(/llama[^\d]*(\d+(?:\.\d+)?)/)
  if (l) return parseFloat(l[1])
  return null
}

function familyOf(id: string): string {
  const low = id.toLowerCase()
  if (/qwen/.test(low)) return 'qwen'
  if (/llama/.test(low)) return 'llama'
  if (/mistral|mixtral/.test(low)) return 'mistral'
  if (/phi/.test(low)) return 'phi'
  if (/gemma/.test(low)) return 'gemma'
  if (/deepseek/.test(low)) return 'deepseek'
  if (/moondream|llava|vision/.test(low)) return 'vision'
  return 'other'
}

function layerOf(id: string): ModelLayer {
  const low = id.toLowerCase()
  if (/embed|nomic|bge|minilm/.test(low)) return 'embed'
  if (/moondream|llava|vision|clip/.test(low)) return 'vision'
  if (/coder|code/.test(low)) return 'code'
  return 'chat'
}

/**
 * Score a model id for chat / reason / fast lanes.
 */
export function scoreLocalModelId(
  id: string,
  runtime: ScoredLocalModel['runtime'] = 'ollama'
): ScoredLocalModel {
  const notes: string[] = []
  const layer = layerOf(id)
  const family = familyOf(id)
  const paramsB = parseParamsB(id)
  const generation = parseGeneration(id)
  let scoreChat = 40
  let scoreReason = 40
  let scoreFast = 50

  if (layer === 'embed') {
    return {
      id,
      runtime,
      layer,
      scoreChat: 0,
      scoreReason: 0,
      scoreFast: 0,
      paramsB,
      generation,
      family,
      notes: ['embedding — no chat']
    }
  }
  if (layer === 'vision') {
    scoreChat = 15
    scoreReason = 10
    scoreFast = 40
    notes.push('vision-oriented')
  }

  // Family baseline
  if (family === 'qwen') {
    scoreChat += 18
    scoreReason += 16
  } else if (family === 'llama') {
    scoreChat += 12
    scoreReason += 12
  } else if (family === 'deepseek') {
    scoreReason += 20
    scoreChat += 10
  } else if (family === 'mistral') {
    scoreChat += 10
  }

  // Generation boost (Qwen3.x > 2.5)
  if (generation != null) {
    if (generation >= 3.8) {
      scoreChat += 22
      scoreReason += 24
      notes.push('gen 3.8+')
    } else if (generation >= 3.5) {
      scoreChat += 18
      scoreReason += 20
      notes.push('gen 3.5')
    } else if (generation >= 3) {
      scoreChat += 14
      scoreReason += 16
      notes.push('gen 3')
    } else if (generation >= 2.5) {
      scoreChat += 8
      scoreReason += 8
    }
  }

  // Size: chat prefers 7–14B; 27B+ only for heavy reason (slow / VRAM heavy)
  if (paramsB != null) {
    if (paramsB <= 3) {
      scoreFast += 25
      scoreChat -= 15
      scoreReason -= 20
      notes.push('small/fast')
    } else if (paramsB <= 9) {
      scoreFast += 18
      scoreChat += 14
      scoreReason += 8
      notes.push('9B-class — bueno y ágil')
    } else if (paramsB <= 15) {
      scoreChat += 22
      scoreReason += 16
      scoreFast += 8
      notes.push('14B-class sweet spot (chat)')
    } else if (paramsB <= 22) {
      scoreReason += 14
      scoreChat += 4
      scoreFast -= 12
      notes.push('~20B — más lento')
    } else if (paramsB <= 35) {
      // 27B: strong reason, weak default chat (timeout / VRAM risk)
      scoreReason += 18
      scoreChat -= 18
      scoreFast -= 30
      notes.push('27B+ — solo razonamiento pesado; evitar chat casual')
    } else {
      scoreReason += 10
      scoreChat -= 25
      scoreFast -= 35
      notes.push('muy grande — alto riesgo de timeout')
    }
  }

  if (/abliterated|uncensored/i.test(id)) {
    scoreChat += 2
    notes.push('abliterated')
  }
  // B4: explicit reasoning / thinking models
  if (/reason|thinking|r1|qwq|deepseek-r1/i.test(id)) {
    scoreReason += 12
    scoreChat += 4
    notes.push('B4: reasoning tags')
  }
  // B4: stronger avoid 27B+ as default chat (timeouts observed)
  if (paramsB != null && paramsB >= 24) {
    scoreChat = Math.min(scoreChat, 35)
    notes.push('B4: chat cap for 24B+')
  }
  if (layer === 'code') {
    scoreReason += 8
    notes.push('code-tuned')
  }

  // Prefer models reachable via live API over disk-only inventory
  if (runtime === 'disk') {
    scoreChat -= 22
    scoreReason -= 10
    scoreFast -= 5
    notes.push('solo disco — server posiblemente parado')
  } else if (runtime === 'openai-compatible') {
    scoreChat += 10
    scoreReason += 6
    notes.push('API viva (LM Studio / OpenAI-compat)')
  } else if (runtime === 'ollama') {
    scoreChat += 8
    scoreReason += 5
    notes.push('API viva (Ollama)')
  }

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
  return {
    id,
    runtime,
    layer,
    scoreChat: clamp(scoreChat),
    scoreReason: clamp(scoreReason),
    scoreFast: clamp(scoreFast),
    paramsB,
    generation,
    family,
    notes
  }
}

export type PickTask = 'chat' | 'reason' | 'fast' | 'vision' | 'code'

export function pickScoredModel(
  models: ScoredLocalModel[],
  task: PickTask = 'chat'
): ScoredLocalModel | null {
  const pool =
    task === 'vision'
      ? models.filter((m) => m.layer === 'vision' || m.scoreChat > 0)
      : task === 'code'
        ? models.filter((m) => m.layer === 'code' || m.layer === 'chat')
        : models.filter((m) => m.layer === 'chat' || m.layer === 'code')
  if (!pool.length) return null
  const key =
    task === 'reason' ? 'scoreReason' : task === 'fast' ? 'scoreFast' : 'scoreChat'
  return [...pool].sort((a, b) => (b[key] as number) - (a[key] as number))[0] || null
}

/** True if model is likely too heavy for casual chat on consumer GPU. */
export function isLargeLocalModel(id: string): boolean {
  const b = parseParamsB(id)
  return b != null && b >= 24
}

export function largeModelWarning(id: string): string | null {
  if (!isLargeLocalModel(id)) return null
  const b = parseParamsB(id)
  return (
    `Modelo grande (~${b}B): puede tardar minutos o agotar VRAM. ` +
    `Para chat rápido elige 9B–14B (p. ej. Qwen3 14B / 3.5 9B) en Ajustes.`
  )
}

export function classifyChatTaskForModel(text: string): PickTask {
  const t = (text || '').toLowerCase()
  if (/\b(imagen|foto|describe (esta|la) (foto|imagen)|qu[eé] hay en)\b/.test(t)) return 'vision'
  if (/\b(c[oó]digo|code|typescript|python|bug|refactor)\b/.test(t)) return 'code'
  if (
    /\b(razona|explica con detalle|plan|estrategia|cap[ií]tulo|libro|analiza en profundidad)\b/.test(
      t
    )
  )
    return 'reason'
  if ((text || '').trim().length < 40 && /^(hola|hi|hey|buenas)\b/i.test(t)) return 'fast'
  return 'chat'
}
