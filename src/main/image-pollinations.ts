/**
 * Pollinations.ai fetch helper (extracted from image-ipc).
 */
import { fitImageWithin } from '../core/image/image-size'

export async function fetchPollinationsImage(
  prompt: string,
  width: number,
  height: number,
  seed: number | undefined,
  signal: AbortSignal,
  opts?: { model?: string; enhance?: boolean }
): Promise<{ buf: Buffer; contentType: string }> {
  const lower = prompt.toLowerCase()
  const wantsPhoto = /\b(photo|photoreal|foto|realista|realistic|35mm|raw photo)\b/i.test(lower)
  // Flux tends to respect subjects better than the default turbo-anime bias
  const model = opts?.model || (wantsPhoto ? 'flux' : 'flux')
  let finalPrompt = prompt
  if (wantsPhoto && !/raw photo/i.test(prompt)) {
    finalPrompt =
      'RAW photo, photorealistic, accurate eye color and hair color as written, ' + prompt
  }
  // Pollinations has no negative_prompt — encode avoid list in the text
  if (wantsPhoto) {
    finalPrompt +=
      '. Avoid: anime, cartoon, illustration, painting, 3d render, purple fantasy hair if not requested'
  }
  const params = new URLSearchParams()
  const requestSize = fitImageWithin(width, height, 1280)
  params.set('width', String(requestSize.width))
  params.set('height', String(requestSize.height))
  params.set('nologo', 'true')
  params.set('model', model)
  params.set('enhance', opts?.enhance === false ? 'false' : 'true')
  if (seed != null && Number.isFinite(seed)) {
    params.set('seed', String(Math.floor(seed)))
  }
  const url =
    'https://image.pollinations.ai/prompt/' +
    encodeURIComponent(finalPrompt.slice(0, 1800)) +
    '?' +
    params.toString()

  let res: Response | null = null
  let lastStatus = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(url, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'image/*,*/*',
        'User-Agent': 'KawaiiGPT-Robust/0.3'
      }
    })
    lastStatus = res.status
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2000))
      continue
    }
    break
  }
  if (!res || !res.ok) {
    const err = new Error(`Pollinations HTTP ${lastStatus || 'error'}`)
    ;(err as Error & { code?: string }).code =
      lastStatus === 429 ? 'IMAGE_RATE_LIMIT' : 'IMAGE_BACKEND_DOWN'
    throw err
  }
  const contentType = res.headers.get('content-type') || 'image/png'
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength < 100) throw new Error('Imagen vacía o inválida')
  return { buf, contentType }
}
