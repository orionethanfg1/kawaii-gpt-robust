/**
 * image:generate IPC handler (extracted from image-ipc).
 */
import { ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { fetchA1111Image } from './image-a1111'
import { minimum2kImageSize, MIN_IMAGE_LONG_EDGE } from '../core/image/image-size'
import { fetchPollinationsImage } from './image-pollinations'

export type ImageAbortMap = Map<string, AbortController>

export function registerImageGenerateIpc(opts: {
  ensureImagesDir: () => Promise<string>
  imageAbortControllers: ImageAbortMap
  secureStoreGet: (k: string, d?: string) => string
}): void {
  const { ensureImagesDir, imageAbortControllers, secureStoreGet } = opts

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
    const requestedBatch = Math.min(4, Math.max(1, Number(payload.batchSize) || 1))
    const selfMulti =
      Boolean(payload.isSelf || payload.requireFaceId) &&
      Boolean(payload.referenceImage) &&
      requestedBatch > 1
    // I2: several sequential FaceID gens; allow up to 8 min (renderer may send 420s)
    const baseTimeout = Math.min(480_000, Math.max(15_000, payload.timeoutMs ?? 180_000))
    const timeoutMs = selfMulti
      ? Math.min(480_000, Math.max(baseTimeout, 120_000 * Math.min(3, requestedBatch)))
      : Math.min(300_000, baseTimeout)
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
              const tag = faceIdLoraPromptTag(0.65)
              if (!localPrompt.includes('<lora:ip-adapter-faceid')) {
                localPrompt = tag + ', ' + localPrompt
                sendProgress('local', 19, 'FaceID LoRA en prompt · batch=1 (evita bug ControlNet)')
              }
            }
          } catch {
            /* */
          }
          // I2: FaceID path always batch_size=1 (ControlNet KeyError). For self,
          // run sequential multi-seed candidates, then rank by face score.
          const wantSelfMulti =
            Boolean(payload.isSelf || payload.requireFaceId) &&
            Boolean(payload.referenceImage?.startsWith('data:image/'))
          // Default 2 candidates (3 is slow and often hits timeout on 1536² FaceID)
          const sequentialN = wantSelfMulti
            ? Math.min(3, Math.max(2, Number(payload.batchSize) || 2))
            : 1
          const baseSeed =
            typeof payload.seed === 'number' && payload.seed >= 0
              ? payload.seed
              : Math.floor(Math.random() * 2_000_000_000)
          const candidateBufs: Buffer[] = []
          let r: Awaited<ReturnType<typeof fetchA1111Image>> | null = null
          for (let ci = 0; ci < sequentialN; ci++) {
            const seed_i = sequentialN > 1 ? baseSeed + ci * 9973 : payload.seed
            if (sequentialN > 1) {
              sendProgress(
                'local',
                20 + Math.floor((ci / sequentialN) * 55),
                `I2 candidato ${ci + 1}/${sequentialN} (seed ${seed_i})…`
              )
            }
            const forgeBatch =
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
            const one = await fetchA1111Image(
              root,
              localPrompt,
              localNegative,
              width,
              height,
              payload.steps ?? 32,
              localCfg,
              sequentialN > 1 ? seed_i : payload.seed,
              controller.signal,
              localCheckpoint,
              payload.referenceImage,
              0.7,
              ipAdapter,
              extraControlNet.length ? extraControlNet : undefined,
              true,
              // FaceID/ControlNet + batch_size>1 → KeyError; sequential I2 uses 1
              sequentialN > 1 ? 1 : forgeBatch
            )
            candidateBufs.push(one.buf)
            r = one
          }
          if (!r) throw new Error('I2: sin resultado de Forge')
          if (candidateBufs.length > 1) {
            ;(r as { extraBuffers?: Buffer[] }).extraBuffers = candidateBufs.slice(1)
            ;(r as { batchSize?: number }).batchSize = candidateBufs.length
          }
          sendProgress(
            'local',
            100,
            faceIdMeta.applied
              ? `Listo · FaceID ${faceIdMeta.kind || ''} w=${faceIdMeta.weight ?? ''}` +
                (sequentialN > 1 ? ` · I2×${sequentialN}` : '')
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
                  (ranked as { diag?: string }).diag ||
                  (batchN > 1
                    ? 'I2: ' + batchN + ' candidatos; sin score. Ejecuta: py -3 tools/face_similarity.py --ref avatar.png --image out.png --json'
                    : 'Sin score facial. Comprueba InsightFace en el Python del sistema (py -3).')
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
          token = String(secureStoreGet('providerKey:cloudflare', '') || '')
          accStored = String(secureStoreGet('providerKey:cloudflareAccountId', '') || '')
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
          (secureStoreGet('providerKey:openai', '') as string) ||
          (secureStoreGet('cloudApiKey', '') as string) ||
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
        error: cancelled
          ? (selfMulti
              ? 'Tiempo agotado o cancelado durante I2 (varios candidatos FaceID). Reintenta o baja resolución en Ajustes.'
              : 'Generación cancelada')
          : msg,
        jobId
      }
    } finally {
      clearTimeout(timer)
      imageAbortControllers.delete(jobId)
    }
  }
)



}
