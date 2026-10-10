/**
 * Pure host reply formatters — no store side-effects.
 */

export function isStatusOrModelsQuery(text: string): boolean {
  const t = (text || '').toLowerCase()
  return (
    /\b(estado de la app|estado de la aplicaci|status de la app|diagn[oó]stic)\b/.test(t) ||
    (/\b(estado|status|capas)\b/.test(t) && /\b(app|aplicaci|forge|ollama|lm\s*studio)\b/.test(t)) ||
    /\b(lista|listar|pasame|p[aá]same|dame)\b.*\bmodelos\b/.test(t) ||
    /\bmodelos\b.*\b(lista|listar|instalados|disponibles|completos?|tenemos|hay)\b/.test(t) ||
    (/\brevisa(?:r)?\b/.test(t) && /\b(estado|modelos|forge|app|ollama|lm\s*studio)\b/.test(t)) ||
    /\brevisa(?:r)?\s+(?:también\s+)?(?:ollama|lm\s*studio)\b/.test(t) ||
    /\b(?:c[oó]mo\s+est[aá]|qu[eé]\s+tal)\s+(?:ollama|lm\s*studio)\b/.test(t)
  )
}

/** Extract local model tags from harness observation strings (never cloud provider ids). */
export function extractModelTagsFromObservations(observations: string[]): string[] {
  const tags: string[] = []
  const push = (raw: string) => {
    let clean = raw.trim().replace(/^["']|["']$/g, '')
    if (!clean || clean.length < 2) return
    if (/^(groq|gemini|openrouter|openai|cloudflare)$/i.test(clean)) return
    if (!tags.includes(clean)) tags.push(clean)
  }

  for (const o of observations) {
    const m = o.match(/Modelos:\s*([^"]+)/i)
    const segment = m ? m[1] : o
    for (const part of segment.split(/[·|,;]/)) {
      let p = part.trim().replace(/^["']|["']$/g, '')
      p = p.replace(/\s*[\(（].*$/, '').replace(/\s*★.*$/, '').trim()
      push(p)
    }
  }
  return tags.slice(0, 20)
}

/** Deterministic reply for status + model list — avoids LLM formatting failures. */
export function formatHostStatusAndModelsReply(
  observations: string[],
  tags: string[]
): string {
  const joined = observations.join('\n')

  let chat = 'sin datos'
  if (/Chat local:\s*([^|"\\]+)/i.test(joined)) {
    chat = joined.match(/Chat local:\s*([^|"\\]+)/i)![1].trim()
  } else if (/localOk["\s:=]*true|Ollama OK|Runtime:.*Ollama/i.test(joined)) {
    chat = 'OK (Ollama/LM detectado)'
  } else if (/localOk["\s:=]*false|Sin runtime|CA[IÍ]DO/i.test(joined)) {
    chat = 'no disponible'
  }

  let forge = 'sin datos (on-demand)'
  if (/Forge\/imagen:\s*([^|"\\]+)/i.test(joined)) {
    forge = joined.match(/Forge\/imagen:\s*([^|"\\]+)/i)![1].trim()
  } else if (
    /forge["\s:=]*(running|ready)/i.test(joined) ||
    /"ok":\s*true.*"health_forge"/i.test(joined)
  ) {
    forge = 'running'
  } else if (
    /forge["\s:=]*(stopped|error)/i.test(joined) ||
    /health_forge.*"ok":\s*false/i.test(joined)
  ) {
    const m = joined.match(/forge["\s:=]*(\w+)/i)
    forge = m ? m[1] : 'stopped/error'
  }

  let music = 'detenida / on-demand'
  if (/Música:\s*([^|"\\]+)/i.test(joined)) {
    music = joined.match(/Música:\s*([^|"\\]+)/i)![1].trim()
  } else if (/Música \(ACE\): en marcha|musicRunning["\s:=]*true/i.test(joined)) {
    music = 'en marcha'
  }

  let voice = 'sin datos'
  if (/Voz:\s*([^|"\\]+)/i.test(joined)) {
    voice = joined.match(/Voz:\s*([^|"\\]+)/i)![1].trim()
  } else if (/Voz TTS: lista|voiceReady["\s:=]*true/i.test(joined)) {
    voice = 'lista'
  } else if (/Voz TTS: no lista|voiceReady["\s:=]*false/i.test(joined)) {
    voice = 'no lista'
  }

  let active = ''
  const am =
    joined.match(/localModel["\s:=]+([^|"\\}\s,]+)/i) ||
    joined.match(/modelo activo:\s*([^|)]+)/i)
  if (am) active = am[1].replace(/["']/g, '').trim()

  const activeNote = active ? (' · activo: `' + active + '`') : ''
  const lines: string[] = [
    'Revisé la app con datos reales (no inventados):',
    '',
    '**Capas**',
    '- **Chat local:** ' + chat + activeNote,
    '- **Forge / imagen:** ' + forge,
    '- **Música (ACE):** ' + music,
    '- **Voz TTS:** ' + voice,
    '',
    '**Modelos locales en disco**'
  ]

  if (!tags.length) {
    lines.push(
      '- Ninguno detectado ahora. Abre Ollama o LM Studio (Server :1234) y vuelve a preguntar.'
    )
  } else {
    for (const id of tags) {
      const role = /moondream|llava|vision|bakllava|minicpm-v/i.test(id)
        ? 'visión'
        : /coder|code|deepseek-coder/i.test(id)
          ? 'código'
          : 'chat'
      const star =
        active &&
        (id === active || id.startsWith(active) || active.startsWith(id.split(':')[0]))
          ? ' ← en uso'
          : ''
      lines.push(`- **${id}** — ${role}${star}`)
    }
  }

  lines.push('')
  lines.push(
    '_Groq / Gemini / OpenRouter son proveedores cloud (API keys), no modelos instalados en tu PC._'
  )
  if (/LM Studio|OpenAI-compatible OK/i.test(joined)) {
    lines.push('_LM Studio / API OpenAI-compatible: detectado en el chequeo._')
  }
  return lines.join('\n')
}

export function formatHostModelListReply(tags: string[], characterName?: string): string {
  const name = characterName || ''
  if (!tags.length) {
    return (
      (name ? `${name}: ` : '') +
      'No detecté modelos locales ahora. Abre Ollama o LM Studio (Server) y di *«rescanea modelos»*.'
    )
  }
  const lines = [(name ? `${name}: ` : '') + 'Modelos locales que veo:']
  for (const id of tags) {
    const role = /moondream|llava|vision/i.test(id)
      ? 'visión'
      : /coder|code/i.test(id)
        ? 'código'
        : 'chat'
    lines.push(`- **${id}** (${role})`)
  }
  lines.push('')
  lines.push('Si quieres, cambio el activo o te recomiendo uno según la tarea.')
  return lines.join('\n')
}

export function isHallucinatedModelList(text: string): boolean {
  const t = text || ''
  if (/Modelo\s*[ABC]\b|Nombre del modelo\s*\d/i.test(t)) return true
  if (/groq|gemini|openrouter/i.test(t) && /instalad/i.test(t) && /modelo/i.test(t)) {
    return true
  }
  return false
}

/**
 * Compact follow-up so the model can react to tool results (second micro-turn).
 */
export function buildToolObservationPrompt(
  observations: string[],
  opts?: { userGoal?: string; asksModels?: boolean }
): string {
  const asksModels = Boolean(opts?.asksModels)
  const real = observations.filter(Boolean).slice(0, 12).join('\n')
  return [
    'DATOS REALES del host (úsalos; no inventes):',
    real || '(sin observaciones)',
    '',
    'Responde en personaje, natural y breve.',
    asksModels
      ? 'Si pidió lista de modelos: una viñeta por cada nombre de DATOS REALES (locales). Nota corta (chat / visión / código). PROHIBIDO: "Modelo A/B/C", "Nombre del modelo N", y PROHIBIDO listar groq/gemini/openrouter como si fueran modelos instalados en disco.'
      : 'Resume el estado por CAPAS (chat local, Forge, música, voz, cloud keys) usando SOLO los DATOS REALES. Di qué está running y qué está stopped. Nunca digas "todo en orden" si alguna capa está caída o unknown.',
    'Prohibido: inventar modelos, volcar JSON, etiquetas APP_*, "plan[actions]", códigos crudos.',
    'Cloud keys ≠ modelos locales. Sé precisa y honesta.'
  ]
    .filter(Boolean)
    .join('\n')
}
