/**
 * A1111 / Forge txt2img + img2img + ControlNet (IP-Adapter + structural).
 */

export type IpAdapterPayload = {
  model: string
  module: string
  weight: number
  image: string
}

export type ControlNetArg = {
  enabled: boolean
  module: string
  model: string
  weight: number
  image: string
  resize_mode?: string
  guidance_start?: number
  guidance_end?: number
  control_mode?: string
  pixel_perfect?: boolean
}

function toB64(image: string): string {
  if (image.startsWith('data:image/')) {
    return image.slice(image.indexOf(',') + 1).replace(/\s/g, '')
  }
  return image
}

export async function fetchA1111Image(
  baseUrl: string,
  prompt: string,
  negative: string,
  width: number,
  height: number,
  steps: number,
  cfg: number,
  seed: number | undefined,
  signal: AbortSignal,
  checkpoint?: string,
  referenceImage?: string,
  denoisingStrength = 0.42,
  ipAdapter?: IpAdapterPayload,
  /** Extra ControlNet units (openpose/canny/…) — stacked after IP-Adapter */
  extraControlNet?: ControlNetArg[],
  /**
   * Never use img2img (avatar as init). FaceID must go through ControlNet on txt2img.
   * img2img from full avatar locks outfit/pose and ignores scene prompts.
   */
  forceTxt2Img = true,
  batchSize = 1
): Promise<{
  buf: Buffer
  contentType: string
  info?: string
  model?: string
  mode?: string
  batchSize?: number
  extraBuffers?: Buffer[]
}> {
  const root = baseUrl.replace(/\/$/, '')
  const useHighResFix = Math.max(width, height) > 1024
  const firstPassWidth = useHighResFix ? Math.max(256, Math.round(width / 16) * 8) : width
  const firstPassHeight = useHighResFix ? Math.max(256, Math.round(height / 16) * 8) : height
  const body: Record<string, unknown> = {
    prompt,
    negative_prompt: negative || '',
    width: firstPassWidth,
    height: firstPassHeight,
    steps,
    cfg_scale: cfg,
    seed: seed ?? -1,
    sampler_name: 'Euler a',
    // C3: FaceID/ControlNet — never batch>1 (KeyError postprocess)
    batch_size: (() => {
      const n = Math.min(4, Math.max(1, Math.floor(batchSize) || 1))
      const facePath =
        Boolean(ipAdapter?.model) ||
        /faceid/i.test(String(ipAdapter?.module || '') + String(ipAdapter?.model || ''))
      return facePath ? 1 : n
    })(),
    n_iter: 1,
    enable_hr: useHighResFix,
    ...(useHighResFix
      ? {
          hr_scale: 2,
          hr_resize_x: width,
          hr_resize_y: height,
          hr_upscaler: 'Latent',
          hr_second_pass_steps: Math.min(20, Math.max(12, Math.round(steps / 2))),
          denoising_strength: 0.35
        }
      : {})
  }
  if (checkpoint && checkpoint.trim()) {
    body.override_settings = { sd_model_checkpoint: checkpoint.trim() }
    body.override_settings_restore_afterwards = true
  }

  let endpoint = `${root}/sdapi/v1/txt2img`
  const hasCn =
    Boolean(ipAdapter?.model) || Boolean(extraControlNet && extraControlNet.length)
  // Default: txt2img only. img2img from avatar was locking clothing/scene (feedback dislikes).
  // Only allow img2img when explicitly requested (!forceTxt2Img) and no ControlNet FaceID.
  const useImg2Img =
    !forceTxt2Img &&
    Boolean(referenceImage?.startsWith('data:image/')) &&
    !hasCn &&
    denoisingStrength >= 0.55

  let mode = 'txt2img'
  if (useImg2Img && referenceImage) {
    const encoded = toB64(referenceImage)
    if (encoded.length > 80) {
      endpoint = `${root}/sdapi/v1/img2img`
      body.init_images = [encoded]
      body.denoising_strength = Math.min(0.85, Math.max(0.55, denoisingStrength))
      body.resize_mode = 0
      mode = 'img2img'
    }
  }

  const args: ControlNetArg[] = []
  if (ipAdapter?.model && ipAdapter.image) {
    const isFace = /faceid/i.test(ipAdapter.module + ipAdapter.model)
    args.push({
      enabled: true,
      module: ipAdapter.module,
      model: ipAdapter.model,
      weight: ipAdapter.weight,
      image: toB64(ipAdapter.image),
      resize_mode: 'Crop and Resize',
      guidance_start: 0,
      // P1 identity: FaceID must stay active for full sampling (was 0.92 + prompt-wins → cara genérica)
      guidance_end: isFace ? 1 : 1,
      // FaceID locks identity; prompt still drives pose/outfit via weight ≤ 0.95
      control_mode: isFace ? 'ControlNet is more important' : 'Balanced',
      pixel_perfect: true
    })
  }
  if (extraControlNet?.length) {
    for (const u of extraControlNet) {
      if (!u.model) continue
      args.push({
        enabled: u.enabled !== false,
        module: u.module,
        model: u.model,
        weight: u.weight,
        image: toB64(u.image),
        resize_mode: u.resize_mode || 'Crop and Resize',
        guidance_start: u.guidance_start ?? 0,
        guidance_end: u.guidance_end ?? 0.85,
        control_mode: u.control_mode || 'Balanced',
        pixel_perfect: u.pixel_perfect !== false
      })
    }
  }
  if (args.length) {
    body.alwayson_scripts = {
      ControlNet: { args }
    }
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `A1111 HTTP 404 en ${endpoint} — Forge sin --api o URL incorrecta. Usa Arrancar Forge desde la app.`
        : `A1111 HTTP ${res.status} en ${endpoint}`
    )
  }
  const data = (await res.json()) as { images?: string[]; info?: string }
  const imgs = data.images || []
  if (!imgs.length) throw new Error('A1111 no devolvió imagen')
  const buffers = imgs.map((b64) => Buffer.from(b64, 'base64'))
  const buf = buffers[0]
  return {
    buf,
    contentType: 'image/png',
    info: data.info,
    model: checkpoint?.trim() || 'stable-diffusion',
    mode,
    batchSize: buffers.length,
    extraBuffers: buffers.length > 1 ? buffers.slice(1) : undefined
  }
}

/** Probe ControlNet model list for FaceID / structural */
export async function listControlNetModels(
  baseUrl: string,
  signal?: AbortSignal
): Promise<string[]> {
  const root = baseUrl.replace(/\/$/, '')
  try {
    const res = await fetch(`${root}/controlnet/model_list`, {
      signal: signal || AbortSignal.timeout(5000)
    })
    if (!res.ok) return []
    const raw = await res.json()
    const { parseControlNetModelList } = await import('../core/image/ip-adapter')
    return parseControlNetModelList(raw)
  } catch {
    return []
  }
}
