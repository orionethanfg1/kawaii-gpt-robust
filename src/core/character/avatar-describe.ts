/**
 * Derive a concrete visual description from the avatar image.
 * Order: OpenRouter vision → Ollama vision → empty (caller must not invent).
 */

import { CLOUD_VISION_CANDIDATES, isVisionModelName } from '../vision/catalog'
import { localHttp } from '../providers/local-http'


export type DescribeAvatarResult = {
  description: string
  source: 'vision' | 'ollama' | 'none'
  error?: string
}

/** Strip VLM junk: leading !!!, markdown noise, repeated punctuation */
export function sanitizeVisualDescription(text: string | undefined | null): string {
  let t = String(text || '').trim()
  // Leading bangs / markdown / bullets (e.g. "!!! Niamh has red hair…")
  t = t.replace(/^[!！]{1,6}\s*/g, '')
  t = t.replace(/^[!?¡¿.#*\-\s]+/, '').trim()
  t = t.replace(/\s+/g, ' ')
  // Drop trailing model notes
  t = t.replace(/\s*\(as an AI\)\s*/gi, ' ').trim()
  // Strip reasoning / task-echo dumps (Gemma abliterated, "thinking" models)
  if (isJunkVisualDescription(t)) {
    // Try to salvage a trailing physical sentence
    const salvage = t.match(
      /(?:^|[.!?]\s+)((?:She|He|Niamh|[A-ZÁÉÍÓÚ][\wÁÉÍÓÚáéíóú]+)\s+(?:has|is|wears|with)[^.]{20,200}\.)/i
    )
    if (salvage?.[1] && !isJunkVisualDescription(salvage[1])) {
      t = salvage[1].trim()
    } else {
      t = ''
    }
  }
  return t.slice(0, 1400)
}

/** Reasoning / instruction echo — never store as appearance */
export function isJunkVisualDescription(text: string | undefined | null): boolean {
  const t = String(text || '')
  if (!t.trim()) return true
  if (
    /\b(Analyze the Request|Source Text|Rewrite \*?only\*?|Task:\s*\*?|the physical description in Latin)\b/i.test(
      t
    )
  ) {
    return true
  }
  if (/\*\*Task:\*\*|\*\*Source Text:\*\*|\*\*Analyze/i.test(t)) return true
  if (/^\s*\d+\.\s*\*\*/.test(t) && /Request|Task|Source/i.test(t)) return true
  if (/reasoning_content|chain[- ]of[- ]thought|<think>/i.test(t)) return true
  // Pure meta, no physical traits
  if (
    /rewrite|parafrase|traduce|translate/i.test(t) &&
    !/\b(hair|eyes|cabello|ojos|piel|dress|red hair)\b/i.test(t)
  ) {
    return true
  }
  return false
}

/** True if sheet is mostly English physical prose. */
export function looksEnglishVisualDescription(text: string | undefined | null): boolean {
  const t = sanitizeVisualDescription(text)
  if (t.length < 30) return false
  const es = (t.match(/\b(cabello|ojos|piel|vestido|mujer|tiene|lleva|rostro|pelo)\b/gi) || []).length
  const en = (t.match(/\b(has|hair|wearing|dress|she|her|eyes|shoulder|brooch)\b/gi) || []).length
  return en >= 3 && en > es
}

/** Weak / placeholder descriptions that must NOT be treated as physical facts */
export function isWeakVisualDescription(text: string | undefined | null): boolean {
  // Always evaluate on sanitized text (leading !!! / markdown must not mark a solid ficha as weak)
  const t = sanitizeVisualDescription(text)
  if (!t || t.length < 24) return true
  if (isJunkVisualDescription(t)) return true
  if (/aspecto definido por el avatar/i.test(t)) return true
  if (/rasgos coherentes con esa imagen/i.test(t)) return true
  if (/\[descripci[oó]n/i.test(t)) return true
  if (/seg[uú]n el avatar/i.test(t) && t.length < 120) return true
  // Must mention at least one concrete trait category
  const concrete =
    /\b(cabello|pelo|ojos|piel|rostro|cara|labios|nariz|cejas|maquillaje|vestimenta|ropa|estilo|anime|realista|hair|eyes|eye|skin|face|lips|nose|brows|makeup|clothes|clothing|dress|shirt|woman|man|girl|boy|portrait|shoulder|brooch)\b/i.test(
      t
    )
  return !concrete
}

function isHeavyOrReasoningModelId(id: string): boolean {
  const n = String(id || '').toLowerCase()
  // Abliterated / uncensored are bad for structured utility (task-echo).
  // Large VLMs (Gemma 26B non-abliterated) are OK for vision describe — not listed here.
  return /abliterat|uncensored|heretic|reasoning|r1\b|\bthink\b/i.test(n)
}

/** Vision-capable and safe for auto-description (never abliterated). */
export function isUsableVisionModelId(id: string): boolean {
  const n = String(id || '').toLowerCase()
  if (!n || isHeavyOrReasoningModelId(n)) return false
  return (
    isVisionModelName(n) ||
    /\bvlm\b|vision|llava|moondream|minicpm|qwen.*vl|gemma-?4|gemma4|pixtral|internvl/i.test(n)
  )
}

const DETAILED_DESC_PROMPT = (name: string) =>
  `Eres un observador visual preciso. Describe en español de México la apariencia de «${name}» ` +
  `en 5 a 10 frases densas y concretas (máx. ~180 palabras). Incluye TODO lo visible:\n` +
  `- Cabello: color, largo, textura, peinado, raíz/brillo\n` +
  `- Rostro: forma, ojos (color y forma), cejas, nariz, labios, expresión\n` +
  `- Piel: tono, marcas o pecas si se ven\n` +
  `- Cuerpo/silueta: complexión aparente, hombros, si se intuye contextura (sin inventar medidas exactas)\n` +
  `- Ropa y accesorios: colores, escote, tela, joyas, broches\n` +
  `- Postura y ambiente breve si aporta\n` +
  `Prohibido: listas numeradas, "Task", "Analyze", inglés meta, decir que eres una IA, inventar tallas numéricas no visibles.`

async function describeViaOpenRouter(
  dataUrl: string,
  key: string,
  baseUrl: string,
  name: string,
  preferredModel?: string
): Promise<string | null> {
  const base = baseUrl.replace(/\/$/, '')
  const models = [
    preferredModel,
    ...CLOUD_VISION_CANDIDATES.map((c) => c.model),
    'openrouter/free'
  ].filter(Boolean) as string[]

  for (const model of models) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': 'https://kawaii-gpt.local',
          'X-Title': 'KawaiiGPT Robust'
        },
        body: JSON.stringify({
          model,
          max_tokens: 280,
          temperature: 0.2,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    DETAILED_DESC_PROMPT(name)
                },
                { type: 'image_url', image_url: { url: dataUrl } }
              ]
            }
          ]
        })
      })
      if (!res.ok) continue
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const text = data.choices?.[0]?.message?.content?.trim()
      if (text && !isJunkVisualDescription(text) && !isWeakVisualDescription(text))
        return text.slice(0, 1400)
    } catch {
      /* try next */
    }
  }
  return null
}


