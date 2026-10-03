/**
 * Image generation IPC (Pollinations + A1111/Forge + folders).
 * Extracted from main/index.ts for maintainability.
 */
import { app, ipcMain, nativeImage, shell } from 'electron'
import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { fetchA1111Image, listControlNetModels } from './image-a1111'
import { fitImageWithin, minimum2kImageSize, MIN_IMAGE_LONG_EDGE } from '../core/image/image-size'

const imageAbortControllers = new Map<string, AbortController>()

async function ensureImagesDir(): Promise<string> {
  const dir = join(app.getPath('userData'), 'images')
  await mkdir(dir, { recursive: true })
  return dir
}

async function fetchPollinationsImage(
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

ipcMain.handle('image:a1111Health', async (_e, baseUrl?: string) => {
  const start = Date.now()
  try {
    const { probeForgeHealth, scanForgeApiPorts, getForgeRuntimeStatus, refreshForgeHealth } =
      await import('./forge-runtime')

    // Prefer explicit URL, then runtime, then scan
    const candidates: string[] = []
    if (baseUrl) candidates.push(baseUrl.replace(/\/$/, ''))
    try {
      const st = getForgeRuntimeStatus()
      if (st.baseUrl) candidates.push(st.baseUrl.replace(/\/$/, ''))
    } catch {
      /* ignore */
    }
    // Always probe the full candidate list — settings may point at a dead port (e.g. 7890)
    try {
      const { FORGE_PORT_CANDIDATES } = await import('./forge-runtime')
      for (const p of FORGE_PORT_CANDIDATES) {
        candidates.push(`http://127.0.0.1:${p}`, `http://localhost:${p}`)
      }
    } catch {
      candidates.push('http://127.0.0.1:7860', 'http://localhost:7860')
    }

    let uiOnlyHint = ''
    let lastProbeErr = ''
    for (const root of [...new Set(candidates)]) {
      const h = await probeForgeHealth(root, 4500)
      if (h.ok) {
        try {
          await refreshForgeHealth()
        } catch {
          /* ignore */
        }
        return {
          ok: true,
          latencyMs: Date.now() - start,
          baseUrl: h.baseUrl || root,
          error: undefined
        }
      }
      lastProbeErr = h.error || lastProbeErr
      if ((h as { uiOnly?: boolean }).uiOnly) {
        uiOnlyHint =
          h.error ||
          'UI de Forge sin --api (txt2img 404). Cierra esa ventana y pulsa Arrancar Forge en la app.'
      }
    }

    const scan = await scanForgeApiPorts()
    if (scan.ok && scan.baseUrl) {
      try {
        await refreshForgeHealth()
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        latencyMs: Date.now() - start,
        baseUrl: scan.baseUrl
      }
    }
    if (uiOnlyHint) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: uiOnlyHint
      }
    }
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error:
        scan.error ||
        lastProbeErr ||
        'Forge/A1111 no responde. Capas → Arrancar Forge (API --nowebui) y espera a que health sea OK.'
    }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err)
    }
  }
})


ipcMain.handle('image:controlNetModels', async (_e, baseUrl?: string) => {
  try {
    const root = (baseUrl || process.env.A1111_BASE_URL || 'http://127.0.0.1:7860').replace(/\/$/, '')
    const models = await listControlNetModels(root, AbortSignal.timeout(8000))
    return { ok: true as const, models }
  } catch (e) {
    return {
      ok: false as const,
      models: [] as string[],
      error: e instanceof Error ? e.message : String(e)
    }
  }
})

