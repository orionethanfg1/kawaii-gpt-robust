
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
  /** Tool-use / function-calling / agent routing */
  scoreTools: number
  /**
   * Decision quality: plan, choose next step, multi-tool, stick to constraints.
   * Used by Auto when the turn looks agentic (host tools, multi-step).
   */
  scoreDecision: number
  paramsB: number | null
  generation: number | null
  family: string
  notes: string[]
}

/**
 * Dimensiones que alimentan Auto (documentación viva).
 * Auto NO es “siempre el más chico”: maximiza utilidad bajo recursos reales.
 *
 * | Dimensión        | Qué mide                                      | Cómo entra en Auto                          |
 * |------------------|-----------------------------------------------|---------------------------------------------|
 * | scoreChat        | Conversación natural, estilo, seguimiento     | Tarea por defecto                           |
 * | scoreReason      | Análisis profundo, planes, capítulos          | classifyChatTask → reason                   |
 * | scoreFast        | Latencia / saludos / mensajes cortos          | Mensajes muy cortos / idle                  |
 * | scoreTools       | Function-calling, JSON, host tools            | Boost si el turno usa herramientas          |
 * | scoreDecision    | Elegir acción, no divagar, multi-paso         | Preferencia agentic / iniciativa            |
 * | paramsB (A/E)    | Coste efectivo (MoE A4B/E4B vs denso)         | Fit RAM/VRAM; no penalizar MoE como denso   |
 * | generation       | Familia reciente (Qwen3.x > 2.5)              | Preferir gen nueva a mismo tamaño           |
 * | runtime live     | API viva vs solo disco                        | Live > disk; disk solo si LMS/Ollama up     |
 * | disabled list    | Preferencia explícita del usuario             | Hard filter: nunca elegir deshabilitados    |
 * | pinned model     | Fijado en Ajustes                             | Hard respect aunque sea 27B denso           |
 */

/**
 * Effective size for resource scoring.
 * Gemma-style «26B-A4B» / MoE «E4B»: prefer A/E active params for RAM fit
 * (dense 26–27B labels alone over-penalize efficient variants).
 */
function parseParamsB(id: string): number | null {
  const low = id.toLowerCase()
  const eff = low.match(/\be(\d+(?:\.\d+)?)\s*b\b/)
  if (eff) return parseFloat(eff[1])
  const arch = low.match(/\ba(\d+(?:\.\d+)?)\s*b\b/)
  if (arch) {
    // A4B with optional dense 26B in the same id → score as active ~A4B (light load)
    return parseFloat(arch[1])
  }
  const m = low.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*b(?:[^a-z0-9]|$)/)
  if (m) {
    const n = parseFloat(m[1])
    if (n >= 0.5 && n <= 200) return n
  }
  const m2 = low.match(/[-_/](\d{1,3})b([-_/]|$)/)
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
  let scoreTools = 35
  let scoreDecision = 35

  if (layer === 'embed') {
    return {
      id,
      runtime,
      layer,
      scoreChat: 0,
      scoreReason: 0,
      scoreFast: 0,
      scoreTools: 0,
      scoreDecision: 0,
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
    scoreTools = 20
    scoreDecision = 20
    notes.push('vision-oriented')
  }

  // Family baseline
  if (family === 'qwen') {
    scoreChat += 18
    scoreReason += 16
    scoreTools += 16
    scoreDecision += 14
  } else if (family === 'llama') {
    scoreChat += 12
    scoreReason += 12
    scoreTools += 10
    scoreDecision += 10
  } else if (family === 'deepseek') {
    scoreReason += 20
    scoreChat += 10
    scoreDecision += 12
    scoreTools += 8
  } else if (family === 'mistral') {
    scoreChat += 10
    scoreTools += 12
    scoreDecision += 8
  } else if (family === 'gemma') {
    scoreChat += 14
    scoreReason += 10
    scoreTools += 8
    scoreDecision += 10
    notes.push('gemma')
  }
  // Efficient catalog tags (A4B / E4B) — strong chat + decision at low active cost
  if (/\b[ae]\d+(?:\.\d+)?\s*b\b/i.test(id)) {
    scoreChat += 12
    scoreFast += 10
    scoreDecision += 10
    scoreTools += 6
    notes.push('variante eficiente A/E (mejor fit RAM)')
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
      scoreChat += 20
      scoreReason += 18
      notes.push('gen 3')
    } else if (generation >= 2.5) {
      scoreChat += 4
      scoreReason += 4
      notes.push('gen 2.5 (preferir 3.x si existe)')
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
  // Explicit reasoning / thinking models
  if (/reason|thinking|r1|qwq|deepseek-r1|openthinker|sky-t1|marco-o1/i.test(id)) {
    scoreReason += 12
    scoreChat += 4
    scoreDecision += 10
    notes.push('reasoning / thinking tags')
  }
  // Decision / agent / tool-specialized (Hermes, function, tool, agent, instruct-it with tool training)
  if (
    /hermes|tool[-_]?use|function[-_]?call|firefunction|gorilla|agent|command-r|nous-hermes|openchat/i.test(
      id
    )
  ) {
    scoreTools += 18
    scoreDecision += 16
    scoreChat += 4
    notes.push('decision/tool-oriented')
  }
  // Soft penalty only for dense ≥24B (user may pin / enable only large — never hard-ban)
  if (paramsB != null && paramsB >= 24) {
    scoreChat = Math.min(scoreChat, 48)
    scoreFast = Math.min(scoreFast, 28)
    scoreDecision += 6 // grandes densos a veces mejores en decisión multi-paso
    notes.push('24B+ denso: lento / más RAM; usable si fijado o único habilitado')
  }
  if (paramsB != null && paramsB >= 20 && paramsB < 24) {
    scoreChat = Math.min(scoreChat, 55)
    notes.push('~20B: más lento; Auto prefiere 9–14B/A4B si hay alternativas')
  }
  if (layer === 'code') {
    scoreReason += 8
    scoreTools += 6
    scoreDecision += 4
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
    scoreTools: clamp(scoreTools),
    scoreDecision: clamp(scoreDecision),
    paramsB,
    generation,
    family,
    notes
  }
}

export type PickTask = 'chat' | 'reason' | 'fast' | 'vision' | 'code' | 'tools' | 'decision'

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
    task === 'reason'
      ? 'scoreReason'
      : task === 'fast'
        ? 'scoreFast'
        : task === 'tools'
          ? 'scoreTools'
          : task === 'decision'
            ? 'scoreDecision'
            : 'scoreChat'
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
    /\b(herramienta|tool|ejecuta|busca en|abre la app|host tool|function call)\b/.test(t)
  )
    return 'tools'
  if (
    /\b(decide|elige|qu[eé] conviene|plan de acci[oó]n|siguiente paso|prioriza|trade-?off)\b/.test(
      t
    )
  )
    return 'decision'
  if (
    /\b(razona|explica con detalle|plan|estrategia|cap[ií]tulo|libro|analiza en profundidad)\b/.test(
      t
    )
  )
    return 'reason'
  if ((text || '').trim().length < 40 && /^(hola|hi|hey|buenas)\b/i.test(t)) return 'fast'
  return 'chat'
}
