/**
 * Map local runtime errors (LM Studio / Ollama) to actionable Spanish messages.
 * Goal: app owns recovery UX instead of raw JSON 500s.
 */

export type RuntimeErrorKind =
  | 'image_not_supported'
  | 'mmproj_missing'
  | 'model_not_loaded'
  | 'oom'
  | 'timeout'
  | 'auth'
  | 'connection'
  | 'empty_response'
  | 'unknown'

export type ClassifiedRuntimeError = {
  kind: RuntimeErrorKind
  /** Short user-facing line */
  title: string
  /** What to do next */
  hint: string
  /** Original fragment (truncated) */
  raw?: string
}

export function classifyRuntimeError(raw: unknown): ClassifiedRuntimeError {
  const s = String(
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'message' in (raw as object)
        ? (raw as { message?: string }).message
        : JSON.stringify(raw)
  ).slice(0, 800)

  const low = s.toLowerCase()

  if (
    /image input is not supported|images? (are )?not supported|does not support image/i.test(s) ||
    (/mmproj/i.test(s) && /image|vision|multimodal/i.test(s))
  ) {
    return {
      kind: 'image_not_supported',
      title: 'Este modelo no acepta imágenes',
      hint:
        'Es solo texto (p. ej. uncensored/heretic sin visión). Quita el adjunto de imagen, usa un modelo visión (moondream/llava) o describe la foto en texto.',
      raw: s
    }
  }
  if (/mmproj/i.test(s)) {
    return {
      kind: 'mmproj_missing',
      title: 'Falta el proyector de visión (mmproj)',
      hint:
        'El GGUF multimodal necesita el archivo .mmproj junto al modelo en LM Studio. Sin él no puede procesar imágenes.',
      raw: s
    }
  }
  if (/model .+ not (found|loaded)|no such model|failed to load/i.test(s)) {
    return {
      kind: 'model_not_loaded',
      title: 'Modelo no cargado o no encontrado',
      hint: 'Abre LM Studio / Ollama, carga el modelo o elige otro en Auto.',
      raw: s
    }
  }
  if (/out of memory|oom|cuda|insufficient memory|vram/i.test(low)) {
    return {
      kind: 'oom',
      title: 'Sin memoria suficiente (RAM/VRAM)',
      hint: 'Descarga otros modelos, usa un cuantizado más ligero o cierra programas pesados.',
      raw: s
    }
  }
  if (/timeout|timed out|aborted/i.test(low)) {
    return {
      kind: 'timeout',
      title: 'Tiempo de espera agotado',
      hint: 'El modelo local tarda demasiado. Prueba un modelo más pequeño o sube el timeout.',
      raw: s
    }
  }
  if (/401|403|unauthorized|authentication|invalid api key/i.test(low)) {
    return {
      kind: 'auth',
      title: 'Autenticación del runtime',
      hint: 'Si LM Studio exige auth, pon el token en Modelos → Token LM Studio.',
      raw: s
    }
  }
  if (/econnrefused|fetch failed|network|failed to fetch|connection/i.test(low)) {
    return {
      kind: 'connection',
      title: 'No hay conexión con el runtime local',
      hint: 'Arranca Ollama o LM Studio Server (puerto 11434 / 1234).',
      raw: s
    }
  }
  if (/no content|nothing to say|empty response/i.test(low)) {
    return {
      kind: 'empty_response',
      title: 'Respuesta vacía del modelo',
      hint:
        'A veces falla la plantilla (thinking) o el request multimodal. Reintenta sin imagen o con otro modelo.',
      raw: s
    }
  }
  return {
    kind: 'unknown',
    title: 'Error del motor local',
    hint: 'Revisa LM Studio / Ollama. Si el mensaje menciona imagen o mmproj, usa un modelo de texto sin adjuntos visuales.',
    raw: s
  }
}

export function formatRuntimeErrorForUser(err: ClassifiedRuntimeError): string {
  return `${err.title}. ${err.hint}`
}

/** True if model id looks vision-capable (heuristic). */
export function modelLooksVisionCapable(modelId: string): boolean {
  return /llava|moondream|bakllava|vision|minicpm-v|qwen2(\.|-)?vl|qwen2\.5-vl|pixtral|internvl|phi-3-vision|llama[-.]?3\.2.*vision|gemma.?4/i.test(
    modelId || ''
  )
}

/**
 * Strip multimodal parts from message content when the target model is text-only.
 * Handles string content and OpenAI-style content arrays.
 */
export function sanitizeMessagesForModel(
  messages: Array<{ role: string; content: unknown }>,
  modelId: string
): {
  messages: Array<{ role: string; content: unknown }>
  strippedImages: boolean
} {
  if (modelLooksVisionCapable(modelId)) {
    return { messages, strippedImages: false }
  }
  let strippedImages = false
  const out = messages.map((m) => {
    const c = m.content
    if (Array.isArray(c)) {
      const next: unknown[] = []
      for (const part of c) {
        if (
          part &&
          typeof part === 'object' &&
          ('type' in part
            ? /image/i.test(String((part as { type?: string }).type))
            : 'image_url' in part)
        ) {
          strippedImages = true
          continue
        }
        next.push(part)
      }
      if (!next.length) {
        return { ...m, content: '(imagen omitida: el modelo actual solo admite texto)' }
      }
      // Flatten single text part
      if (
        next.length === 1 &&
        next[0] &&
        typeof next[0] === 'object' &&
        (next[0] as { type?: string }).type === 'text'
      ) {
        return { ...m, content: String((next[0] as { text?: string }).text || '') }
      }
      return { ...m, content: next }
    }
    return m
  })
  return { messages: out, strippedImages }
}