ipcMain.handle('image:a1111Models', async (_e, baseUrl?: string) => {
  let root = (baseUrl || '').replace(/\/$/, '')
  if (!root) {
    try {
      const { getForgeRuntimeStatus } = await import('./forge-runtime')
      const st = getForgeRuntimeStatus()
      if (st.baseUrl) root = st.baseUrl.replace(/\/$/, '')
    } catch {
      /* ignore */
    }
  }
  if (!root) root = 'http://127.0.0.1:7860'

  const fromDisk = async () => {
    try {
      const { listInstalledCheckpoints } = await import('./sd-workspace')
      const installed = await listInstalledCheckpoints()
      return installed.map((m) => ({
        title: m.filename,
        modelName: m.filename,
        hash: undefined as string | undefined
      }))
    } catch {
      return [] as { title: string; modelName: string; hash: string | undefined }[]
    }
  }

  try {
    // Prefer disk: Forge /sd-models often 500 (pydantic config field) and floods logs
    {
      const diskFirst = await fromDisk()
      if (diskFirst.length > 0) {
        let current = ''
        try {
          const oc = new AbortController()
          const ot = setTimeout(() => oc.abort(), 3000)
          const optRes = await fetch(`${root}/sdapi/v1/options`, { signal: oc.signal })
          clearTimeout(ot)
          if (optRes.ok) {
            const opt = (await optRes.json()) as { sd_model_checkpoint?: string }
            current = opt.sd_model_checkpoint || ''
          }
        } catch {
          /* ignore */
        }
        return {
          ok: true,
          models: diskFirst,
          current,
          baseUrl: root,
          note: 'listado desde disco'
        }
      }
    }
    const paths = [`${root}/sdapi/v1/sd-models`]
    let lastErr = ''
    for (const url of paths) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        const res = await fetch(url, { signal: controller.signal })
        clearTimeout(timer)
        // Forge may return 500 on sd-models (pydantic "config" required) — still try body or disk
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`
          if (res.status >= 500) {
            try {
              const text = await res.text()
              // Fall through to disk list when API serialization is broken
              if (text.includes('config') || text.includes('ResponseValidationError')) {
                const disk = await fromDisk()
                if (disk.length) {
                  return { ok: true, models: disk, current: '', baseUrl: root, note: 'listado desde disco (sd-models 500)' }
                }
              }
            } catch {
              /* ignore */
            }
          }
          continue
        }
        const raw = (await res.json()) as Array<{
          title?: string
          model_name?: string
              hash?: string
          filename?: string
        }>
        let models = (Array.isArray(raw) ? raw : []).map((m) => ({
          title: String(m.title || m.model_name || m.filename || 'unknown'),
          modelName: String(m.model_name || m.title || ''),
          hash: m.hash ? String(m.hash) : undefined
        }))
        if (models.length === 0) {
          models = await fromDisk()
        }
        let current = ''
        try {
          const oc = new AbortController()
          const ot = setTimeout(() => oc.abort(), 3000)
          const optRes = await fetch(`${root}/sdapi/v1/options`, { signal: oc.signal })
          clearTimeout(ot)
          if (optRes.ok) {
            const opt = (await optRes.json()) as { sd_model_checkpoint?: string }
            current = opt.sd_model_checkpoint || ''
          }
        } catch {
          /* ignore */
        }
        return { ok: true as const, models, current }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }
    // API 404 / unreachable — still list checkpoints on disk so UI is useful
    const disk = await fromDisk()
    if (disk.length > 0) {
      return {
        ok: true as const,
        models: disk,
        current: '',
        note: lastErr ? `API: ${lastErr}; listando disco` : undefined
      }
    }
    return {
      ok: false as const,
      error: lastErr || 'Sin modelos',
      models: [] as { title: string; modelName: string }[]
    }
  } catch (err) {
    const disk = await fromDisk()
    if (disk.length > 0) {
      return { ok: true as const, models: disk, current: '' }
    }
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
      models: [] as { title: string; modelName: string }[]
    }
  }
})

ipcMain.handle('image:cloudflareProbe', async (_e, accountId?: string) => {
  try {
    const { probeCloudflareAi } = await import('./cloudflare-image')
    const acc = (accountId || '').trim()
    const token = String(secureStore.get('providerKey:cloudflare', '') || '')
    if (!acc || !token) {
      return { ok: false, error: 'Configura Account ID y Token' }
    }
    return await probeCloudflareAi(acc, token)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle(
  'image:generate',

  async (
    event,
    payload: {
      prompt: string
      negativePrompt?: string
      width?: number
      height?: number
      seed?: number
      timeoutMs?: number
      jobId?: string
      provider?: 'pollinations' | 'a1111' | 'cloudflare' | 'openai' | 'smart'
      a1111BaseUrl?: string
      steps?: number
      cfgScale?: number
      checkpoint?: string
      cloudflareAccountId?: string
      referenceImage?: string
      /** Canonical face reference first, followed by selected gallery views */
      referenceImages?: string[]
      referenceDenoisingStrength?: number
      /** FaceID / IP-Adapter weight override */
      ipAdapterWeight?: number
      /** I0: self-portrait — force FaceID path */
      isSelf?: boolean
      requireFaceId?: boolean
      /** Hito 3.4 force: openpose|canny|depth|softedge|lineart|none */
      controlNetKind?: string
      /** Human-readable title for disk filename */
      title?: string
    }
  ) => {
    const prompt = (payload?.prompt || '').trim()
    if (!prompt) {
      return { ok: false as const, code: 'IMAGE_INVALID_PROMPT', error: 'Prompt vacío' }
    }
    const jobId = payload.jobId || randomUUID()
    const controller = new AbortController()
    imageAbortControllers.set(jobId, controller)

    const requestedSize = minimum2kImageSize(payload.width ?? 1024, payload.height ?? 1024)
    const width = requestedSize.width
    const height = requestedSize.height
    const timeoutMs = Math.min(300_000, Math.max(15_000, payload.timeoutMs ?? 180_000))
    const providerPref = payload.provider || 'smart'

    const start = Date.now()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const saveBuf = async (buf: Buffer, contentType: string, providerId: string, model?: string) => {
      let outputBuf = buf
      let outputType = contentType
      let outputImage = nativeImage.createFromBuffer(buf)
      if (outputImage.isEmpty()) throw new Error('El proveedor devolvió un archivo de imagen inválido')
      const originalSize = outputImage.getSize()
      if (Math.max(originalSize.width, originalSize.height) < MIN_IMAGE_LONG_EDGE) {
        const targetSize = minimum2kImageSize(originalSize.width, originalSize.height)
        outputImage = outputImage.resize({ ...targetSize, quality: 'best' })
        outputBuf = outputImage.toPNG()
        outputType = 'image/png'
      }
      const dimensions = outputImage.getSize()
      const ext = outputType.includes('jpeg')
        ? 'jpg'
        : outputType.includes('webp')
          ? 'webp'
          : 'png'
      const mime =
        ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
      const dir = await ensureImagesDir()
      const slug = String(payload.title || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48)
        .toLowerCase()
      const fileName = slug
        ? `${slug}-${Date.now().toString(36)}.${ext}`
        : `img-${Date.now()}-${jobId.slice(0, 8)}.${ext}`
      const filePath = join(dir, fileName)
      await writeFile(filePath, outputBuf)
      return {
        ok: true as const,
        jobId,
        filePath,
        dataUrl: `data:${mime};base64,${outputBuf.toString('base64')}`,
        width: dimensions.width,
        height: dimensions.height,
        providerId,
        model,
        seed: payload.seed,
        latencyMs: Date.now() - start,
        prompt
      }
    }

    try {
      const sendProgress = (phase: string, pct: number, detail?: string) => {
        try {
          event.sender.send('image:generate-progress', {
            jobId,
            phase,
            pct,
            detail: detail || phase
          })
        } catch {
          /* ignore */
        }
      }

      // Capa imagen bajo demanda (libera ACE si hacía falta)
      if (providerPref === 'a1111' || providerPref === 'smart') {
        try {
          sendProgress('local', 2, 'Preparando capa de imagen (Forge)…')
          const { prepareHeavyLayer } = await import('./layer-scheduler')
          const prep = await prepareHeavyLayer('image', {
            reason: 'generación de imagen desde el chat'
          })
          if (!prep.ok) {
            sendProgress('local', 3, prep.message || 'Forge no listo')
          }
        } catch {
          /* continue; tryA1111 still attempts */
        }
      }

      const tryA1111 = async () => {
        sendProgress('local', 5, 'Conectando con Forge…')
        // E1: single resolver (status → scan → start → probe)
        const { resolveForgeApiForGeneration } = await import('./forge-api-resolve')
        const resolved = await resolveForgeApiForGeneration({
          preferredBaseUrl: payload.a1111BaseUrl || '',
          onProgress: (pct, detail) => sendProgress('local', pct, detail)
        })
        if (!resolved.ok || !resolved.baseUrl) {
          throw new Error(
            resolved.message ||
              'No hay API Forge (--api). Cierra la ventana de Forge abierta a mano y usa «Arrancar Forge» en la app.'
          )
        }
        let root = resolved.baseUrl.replace(/\/$/, '')
        // Progress poll while txt2img runs
        let stopPoll = false
        const poll = async () => {
          while (!stopPoll && !controller.signal.aborted) {
            try {
              const pr = await fetch(`${root}/sdapi/v1/progress?skip_current_image=true`, {
                signal: AbortSignal.timeout(3000)
              })
              if (pr.ok) {
                const data = (await pr.json()) as {
                  progress?: number
                  eta_relative?: number
                  state?: { sampling_step?: number; sampling_steps?: number }
                }
                const p = Math.max(0, Math.min(0.99, data.progress ?? 0))
                const step = data.state?.sampling_step
                const steps = data.state?.sampling_steps
                const eta = data.eta_relative
                let detail = `Forge · ${Math.round(p * 100)}%`
                if (step != null && steps) detail += ` · paso ${step}/${steps}`
                if (eta != null && eta > 0) detail += ` · ETA ${Math.ceil(eta)}s`
                sendProgress('local', 5 + p * 90, detail)
              }
            } catch {
              /* ignore poll errors */
            }
            await new Promise((r) => setTimeout(r, 800))
          }
        }
        void poll()
        try {
          let localPrompt = prompt
          let localNegative = payload.negativePrompt || ''
          let localCheckpoint = payload.checkpoint
          let ipAdapter: {
            model: string
            module: string
            weight: number
            image: string
          } | undefined
          let faceIdLoraReady = false
          if (!localCheckpoint) {
            try {
              const listed = await fetch(`${root}/sdapi/v1/sd-models`, {
                signal: AbortSignal.timeout(8000)
              })
              if (listed.ok) {
                const models = (await listed.json()) as Array<{
                  title?: string
                  model_name?: string
                  filename?: string
                }>
                const { pickBestCheckpoint } = await import('../core/generative/smart-checkpoint')
                localCheckpoint = pickBestCheckpoint(models, prompt)
              }
            } catch {
              /* Forge can still use its currently loaded checkpoint */
            }
          }
          let extraControlNet: Array<{
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
          }> = []
          try {
            const { listControlNetModels } = await import('./image-a1111')
            const models = await listControlNetModels(root, AbortSignal.timeout(5000))
            // FaceID / IP-Adapter when reference (avatar) present
            if (payload.referenceImage?.startsWith('data:image/')) {
              try {
                const { resolveIpAdapterFromModels } = await import('../core/image/identity-ref')
                const resolved = resolveIpAdapterFromModels(
                  models,
                  payload.referenceImage,
                  payload.ipAdapterWeight
                )
                if (resolved) {
                  ipAdapter = resolved.config
                  sendProgress(
                    'local',
                    16,
                    `Forge · ${resolved.selected.kind === 'faceid' ? 'FaceID' : 'IP-Adapter'} · w=${resolved.config.weight}`
                  )
                } else {
                  sendProgress(
                    'local',
                    16,
                    'Sin FaceID en Forge — descargando FaceID Plus v2…'
                  )
                  try {
                    const { installFaceIdModels, hasFaceIdOnDisk } = await import(
                      './forge-extensions'
                    )
                    const onDisk = await hasFaceIdOnDisk()
                    if (!onDisk.hasFaceId) {
                      const inst = await installFaceIdModels((msg, pct) => {
                        sendProgress(
                          'local',
                          16 + Math.min(8, Math.round((pct || 0) / 12)),
                          msg
                        )
                      })
                      if (inst.ok) {
                        sendProgress(
                          'local',
                          24,
                          `FaceID descargado (${inst.installed.join(', ')}). Reintentando ControlNet…`
                        )
                        try {
                          const models2 = await listControlNetModels(
                            root,
                            AbortSignal.timeout(8000)
                          )
                          const resolved2 = resolveIpAdapterFromModels(
                            models2,
                            payload.referenceImage!,
                            payload.ipAdapterWeight
                          )
                          if (resolved2) {
                            ipAdapter = resolved2.config
                            sendProgress(
                              'local',
                              26,
                              `Forge · FaceID listo · w=${resolved2.config.weight}`
                            )
                          } else {
                            sendProgress(
                              'local',
                              26,
                              'FaceID en disco; reinicia Forge para que ControlNet cargue el modelo.'
                            )
                          }
                        } catch {
                          sendProgress(
                            'local',
                            26,
                            'FaceID descargado; reinicia Forge para cargarlo.'
                          )
                        }
                      } else {
                        sendProgress(
                          'local',
                          18,
                          `No se pudo descargar FaceID: ${inst.error || 'error'}. Identidad solo por texto.`
                        )
                      }
                    } else {
                      sendProgress(
                        'local',
                        18,
                        'FaceID está en disco pero Forge no lo lista — reinicia Forge (Arrancar Forge) y vuelve a generar.'
                      )
                    }
                  } catch (e) {
                    sendProgress(
                      'local',
                      18,
                      `FaceID auto-install falló: ${e instanceof Error ? e.message : String(e)}`
                    )
                  }
                }
              } catch {
                /* optional */
              }
            }
            const galleryRefs = (payload.referenceImages || [])
              .filter((ref) => ref.startsWith('data:image/'))
              .filter((ref) => ref !== payload.referenceImage)
              .slice(0, 2)
            if (ipAdapter && galleryRefs.length) {
              const { resolveIpAdapterFromModels } = await import('../core/image/identity-ref')
              for (const reference of galleryRefs) {
                const resolvedRef = resolveIpAdapterFromModels(
                  models,
                  reference,
                  Math.min(0.34, ipAdapter.weight * 0.42)
                )
                if (!resolvedRef) continue
                extraControlNet.push({
                  enabled: true,
                  module: resolvedRef.config.module,
                  model: resolvedRef.config.model,
                  weight: resolvedRef.config.weight,
                  image: resolvedRef.config.image,
                  resize_mode: 'Crop and Resize',
                  guidance_start: 0,
                  guidance_end: 0.85,
                  control_mode: 'Balanced',
                  pixel_perfect: true
                })
              }
              if (extraControlNet.length > 0) {
                sendProgress(
                  'local',
                  17,
                  `Forge · ${galleryRefs.length} referencia(s) secundaria(s) de galería`
                )
              }
            }
            // Hito 3.4 — structural ControlNet from prompt (+ reference when available)
            try {
              const { planStructuralControlNet } = await import('../core/image/controlnet-auto')
              const structural = planStructuralControlNet({
                prompt,
                models,
                referenceImage: payload.referenceImage,
                forceKind: payload.controlNetKind as import('../core/image/controlnet-auto').ControlNetKind | undefined
              })
              if (structural.unit) {
                const { kind: _k, ...unit } = structural.unit
                extraControlNet.push(unit)
                sendProgress('local', 18, structural.note)
              } else if (structural.kind !== 'none') {
                sendProgress('local', 18, structural.note)
              }
            } catch {
              /* optional */
            }
          } catch {
            // ControlNet listing failed — continue without
          }
          if (ipAdapter && /faceid.*plus.*v2/i.test(ipAdapter.model)) {
            try {
              const { hasFaceIdOnDisk, installFaceIdModels } = await import('./forge-extensions')
              let stack = await hasFaceIdOnDisk()
              if (!stack.hasLora) {
                sendProgress('local', 18, 'Reparando la LoRA de FaceID en models/Lora…')
                await installFaceIdModels((msg, pct) => sendProgress('local', 18 + (pct || 0) * 0.06, msg))
                stack = await hasFaceIdOnDisk()
              }
              faceIdLoraReady = stack.hasLora
            } catch (e) {
              sendProgress(
                'local',
                18,
                `No se pudo comprobar/reparar la LoRA FaceID: ${e instanceof Error ? e.message : String(e)}`
              )
            }
          }
          if (
            payload.requireFaceId &&
            payload.referenceImage?.startsWith('data:image/') &&
            (!ipAdapter?.model ||
              (/faceid.*plus.*v2/i.test(ipAdapter.model) && !faceIdLoraReady))
          ) {
            const error = new Error(
              'No se pudo aplicar el stack completo de FaceID a la referencia. Se detuvo la generación para no sustituir la identidad. Comprueba FaceID Plus v2 y su LoRA en models/Lora, y reinicia Forge para que cargue los modelos.'
            ) as Error & { code?: string }
            error.code = 'FACEID_UNAVAILABLE'
            throw error
          }
          // Forge/SD benefits from weighted tags; cloud models benefit from prose.
          if (!/\(masterpiece|\(best quality|one face:|solo, single person/i.test(prompt)) {
            try {
              const { composeImagePrompt } = await import('../core/generative/prompt-compose')
              const composed = composeImagePrompt(prompt, 'sd15')
              localPrompt = composed.prompt
              localNegative = [localNegative, composed.negativePrompt].filter(Boolean).join(', ')
            } catch {
              /* keep */
            }
          }
          // P0: scene/outfit FIRST + never img2img-lock avatar clothing
          let faceIdMeta: {
            applied: boolean
            kind?: string
            weight?: number
            warning?: string
          } = { applied: Boolean(ipAdapter?.model) }
          if (ipAdapter?.model) {
            faceIdMeta = {
              applied: true,
              kind: /faceid/i.test(ipAdapter.model + (ipAdapter.module || ''))
                ? 'faceid'
                : 'ipadapter',
              weight: ipAdapter.weight
            }
          } else if (payload.referenceImage?.startsWith('data:image/')) {
            faceIdMeta = {
              applied: false,
              warning:
                'Avatar sin FaceID en Forge — instala ip-adapter-faceid-plusv2 (ControlNet)'
            }
            sendProgress('local', 19, faceIdMeta.warning)
          }
          if (
            ipAdapter &&
            /faceid.*plus.*v2/i.test(ipAdapter.model) &&
            !faceIdLoraReady
          ) {
            faceIdMeta.warning =
              'FaceID Plus v2 sin LoRA cargable; repara el stack y reinicia Forge.'
          }
          try {
            const { applySceneForceToPrompts, cfgForScene } = await import(
              '../core/image/scene-force'
            )
            const forced = applySceneForceToPrompts(
              localPrompt,
              localNegative,
              String((payload as { userText?: string }).userText || prompt || '')
            )
            localPrompt = forced.prompt
            localNegative = forced.negative
            if (forced.major) {
              sendProgress('local', 20, 'Escena mayor · tags ropa/fondo al frente · txt2img')
            }
          } catch {
            /* optional */
          }
          let localCfg = payload.cfgScale ?? 7
          if (
            /catsuit|vestido|full body|\(night|parque|beach|cuerpo entero/i.test(localPrompt)
          ) {
            localCfg = Math.max(localCfg, 8.5)
          }
          // FaceID Plus v2 needs its LoRA in the prompt for strong identity lock
          try {
            if (
              ipAdapter &&
              faceIdLoraReady &&
              /faceid.*plus.*v2/i.test(ipAdapter.model)
            ) {
              const { faceIdLoraPromptTag } = await import('../core/image/identity-stack-catalog')
              const tag = faceIdLoraPromptTag(0.8)
              if (!localPrompt.includes('<lora:ip-adapter-faceid')) {
                localPrompt = tag + ', ' + localPrompt
                sendProgress('local', 19, 'FaceID LoRA en prompt · batch=1 (evita bug ControlNet)')
              }
            }
          } catch {
            /* */
          }
          let r = await fetchA1111Image(
            root,
            localPrompt,
            localNegative,
            width,
            height,
            payload.steps ?? 32,
            localCfg,
            payload.seed,
            controller.signal,
            localCheckpoint,
            payload.referenceImage,
            0.7,
            ipAdapter,
            extraControlNet.length ? extraControlNet : undefined,
            true,
            // FaceID/ControlNet + batch_size>1 → KeyError in Forge postprocess_batch_list
            ipAdapter || payload.requireFaceId || payload.isSelf
              ? 1
              : Math.min(
                  4,
                  Math.max(
                    1,
                    Number(payload.batchSize) ||
                      (payload.referenceImage ||
                      /catsuit|cuerpo entero|full body|de noche/i.test(localPrompt)
                        ? 2
                        : 1)
                  )
                )
          )
          sendProgress(
            'local',
            100,
            faceIdMeta.applied
              ? `Listo · FaceID ${faceIdMeta.kind || ''} w=${faceIdMeta.weight ?? ''}`
              : faceIdMeta.warning
                ? `Listo · ${faceIdMeta.warning.slice(0, 60)}`
                : 'Listo'
          )
          if (payload.isSelf || payload.requireFaceId) {
            if (!faceIdMeta.applied && !faceIdMeta.warning) {
              faceIdMeta.warning =
                'Autorretrato: FaceID requerido — instala ip-adapter-faceid-plusv2 o reinicia Forge'
            }
          }
          const faceNote = faceIdMeta.applied
            ? ` · FaceID:${faceIdMeta.kind}@${faceIdMeta.weight}`
            : faceIdMeta.warning
              ? ' · sin-FaceID'
              : ''
          // B3: rank batch by face similarity when possible
          let batchRankNote = ''
          try {
            const extras = (r as { extraBuffers?: Buffer[] }).extraBuffers
            const allBufs = extras && extras.length ? [r.buf, ...extras] : [r.buf]
            if (allBufs.length > 1 && payload.referenceImage?.startsWith('data:image/')) {
              const { rankBuffersByFaceRef } = await import('./batch-face-rank')
              const ranked = await rankBuffersByFaceRef(payload.referenceImage, allBufs)
              if (ranked.ranked && ranked.bestIndex > 0 && ranked.bestIndex < allBufs.length) {
                r = { ...r, buf: allBufs[ranked.bestIndex] }
              }
              if (ranked.ranked) {
                const { formatBatchRankNote } = await import('../core/image/batch-rank')
                batchRankNote = formatBatchRankNote(ranked.bestIndex, ranked.scores, allBufs.length)
                sendProgress('local', 85, batchRankNote)
              }
            }
          } catch {
            /* optional */
          }

          const batchN = (r as { batchSize?: number }).batchSize || 1
          const batchNote = batchRankNote
            ? ` · ${batchRankNote}`
            : batchN > 1
              ? ` · batch×${batchN}`
              : ''
          // Persist final prompts for advanced UI / debug
          const result = await saveBuf(
            r.buf,
            r.contentType,
            'a1111',
            `${r.model || localCheckpoint || 'stable-diffusion'}${faceNote} · ${(r as { mode?: string }).mode || 'txt2img'}${batchNote}`
          )
          let faceMatchScore: number | null = null
          let faceMatchNote = ''
          try {
            if (
              (payload.isSelf || payload.requireFaceId) &&
              payload.referenceImage?.startsWith('data:image/') &&
              r?.buf
            ) {
              const { rankBuffersByFaceRef } = await import('./batch-face-rank')
              const ranked = await rankBuffersByFaceRef(payload.referenceImage, [r.buf])
              if (ranked.ranked && ranked.scores[0] != null) {
                faceMatchScore = ranked.scores[0]
                if (faceMatchScore < 0.45) {
                  faceMatchNote =
                    'Similitud facial baja (' +
                    faceMatchScore.toFixed(2) +
                    '). Prueba otra seed, revisa avatar frontal o «instala FaceID».'
                } else if (faceMatchScore < 0.55) {
                  faceMatchNote =
                    'Similitud media (' + faceMatchScore.toFixed(2) + '). Puede no ser un match fuerte.'
                } else {
                  faceMatchNote = 'Similitud facial ' + faceMatchScore.toFixed(2)
                }
              } else {
                faceMatchNote =
                  'No se pudo puntuar similitud (InsightFace opcional). FaceID de Forge igual puede estar activo.'
              }
            }
          } catch {
            /* optional */
          }
          if (result && typeof result === 'object' && 'ok' in result && result.ok) {
            return {
              ...result,
              finalPrompt: localPrompt.slice(0, 2000),
              finalNegative: localNegative.slice(0, 1200),
              faceIdApplied: faceIdMeta.applied,
              faceIdKind: faceIdMeta.kind,
              faceIdWeight: faceIdMeta.weight,
              faceIdWarning: faceIdMeta.warning || faceMatchNote || undefined,
              faceMatchScore,
              batchSize: batchN,
              imageMode: (r as { mode?: string }).mode || 'txt2img'
            }
          }
          return result
        } finally {
          stopPoll = true
        }
      }
      const tryPollinations = async () => {
        sendProgress('cloud', 10, 'Pollinations Flux…')
        const r = await fetchPollinationsImage(
          prompt,
          width,
          height,
          payload.seed,
          controller.signal
        )
        sendProgress('cloud', 100, 'Listo')
        return saveBuf(r.buf, r.contentType, 'pollinations', 'pollinations-flux')
      }

      const tryCloudflare = async () => {
        sendProgress('cloudflare', 8, 'Cloudflare FLUX.1 Schnell…')
        const { fetchCloudflareFlux } = await import('./cloudflare-image')
        let token = ''
        let accStored = ''
        try {
          token = String(secureStore.get('providerKey:cloudflare', '') || '')
          accStored = String(secureStore.get('providerKey:cloudflareAccountId', '') || '')
        } catch {
          token = ''
        }
        const acc = (
          (payload as { cloudflareAccountId?: string }).cloudflareAccountId ||
          accStored ||
          ''
        ).trim()
        if (!acc || !token) {
          const err = new Error(
            `Cloudflare no configurado (Account ID ${acc ? 'OK' : 'faltante'}, Token ${token ? 'OK' : 'faltante'}). Ajustes → Guardar y probar.`
          )
          ;(err as Error & { code?: string }).code = 'IMAGE_CF_NO_CREDS'
          throw err
        }
        const r = await fetchCloudflareFlux({
          accountId: acc,
          apiToken: token,
          prompt,
          steps: 6,
          seed: payload.seed,
          width: payload.width,
          height: payload.height,
          signal: controller.signal
        })
        sendProgress('cloudflare', 100, 'Listo')
        return saveBuf(r.buf, r.contentType, 'cloudflare', r.model)
      }

      if (providerPref === 'a1111') {
        return await tryA1111()
      }
      if (providerPref === 'cloudflare') {
        try {
          return await tryCloudflare()
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          sendProgress('cloud', 5, `CF falló · Pollinations…`)
          const pol = await tryPollinations()
          if (pol && pol.ok) {
            return {
              ...pol,
              model: `${pol.model || 'pollinations'} (CF: ${msg.slice(0, 80)})`
            }
          }
          return pol
        }
      }
      const tryOpenAI = async () => {
        sendProgress('openai', 8, 'OpenAI Images…')
        const key =
          (secureStore.get('providerKey:openai', '') as string) ||
          (secureStore.get('cloudApiKey', '') as string) ||
          ''
        if (!key || key.trim().length < 8) {
          throw new Error('Sin API key de OpenAI')
        }
        const { generateOpenAIImage } = await import('../core/image/openai-images')
        const r = await generateOpenAIImage({
          apiKey: key.trim(),
          prompt,
          width,
          height,
          model: 'gpt-image-1.5',
          quality: 'high',
          signal: controller.signal
        })
        return saveBuf(r.buf, r.contentType, 'openai', r.model)
      }

      if (providerPref === 'openai') {
        return await tryOpenAI()
      }
      if (providerPref === 'smart') {
        // Local Forge first: the user's installed checkpoint is the primary asset.
        // Cloud providers are fallbacks only when local generation is unavailable.

        const errors: string[] = []
        try {
          return await tryA1111()
        } catch (e) {
          errors.push(`Local: ${e instanceof Error ? e.message : String(e)}`)
        }
        if (payload.requireFaceId && payload.referenceImage?.startsWith('data:image/')) {
          return {
            ok: false as const,
            code: 'FACEID_UNAVAILABLE',
            error:
              errors[0] ||
              'Forge no pudo aplicar FaceID a la referencia; se omitieron los proveedores de texto para proteger la identidad.',
            jobId
          }
        }
        try {
          return await tryOpenAI()
        } catch (e) {
          errors.push(`OpenAI: ${e instanceof Error ? e.message : String(e)}`)
        }
        try {
          return await tryCloudflare()
        } catch (e) {
          errors.push(`Cloudflare: ${e instanceof Error ? e.message : String(e)}`)
        }
        try {
          sendProgress('cloud', 5, 'Último recurso · Pollinations Flux…')
          const pol = await tryPollinations()
          if (pol && pol.ok) {
            return {
              ...pol,
              model: `${pol.model || 'pollinations'} (fallback; ${errors.join(' | ')})`.slice(0, 200)
            }
          }
          return pol
        } catch (e) {
          errors.push(`Pollinations: ${e instanceof Error ? e.message : String(e)}`)
          return {
            ok: false as const,
            code: 'IMAGE_ALL_FAILED',
            error: errors.join(' · '),
            jobId
          }
        }
      }
      if (providerPref === 'pollinations') {
        return await tryPollinations()
      }
      // cloud default
      try {
        return await tryOpenAI()
      } catch {
        try {
          return await tryCloudflare()
        } catch {
          return await tryPollinations()
        }
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const code =
        (err as Error & { code?: string }).code ||
        (controller.signal.aborted ? 'IMAGE_CANCELLED' : 'IMAGE_NETWORK')
      const cancelled =
        controller.signal.aborted ||
        msg.toLowerCase().includes('abort') ||
        msg.toLowerCase().includes('cancel')
      return {
        ok: false as const,
        code: cancelled ? 'IMAGE_CANCELLED' : code,
        error: cancelled ? 'Generación cancelada' : msg,
        jobId
      }
    } finally {
      clearTimeout(timer)
      imageAbortControllers.delete(jobId)
    }
  }
)

ipcMain.handle('image:getFolder', async () => {
  try {
    const dir = await ensureImagesDir()
    return { ok: true, path: dir }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('image:openFolder', async () => {
  try {
    const dir = await ensureImagesDir()
    await shell.openPath(dir)
    return { ok: true, path: dir }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('image:showInFolder', async (_e, filePath?: string) => {
  try {
    if (filePath && existsSync(filePath)) {
      shell.showItemInFolder(filePath)
      return { ok: true }
    }
    const dir = await ensureImagesDir()
    await shell.openPath(dir)
    return { ok: true, path: dir }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('image:cancel', (_e, jobId?: string) => {
  if (jobId && imageAbortControllers.has(jobId)) {
    imageAbortControllers.get(jobId)?.abort()
    imageAbortControllers.delete(jobId)
    return { ok: true }
  }
  for (const [, c] of imageAbortControllers) c.abort()
  imageAbortControllers.clear()
  return { ok: true }
})

ipcMain.handle('image:cleanup', async (_e, maxAgeDays = 30) => {
  try {
    const { readdir, stat, unlink } = await import('fs/promises')
    const dir = join(app.getPath('userData'), 'images')
    if (!existsSync(dir)) return { ok: true, removed: 0 }
    const cutoff = Date.now() - maxAgeDays * 86400_000
    let removed = 0
    for (const name of await readdir(dir)) {
      const fp = join(dir, name)
      try {
        const st = await stat(fp)
        if (st.isFile() && st.mtimeMs < cutoff) {
          await unlink(fp)
          removed++
        }
      } catch {
        /* skip */
      }
    }
    return { ok: true, removed }
  } catch (err) {
    return {
      ok: false,
      removed: 0,
      error: err instanceof Error ? err.message : String(err)
    }
  }
})

ipcMain.handle('image:ensureLocalPipeline', async (_e, preferredPort?: number) => {
  try {
    const { ensureLocalImagePipeline } = await import('./forge-runtime')
    return await ensureLocalImagePipeline({ preferredPort })
  } catch (err) {
    return {
      ok: false,
      baseUrl: null,
      port: null,
      modelsCount: 0,
      synced: { copied: [], skipped: [] },
      message: err instanceof Error ? err.message : String(err)
    }
  }
})
