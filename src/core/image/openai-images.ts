/**
 * OpenAI Images API — same API key as chat (sk- / sk-proj-).
 * POST https://api.openai.com/v1/images/generations
 */

export type OpenAIImageResult = {
  buf: Buffer
  contentType: string
  model: string
  revisedPrompt?: string
}

export function openAIImageSize(width: number, height: number): string {
  const w = width || 1024
  const h = height || 1024
  const ratio = w / h
  if (Math.abs(ratio - 1) < 0.15) return '1024x1024'
  if (ratio > 1.2) return '1536x1024'
  if (ratio < 0.85) return '1024x1536'
  return '1024x1024'
}

function dallE3Size(size: string): string {
  if (size === '1536x1024') return '1792x1024'
  if (size === '1024x1536') return '1024x1792'
  return '1024x1024'
}

export async function generateOpenAIImage(opts: {
  apiKey: string
  prompt: string
  width?: number
  height?: number
  model?: string
  signal?: AbortSignal
}): Promise<OpenAIImageResult> {
  const key = (opts.apiKey || '').trim()
  if (key.length < 8) throw new Error('OpenAI API key ausente')

  const size = openAIImageSize(opts.width ?? 1024, opts.height ?? 1024)
  const prompt = opts.prompt.slice(0, 4000)
  const candidates = [
    (opts.model || '').trim(),
    'gpt-image-1.5',
    'gpt-image-1',
    'dall-e-3'
  ].filter((m, i, a) => Boolean(m) && a.indexOf(m) === i)

  let lastErr = 'OpenAI Images falló'
  for (const model of candidates) {
    const body: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      size: model.startsWith('dall-e') ? dallE3Size(size) : size
    }
    if (model.startsWith('dall-e')) {
      body.response_format = 'b64_json'
      if (model === 'dall-e-3') body.quality = 'standard'
    } else {
      body.quality = 'auto'
    }

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal: opts.signal
    })

    const raw = await res.text()
    if (!res.ok) {
      let detail = raw.slice(0, 240)
      try {
        const j = JSON.parse(raw) as { error?: { message?: string } }
        if (j.error?.message) detail = j.error.message
      } catch {
        /* keep */
      }
      lastErr = `OpenAI Images HTTP ${res.status} (${model}): ${detail}`
      continue
    }

    const data = JSON.parse(raw) as {
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>
    }
    const item = data.data?.[0]
    if (!item) {
      lastErr = `OpenAI Images vacía (${model})`
      continue
    }
    if (item.b64_json) {
      return {
        buf: Buffer.from(item.b64_json, 'base64'),
        contentType: 'image/png',
        model,
        revisedPrompt: item.revised_prompt
      }
    }
    if (item.url) {
      const imgRes = await fetch(item.url, { signal: opts.signal })
      if (!imgRes.ok) {
        lastErr = `OpenAI download HTTP ${imgRes.status}`
        continue
      }
      const ab = await imgRes.arrayBuffer()
      return {
        buf: Buffer.from(ab),
        contentType: imgRes.headers.get('content-type') || 'image/png',
        model,
        revisedPrompt: item.revised_prompt
      }
    }
  }
  throw new Error(lastErr)
}
