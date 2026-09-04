/**
 * Cloudflare Workers AI — FLUX.1 Schnell (free daily Neurons quota).
 * REST: POST /accounts/{id}/ai/run/@cf/black-forest-labs/flux-1-schnell
 */

export type CloudflareImageInput = {
  accountId: string
  apiToken: string
  prompt: string
  steps?: number
  seed?: number
  width?: number
  height?: number
  signal?: AbortSignal
}

export type CloudflareImageResult = {
  buf: Buffer
  contentType: string
  model: string
}

const MODEL = '@cf/black-forest-labs/flux-1-schnell'

export async function fetchCloudflareFlux(
  input: CloudflareImageInput
): Promise<CloudflareImageResult> {
  const accountId = (input.accountId || '').trim()
  // Tokens often get trailing newlines / spaces when pasted
  const token = (input.apiToken || '').trim().replace(/\s+/g, '')
  if (!accountId || !token) {
    const err = new Error('Falta Account ID o API Token de Cloudflare')
    ;(err as Error & { code?: string }).code = 'IMAGE_CF_NO_CREDS'
    throw err
  }

  const url =
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}` +
    `/ai/run/${MODEL}`

  const body: Record<string, unknown> = {
    // FLUX prefers clear English prose; already composed upstream
    prompt: input.prompt.slice(0, 2048)
  }
  // steps 4–8 (docs max 8)
  const steps = Math.min(8, Math.max(4, input.steps ?? 6))
  body.steps = steps
  // Some Workers AI builds accept width/height (multiples of 8, typically ≤1024)
  if (input.width && input.height) {
    const w = Math.min(1024, Math.max(256, Math.round(input.width / 8) * 8))
    const h = Math.min(1024, Math.max(256, Math.round(input.height / 8) * 8))
    body.width = w
    body.height = h
  }
  if (input.seed != null && Number.isFinite(input.seed)) {
    body.seed = Math.floor(Math.abs(input.seed))
  }

  const res = await fetch(url, {
    method: 'POST',
    signal: input.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as { errors?: Array<{ message?: string; code?: number }> }
      detail = j.errors?.map((e) => e.message).filter(Boolean).join('; ') || ''
    } catch {
      try {
        detail = (await res.text()).slice(0, 200)
      } catch {
        /* ignore */
      }
    }
    let hint = ''
    if (res.status === 401) {
      hint =
        ' Token inválido o Account ID de otra cuenta. Crea token en Workers AI → Use REST API (permiso Workers AI), pega Account ID del mismo dashboard y Guardar y probar.'
    } else if (res.status === 403) {
      hint = ' Token sin permiso Workers AI o modelo no permitido en el plan free.'
    }
    const err = new Error(
      `Cloudflare FLUX HTTP ${res.status}${detail ? `: ${detail}` : ''}.${hint}`
    )
    ;(err as Error & { code?: string }).code =
      res.status === 429
        ? 'IMAGE_RATE_LIMIT'
        : res.status === 401
          ? 'IMAGE_CF_AUTH'
          : 'IMAGE_CF_HTTP'
    throw err
  }

  const data = (await res.json()) as {
    success?: boolean
    result?: { image?: string } | string
    errors?: Array<{ message?: string }>
  }

  if (data.success === false) {
    const msg = data.errors?.map((e) => e.message).join('; ') || 'Cloudflare AI error'
    throw new Error(msg)
  }

  // result.image is base64 JPEG (sometimes nested)
  let b64 = ''
  const result = data.result as unknown
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    if (typeof r.image === 'string') b64 = r.image
    else if (r.result && typeof r.result === 'object' && typeof (r.result as { image?: string }).image === 'string') {
      b64 = String((r.result as { image: string }).image)
    }
  } else if (typeof result === 'string') {
    b64 = result
  }
  if (!b64) {
    throw new Error(
      'Cloudflare no devolvió imagen. ¿Token con permiso Workers AI? Respuesta: ' +
        JSON.stringify(data).slice(0, 180)
    )
  }
  // strip data URI prefix if present
  const pure = b64.replace(/^data:image\/[^;]+;base64,/, '')
  const buf = Buffer.from(pure, 'base64')
  if (buf.byteLength < 100) throw new Error('Imagen Cloudflare vacía')
  return {
    buf,
    contentType: 'image/jpeg',
    model: 'flux-1-schnell'
  }
}

export async function probeCloudflareAi(
  accountId: string,
  apiToken: string
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now()
  try {
    // Lightweight: models list or tiny run is heavy — just auth check via accounts
    // Global token verify (no account id required)
    const url = `https://api.cloudflare.com/client/v4/user/tokens/verify`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken.trim()}` },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `Token HTTP ${res.status}`
      }
    }
    return { ok: true, latencyMs: Date.now() - start }
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}