async function describeViaOpenAI(
  dataUrl: string,
  key: string,
  name: string
): Promise<string | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 320,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  DETAILED_DESC_PROMPT(name)
              },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ]
      }),
      signal: AbortSignal.timeout(60_000)
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = data.choices?.[0]?.message?.content?.trim()
    if (text && text.length >= 20 && !isJunkVisualDescription(text)) return text.slice(0, 1400)
  } catch {
    /* ignore */
  }
  return null
}

async function describeViaOllama(
  dataUrl: string,
  name: string,
  ollamaBase = 'http://127.0.0.1:11434'
): Promise<{ text: string | null; detail?: string }> {
  try {
    const base = ollamaBase.replace(/\/\/$/, '')
    const tagsRes = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) })
    if (!tagsRes.ok) return { text: null, detail: `ollama tags HTTP ${tagsRes.status}` }
    const tags = (await tagsRes.json()) as { models?: Array<{ name: string }> }
    const names = (tags.models || []).map((m) => m.name)
    const usable = names.filter((n) => isUsableVisionModelId(n))
    const visionModel =
      usable.find((n) => /qwen.*vl|qwen2\.5vl/i.test(n)) ||
      usable.find((n) => /minicpm/i.test(n)) ||
      usable.find((n) => /llava/i.test(n)) ||
      usable.find((n) => /moondream/i.test(n)) ||
      usable.find((n) => /gemma/i.test(n)) ||
      usable[0]
    if (!visionModel) {
      return {
        text: null,
        detail: `sin modelo vision usable (instalados: ${names.slice(0, 6).join(', ') || 'ninguno'})`
      }
    }

    const b64 = (dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl).replace(/\s/g, '')
    if (!b64 || b64.length < 80) return { text: null, detail: 'imagen base64 invalida' }

    const prompt = DETAILED_DESC_PROMPT(name)

    // Prefer /api/generate (moondream)
    try {
      const res = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: visionModel,
          prompt,
          images: [b64],
          stream: false
        }),
        signal: AbortSignal.timeout(180_000)
      })
      const raw = await res.text()
      if (res.ok) {
        let text = ''
        try {
          const data = JSON.parse(raw) as { response?: string }
          text = (data.response || '').trim()
        } catch {
          text = raw.trim()
        }
        if (text.length >= 20 && !isJunkVisualDescription(text)) {
          return { text: text.slice(0, 1400), detail: `generate:${visionModel}` }
        }
      }
    } catch {
      /* try chat */
    }

    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: visionModel,
        stream: false,
        messages: [{ role: 'user', content: prompt, images: [b64] }]
      }),
      signal: AbortSignal.timeout(180_000)
    })
    const raw = await res.text()
    if (!res.ok) {
      return { text: null, detail: `chat HTTP ${res.status} (${visionModel}): ${raw.slice(0, 140)}` }
    }
    let text = ''
    try {
      const data = JSON.parse(raw) as { message?: { content?: string } }
      text = (data.message?.content || '').trim()
    } catch {
      text = raw.trim()
    }
    if (text.length >= 20) {
      return { text: text.slice(0, 700), detail: `chat:${visionModel}` }
    }
    return { text: null, detail: `respuesta corta/vacia (${visionModel})` }
  } catch (e) {
    return { text: null, detail: e instanceof Error ? e.message : String(e) }
  }
}


