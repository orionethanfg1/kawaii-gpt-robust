/**
 * Derive a concrete visual description from the avatar image.
 * Order: OpenRouter vision → Ollama vision → empty (caller must not invent).
 */

import { CLOUD_VISION_CANDIDATES, isVisionModelName } from '../vision/catalog'


export type DescribeAvatarResult = {
  description: string
  source: 'vision' | 'ollama' | 'none'
  error?: string
}

/** Weak / placeholder descriptions that must NOT be treated as physical facts */
export function isWeakVisualDescription(text: string | undefined | null): boolean {
  const t = (text || '').trim()
  if (t.length < 24) return true
  if (/aspecto definido por el avatar/i.test(t)) return true
  if (/rasgos coherentes con esa imagen/i.test(t)) return true
  if (/\[descripci[oó]n/i.test(t)) return true
  if (/seg[uú]n el avatar/i.test(t) && t.length < 120) return true
  // Must mention at least one concrete trait category
  const concrete =
    /\b(cabello|pelo|ojos|piel|rostro|cara|labios|nariz|cejas|maquillaje|vestimenta|ropa|estilo|anime|realista|hair|eyes|eye|skin|face|lips|nose|brows|makeup|clothes|clothing|dress|shirt|woman|man|girl|boy|portrait)\b/i.test(
      t
    )
  return !concrete
}

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
                    `Describe en español la apariencia física de esta persona/personaje en 3-5 frases concretas. ` +
                    `Incluye OBLIGATORIAMENTE: color y largo del cabello, color y forma de ojos, tono de piel, forma de rostro, ` +
                    `expresión, ropa o estilo visible. Sin metáforas vacías. No digas "avatar" ni "IA". Nombre: ${name}.`
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
      if (text && !isWeakVisualDescription(text)) return text.slice(0, 700)
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
                  `Describe en español la apariencia física de esta persona/personaje en 3-5 frases concretas. ` +
                  `Incluye: color y largo del cabello, color y forma de ojos, tono de piel, forma de rostro, ` +
                  `expresión, ropa o estilo visible. Sin metáforas vacías. Nombre: ${name}.`
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
    if (text && text.length >= 20) return text.slice(0, 700)
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
    const visionModel =
      names.find((n) => isVisionModelName(n) && /qwen/i.test(n)) ||
      names.find((n) => isVisionModelName(n) && /minicpm/i.test(n)) ||
      names.find((n) => isVisionModelName(n) && /llava/i.test(n)) ||
      names.find((n) => isVisionModelName(n) && /moondream/i.test(n)) ||
      names.find((n) => isVisionModelName(n))
    if (!visionModel) {
      return {
        text: null,
        detail: `sin modelo vision (instalados: ${names.slice(0, 6).join(', ') || 'ninguno'})`
      }
    }

    const b64 = (dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl).replace(/\s/g, '')
    if (!b64 || b64.length < 80) return { text: null, detail: 'imagen base64 invalida' }

    const prompt =
      `Describe this person's physical appearance in 3-5 concrete sentences (Spanish preferred). ` +
      `Include: hair color/length, eye color, skin tone, face shape, clothing/style. ` +
      `No metaphors. Character name: ${name}.`

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
        if (text.length >= 20) {
          return { text: text.slice(0, 700), detail: `generate:${visionModel}` }
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
  }
): Promise<string> {
  let t = (raw || '').trim()
  // Remove leading junk from tiny VLMs
  t = t.replace(/^[!?¡¿.#*\-\s]+/, '').trim()
  t = t.replace(/\s+/g, ' ')
  if (t.length < 12) return t

  const name = opts?.characterName || 'el personaje'
  const prompt =
    `Reescribe SOLO en español neutro (2-5 frases) la descripción física siguiente. ` +
    `Conserva todos los rasgos concretos (cabello, ojos, piel, ropa, rostro). ` +
    `Sin emojis, sin "!!", sin decir que eres una IA. Personaje: ${name}.\n\n` +
    `Texto original:\n${t.slice(0, 900)}`

  // Prefer local Ollama text model (not vision)
  const base = (opts?.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
  const chatModel = (opts?.chatModel || '').trim()
  if (chatModel && !/llava|moondream|vision|minicpm|vl\b/i.test(chatModel)) {
    try {
      const res = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatModel,
          prompt,
          stream: false,
          options: { temperature: 0.2, num_predict: 280 }
        }),
        signal: AbortSignal.timeout(90_000)
      })
      if (res.ok) {
        const data = (await res.json()) as { response?: string }
        const out = (data.response || '').trim().replace(/^[!?¡¿.#*\-\s]+/, '')
        if (out.length >= 24) return out.slice(0, 700)
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

export async function describeAvatarFromDataUrl(
  dataUrl: string,
  opts?: {
    apiKey?: string
    openaiKey?: string
    baseUrl?: string
    model?: string
    characterName?: string
    ollamaBaseUrl?: string
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
  // Helpful combined error for UI
  if (!errors.length) errors.push('vision-failed')

  // Do NOT return a fake "aspecto definido por el avatar" — empty forces honest UX
  return {
    description: '',
    source: 'none',
    error: errors.join('; ')
  }
}