/** Strip model junk and optionally polish to Spanish via a text LLM (Ollama chat model). */
export async function polishVisualDescription(
  raw: string,
  opts?: {
    characterName?: string
    ollamaBaseUrl?: string
    chatModel?: string
    openRouterKey?: string
    openRouterBase?: string
    /** LM Studio / OpenAI-compatible local base */
    openAIBaseUrl?: string
    /** If true, never call LMS (avoids loading a second model while chat is loaded) */
    skipLmStudio?: boolean
  }
): Promise<string> {
  // Pre-sanitize without recursive junk wipe of good English vision text
  let t = String(raw || '')
    .replace(/^[!！]{1,6}\s*/g, '')
    .replace(/^[!?¡¿.#*\-\s]+/, '')
    .trim()
  if (isJunkVisualDescription(t)) return ''
  t = t.replace(/\s+/g, ' ').slice(0, 900)
  if (t.length < 12) return t

  const name = opts?.characterName || 'el personaje'
  // Plain instruction — avoid markdown that reasoning models "analyze"
  const prompt =
    `Describe en español de México (2 a 5 frases) el aspecto físico de ${name}. ` +
    `Solo hechos: cabello, ojos, piel, rostro, ropa. Sin listas numeradas, sin Task/Analyze, sin inglés meta. ` +
    `Base:\n${t}`

  const chatModel = (opts?.chatModel || '').trim()
  const isVisionId = /llava|moondream|vision|minicpm|vl\b/i.test(chatModel)

  // Prefer small Ollama chat models — never heavy/abliterated for this utility
  const base = (opts?.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
  const ollamaCandidates: string[] = []
  if (chatModel && !isVisionId && !isHeavyOrReasoningModelId(chatModel)) {
    ollamaCandidates.push(chatModel)
  }
  // Discover light Ollama tags
  try {
    const tagsRes = await localHttp(`${base}/api/tags`, { method: 'GET', timeoutMs: 4_000 })
    if (tagsRes.ok) {
      const tj = (await tagsRes.json()) as { models?: { name?: string }[] }
      for (const m of tj.models || []) {
        const n = String(m.name || '')
        if (!n || isVisionModelName(n) || isHeavyOrReasoningModelId(n)) continue
        if (/qwen|llama|phi|mistral|gemma2|gemma:2/i.test(n) && !ollamaCandidates.includes(n)) {
          ollamaCandidates.push(n)
        }
      }
    }
  } catch {
    /* */
  }

  for (const model of ollamaCandidates.slice(0, 3)) {
    try {
      const res = await localHttp(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.2, num_predict: 220 }
        }),
        timeoutMs: 45_000
      })
      if (res.ok) {
        const data = (await res.json()) as { response?: string }
        const out = String(data.response || '')
          .replace(/^[!！*\s]+/, '')
          .trim()
        if (out.length >= 24 && !isJunkVisualDescription(out) && !isWeakVisualDescription(out)) {
          return out.slice(0, 700)
        }
      }
    } catch {
      /* next */
    }
  }

  // LMS: only if explicitly allowed AND a light model is already LOADED (never load another)
  const openAiBase = (opts?.openAIBaseUrl || 'http://127.0.0.1:1234')
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '')
  if (!opts?.skipLmStudio && !isVisionId) {
    try {
      const listRes = await localHttp(`${openAiBase}/v1/models`, {
        method: 'GET',
        timeoutMs: 4_000
      })
      if (listRes.ok) {
        const lj = (await listRes.json()) as {
          data?: { id?: string; state?: string }[]
        }
        const loaded = (lj.data || [])
          .filter((m) => String(m.state || '') === 'loaded')
          .map((m) => String(m.id || ''))
          .filter(Boolean)
        // Prefer light loaded models; skip abliterated/26B for polish
        const lightLoaded = loaded.filter((id) => !isHeavyOrReasoningModelId(id))
        const modelId = lightLoaded[0] || ''
        if (modelId) {
          const res = await localHttp(`${openAiBase}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer lm-studio'
            },
            body: JSON.stringify({
              model: modelId,
              temperature: 0.2,
              max_tokens: 280,
              messages: [{ role: 'user', content: prompt }]
            }),
            timeoutMs: 60_000
          })
          if (res.ok) {
            const data = (await res.json()) as {
              choices?: Array<{ message?: { content?: string } }>
            }
            const out = String(data.choices?.[0]?.message?.content || '')
              .replace(/^[!！*\s]+/, '')
              .trim()
            if (out.length >= 24 && !isJunkVisualDescription(out) && !isWeakVisualDescription(out)) {
              return out.slice(0, 700)
            }
          }
        }
      }
    } catch {
      /* fall through */
    }
  }

  // OpenRouter free text if key present
  const key = (opts?.openRouterKey || '').trim()
  if (key.length >= 8) {
    const apiBase = (opts?.openRouterBase || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
    for (const model of [
      'google/gemini-2.0-flash-exp:free',
      'google/gemini-flash-1.5:free',
      'openrouter/free'
    ]) {
      try {
        const res = await fetch(`${apiBase}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
            'HTTP-Referer': 'https://kawaii-gpt.local',
            'X-Title': 'KawaiiGPT Robust'
          },
          body: JSON.stringify({
            model,
            max_tokens: 320,
            temperature: 0.2,
            messages: [{ role: 'user', content: prompt }]
          }),
          signal: AbortSignal.timeout(60_000)
        })
        if (!res.ok) continue
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>
        }
        const out = (data.choices?.[0]?.message?.content || '')
          .trim()
          .replace(/^[!?¡¿.#*\-\s]+/, '')
        if (out.length >= 24) return out.slice(0, 700)
      } catch {
        continue
      }
    }
  }

  // Heuristic: if mostly English and no Spanish polish available, return cleaned English
  return t.slice(0, 700)
}


async function describeViaLmStudio(
  dataUrl: string,
  name: string,
  openAIBaseUrl = 'http://127.0.0.1:1234'
): Promise<{ text: string | null; detail?: string }> {
  const root = openAIBaseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '')
  try {
    const listRes = await localHttp(`${root}/v1/models`, { method: 'GET', timeoutMs: 6_000 })
    if (!listRes.ok) return { text: null, detail: `lms models HTTP ${listRes.status}` }
    const lj = (await listRes.json()) as {
      data?: { id?: string; state?: string; type?: string; capabilities?: string[] }[]
    }
    const rows = lj.data || []
    const scored = rows
      .map((m) => {
        const id = String(m.id || '')
        const state = String(m.state || '')
        const type = String(m.type || '')
        const caps = (m.capabilities || []).join(' ')
        const usable = isUsableVisionModelId(id) || /\bvlm\b/i.test(type)
        if (!usable) return null
        let score = 0
        if (/loaded|active/i.test(state)) score += 100
        if (/\bvlm\b/i.test(type) || /vision/i.test(caps)) score += 40
        if (/qwen.*vl|llava|moondream|minicpm/i.test(id)) score += 30
        if (/gemma-?4|gemma4/i.test(id) && !isHeavyOrReasoningModelId(id)) score += 20
        if (isHeavyOrReasoningModelId(id)) score -= 200
        return { id, score, state }
      })
      .filter(Boolean) as { id: string; score: number; state: string }[]
    scored.sort((a, b) => b.score - a.score)
    // Prefer already loaded usable VLM; never abliterated
    const pick =
      scored.find((s) => /loaded|active/i.test(s.state) && s.score > 0) ||
      scored.find((s) => s.score > 0)
    if (!pick) {
      return {
        text: null,
        detail:
          'lms sin VLM usable (omite abliterated/uncensored; carga un modelo vision en LMS o usa moondream en Ollama)'
      }
    }
    // Only request the already-loaded model if one is loaded — avoid dual load
    const anyLoaded = rows.some((m) => /loaded|active/i.test(String(m.state || '')))
    const modelId =
      anyLoaded && !/loaded|active/i.test(pick.state)
        ? null
        : pick.id
    if (!modelId) {
      return {
        text: null,
        detail: `lms tiene otro modelo cargado; no se fuerza load de «${pick.id}». Usa Ollama vision o descarga el chat actual si es VLM no-abliterated.`
      }
    }
    const res = await localHttp(`${root}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer lm-studio'
      },
      body: JSON.stringify({
        model: modelId,
        temperature: 0.25,
        max_tokens: 600,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: DETAILED_DESC_PROMPT(name) },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ]
      }),
      timeoutMs: 180_000
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      return { text: null, detail: `lms chat HTTP ${res.status}: ${err.slice(0, 120)}` }
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = String(data.choices?.[0]?.message?.content || '').trim()
    if (text.length >= 24 && !isJunkVisualDescription(text)) {
      return { text: text.slice(0, 1400), detail: `lms:${modelId}` }
    }
    return { text: null, detail: `lms respuesta corta/basura (${modelId})` }
  } catch (e) {
    return {
      text: null,
      detail: e instanceof Error ? e.message : String(e)
    }
  }
}

export async function describeAvatarFromDataUrl(
  dataUrl: string,
  opts?: {
    apiKey?: string
    openaiKey?: string
    baseUrl?: string
    model?: string
    characterName?: string
    ollamaBaseUrl?: string
    openAIBaseUrl?: string
  }
): Promise<DescribeAvatarResult> {
  const key = (opts?.apiKey || '').trim()
  const name = opts?.characterName || 'el personaje'
  const errors: string[] = []

  // OpenAI vision (gpt-4o-mini) — highest quality when key present
  const openaiKey = (opts as { openaiKey?: string })?.openaiKey || ''
  if (openaiKey.trim().length >= 8) {
    const text = await describeViaOpenAI(dataUrl, openaiKey.trim(), name)
    if (text) return { description: text, source: 'vision' }
    errors.push('openai-vision-failed')
  }

  if (key.length >= 8) {
    const text = await describeViaOpenRouter(
      dataUrl,
      key,
      opts?.baseUrl || 'https://openrouter.ai/api/v1',
      name,
      opts?.model
    )
    if (text) return { description: text, source: 'vision' }
    errors.push('openrouter-vision-failed')
  } else if (!openaiKey.trim()) {
    errors.push('no-openrouter-key')
  }

  const ollamaRes = await describeViaOllama(
    dataUrl,
    name,
    opts?.ollamaBaseUrl || 'http://127.0.0.1:11434'
  )
  if (ollamaRes.text) {
    return { description: ollamaRes.text, source: 'ollama' }
  }
  errors.push(ollamaRes.detail ? `ollama:${ollamaRes.detail}` : 'ollama-vision-unavailable')

  // LM Studio VLM (non-abliterated only). Uses loaded vision model when possible.
  const lmsBase =
    (opts as { openAIBaseUrl?: string })?.openAIBaseUrl || 'http://127.0.0.1:1234'
  const lmsRes = await describeViaLmStudio(dataUrl, name, lmsBase)
  if (lmsRes.text) {
    return { description: lmsRes.text, source: 'vision' }
  }
  errors.push(lmsRes.detail ? `lms:${lmsRes.detail}` : 'lms-vision-unavailable')

  if (!errors.length) errors.push('vision-failed')

  return {
    description: '',
    source: 'none',
    error: errors.join('; ')
  }
}


/**
 * Enrich visual description using principal + gallery references (outfits/scenes).
 * Uses local vision first when possible; merges into one Spanish physical sheet.
 */
export async function describeCharacterFromGallery(
  images: Array<{ dataUrl: string; label?: string; isPrimary?: boolean }>,
  opts?: {
    apiKey?: string
    openaiKey?: string
    baseUrl?: string
    model?: string
    characterName?: string
    ollamaBaseUrl?: string
    chatModel?: string
    openAIBaseUrl?: string
  }
): Promise<DescribeAvatarResult & { parts?: number }> {
  const list = (images || [])
    .filter((i) => i?.dataUrl && String(i.dataUrl).startsWith('data:'))
    .slice(0, 6)
  if (!list.length) {
    return { description: '', source: 'none', error: 'sin imágenes en galería', parts: 0 }
  }

  const ordered = [...list].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0))
  const primary = ordered[0]
  const rest = ordered.slice(1, 4)
  const name = opts?.characterName || 'el personaje'

  const primaryRes = await describeAvatarFromDataUrl(primary.dataUrl, opts)
  if (!primaryRes.description || primaryRes.source === 'none') {
    return { ...primaryRes, parts: 0 }
  }

  const outfitNotes: string[] = []
  for (const img of rest) {
    const label = (img.label || '').trim()
    const r = await describeAvatarFromDataUrl(img.dataUrl, opts)
    if (r.description && r.source !== 'none' && !isWeakVisualDescription(r.description)) {
      const note = label
        ? `Variante (${label}): ${r.description.slice(0, 220)}`
        : `Variante de vestuario/escena: ${r.description.slice(0, 220)}`
      outfitNotes.push(note)
    }
  }

  let merged = primaryRes.description.trim()
  if (outfitNotes.length) {
    merged +=
      '\n\nVariedad de apariencia (mismos rasgos faciales; cambia ropa/escena):\n- ' +
      outfitNotes.join('\n- ')
  }
  if (merged.length > 1200) merged = merged.slice(0, 1190) + '…'

  try {
    const polished = await polishVisualDescription(merged, {
      characterName: name,
      ollamaBaseUrl: opts?.ollamaBaseUrl,
      chatModel: opts?.chatModel,
      openRouterKey: opts?.apiKey
    })
    if (polished && polished.length >= 40 && !isWeakVisualDescription(polished)) {
      merged = polished.slice(0, 1200)
    }
  } catch {
    /* keep */
  }

  return {
    description: merged,
    source: primaryRes.source,
    parts: 1 + outfitNotes.length
  }
}
