/**
 * M1 — Image generation flow extracted from useChat (keep useChat thin).
 */
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { buildChatImageRequest } from './chatImageBuild'
import { ensureForgeReady } from './ensureForgeReady'
import { pickBestCheckpoint } from '@core/generative/smart-checkpoint'
import { resolveFaceIdStatus } from '@core/image/faceid-result'
import { recommendSdParams, parseImageIntent } from '@core/generative/prompt-compose'
import { refineSceneSpecWithLlm } from '@core/image/scene-spec'

export type ChatImageFlowReq = {
  modality: string
  prompt?: string
  width?: number
  height?: number
  negativePrompt?: string
  seed?: number
}

export type ChatImageFlowDeps = {
  trimmed: string
  req: ChatImageFlowReq
  hasAtt?: boolean
  attachments?: unknown
  activeId: string | null
  create: () => string
  addMessage: (convId: string, msg: Record<string, unknown>) => string
  updateMessage: (convId: string, msgId: string, patch: Record<string, unknown>) => void
  armLoading: (watchdogMs?: number) => void
  clearLoading: () => void
  setError: (e: string | null) => void
  /** Optional live status bar (progress during image gen) */
  setLiveStatus?: (v: {
    phase: string
    route: null
    label: string
    tried: string[]
  } | null) => void
  getTried?: () => string[]
}

export async function runChatImageFlow(deps: ChatImageFlowDeps): Promise<void> {
let convId = deps.activeId
if (!convId) convId = deps.create()
deps.addMessage(convId, { role: 'user', content: deps.trimmed || '📷', attachments: deps.hasAtt ? deps.attachments : undefined })
const assistantId = deps.addMessage(convId, {
  role: 'assistant',
  content: 'Creando imagen…',
  isStreaming: true
})
deps.armLoading(600_000)  /* I2 FaceID multi-seed */
deps.setError(null)
try {
  // Last image in this conversation → revision memory
  const conv = useChatStore
    .getState()
    .conversations.find((c) => c.id === convId)
  const liveSz = useSettingsStore.getState().settings
  const charLive = liveSz.character
  let sceneOverride: import('@core/image/scene-spec').SceneSpec | undefined
  // Director LLM opcional (máx 3.5s) si el prompt es rico en escena
  if (
    (deps.trimmed.length > 40 &&
      /\b(escena|fondo|luz|calle|noche|playa|catsuit|vestido|cuerpo)\b/i.test(deps.trimmed)) ||
    /\b(drag[oó]n|dragon|f[eé]nix|phoenix|unicornio|unicorn|lobo|wolf|gato|cat|perro|dog|caballo|horse)\b/i.test(
      deps.trimmed
    )
  ) {
    try {
      const baseUrl = (liveSz.localBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
      const model = (liveSz.localModel || '').trim()
      if (model) {
        const refined = await refineSceneSpecWithLlm(
          deps.trimmed,
          async (prompt) => {
            const res = await fetch(`${baseUrl}/api/generate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model,
                prompt,
                stream: false,
                options: { num_predict: 400, temperature: 0.2 }
              })
            })
            if (!res.ok) throw new Error('director-http')
            const data = (await res.json()) as { response?: string }
            return String(data.response || '')
          },
          3500
        )
        if (refined.source === 'llm') sceneOverride = refined.spec
      }
    } catch {
      /* heuristic only */
    }
  }
  const weakVisualDesc = !(charLive?.visualDescription || '').trim() ||
    /kawaii suave|pastel|floral/i.test(charLive?.visualDescription || '')
  const built = buildChatImageRequest({
    userText: deps.trimmed,
    requestPrompt: String(deps.req.prompt || '').trim(),
    width: deps.req.width || liveSz.imageWidth || 1024,
    height: deps.req.height || liveSz.imageHeight || 1024,
    negativePrompt: deps.req.negativePrompt,
    messages: conv?.messages,
    character: charLive,
    useCharacterStyle: liveSz.imageUseCharacterStyle !== false,
    sceneSpecOverride: sceneOverride
  })
  let finalPrompt = built.finalPrompt
  let width = built.width
  let height = built.height
  let negative = built.negative
  const revisionSeed = built.seed
  const revisionNote = built.revisionNote || ''
  const liveMode = useSettingsStore.getState().settings
  // Local-first generative quality: Forge/SD is the primary path (no Pollinations by default)
  let providerPref: 'a1111' | 'cloudflare' | 'smart' | 'pollinations' = 'a1111'
  if (liveMode.imageProviderMode === 'cloud') {
    providerPref = (liveMode.cloudflareAccountId || '').trim()
      ? 'cloudflare'
      : 'a1111'
  } else {
    // local | smart | off-handled earlier → always try local Forge
    providerPref = 'a1111'
  }
  // Only Forge receives the avatar as a real FaceID/IP-Adapter conditioning image.
  // Cloud image APIs here are text-only and would silently replace the character.
  if (built.isSelf && built.referenceImage) {
    providerPref = 'a1111'
  }
  const unsubImg = window.kawaii?.onImageGenerateProgress?.((p) => {
    deps.setLiveStatus?.({
      phase: 'generating',
      route: null,
      label: p.detail || `Imagen ${Math.round(p.pct)}%`,
      tried: [...(deps.getTried?.() || [])]
    })
  })
  
  // Offline: never hit cloud image providers
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      providerPref = 'a1111'
    }
  } catch {
    /* ignore */
  }
// Prompt already composed + identity-locked via buildChatImageRequest
  if (built.isSelf) {
    negative = [negative, 'two heads, two faces, double head, stacked heads, conjoined']
      .filter(Boolean)
      .join(', ')
  }
  // Ensure local Forge is healthy before generate (boot wait)
  // P0.2: ensure Forge API before local image
  let forgeBaseForGen =
    (liveMode.a1111BaseUrl || '').trim() ||
    'http://127.0.0.1:7860'
  if (providerPref === 'a1111' || providerPref === 'smart') {
    try {
      const prefPort = (() => {
        try {
          const u = new URL(forgeBaseForGen)
          const n = Number(u.port)
          return n > 0 ? n : 7860
        } catch {
          return 7860
        }
      })()
      const ensured = await ensureForgeReady({
        preferredBaseUrl: forgeBaseForGen,
        preferredPort: prefPort,
        extraWaitMs: 240_000,
        onProgress: (msg) => {
          deps.updateMessage(convId, assistantId, {
            content: msg,
            isStreaming: true,
            meta: {
              model: 'app',
              provider: 'app',
              route: 'local',
              reason: 'Auto-arranque Forge'
            }
          })
        }
      })
      if (ensured.baseUrl) forgeBaseForGen = ensured.baseUrl
      if (!ensured.ok) {
        deps.updateMessage(convId, assistantId, {
          content: ensured.message,
          isStreaming: false,
          meta: { isError: true, errorCode: 'FORGE_TIMEOUT' }
        })
        return
      }
      deps.updateMessage(convId, assistantId, {
        content:
          ensured.ok
            ? 'Forge listo. Generando imagen…'
            : (ensured.message || 'Preparando Forge…'),
        isStreaming: true
      })
    } catch (forgeBootErr) {
      const em =
        forgeBootErr instanceof Error
          ? forgeBootErr.message
          : String(forgeBootErr)
      deps.updateMessage(convId, assistantId, {
        content:
          'Auto-arranque Forge falló (' +
          em.slice(0, 140) +
          '). Ajustes → Capas → Arrancar Forge API.',
        isStreaming: false,
        meta: { isError: true, errorCode: 'FORGE_AUTOSTART' }
      })
      return
    }
  }

  let autoSteps = liveMode.a1111Steps || 0
  let autoCfg = liveMode.a1111CfgScale || 0
  try {
    const intent = parseImageIntent(deps.trimmed)
    const rec = recommendSdParams({
      prompt: finalPrompt,
      framing: intent.framing,
      style: intent.style
    })
    if (!autoSteps) autoSteps = rec.steps
    if (!autoCfg) autoCfg = rec.cfgScale
    // Identity lock: slightly higher CFG helps SD hold hair/eyes (best practice 7–8)
    if (
      !liveMode.a1111CfgScale &&
      !liveMode.a1111CfgScale &&
      parseImageIntent(deps.trimmed).isSelf &&
      !parseImageIntent(deps.trimmed).explicitOther
    ) {
      autoCfg = Math.min(8.5, (autoCfg || 7) + 0.75)
    }
    const smartUi = (liveMode.uiComplexity || 'smart') !== 'advanced'
    // Smart mode: always use SD-native friendly sizes unless user asked 2x/4k in text
    if (smartUi && !/\b(el doble|2x|4k|m[aá]s grande)\b/i.test(deps.trimmed)) {
      width = rec.width
      height = rec.height
    } else if (width < 640) {
      width = rec.width
      height = rec.height
    }
    // Always honor full-body framing size
    if (intent.framing === 'full') {
      width = rec.width
      height = rec.height
    }
  } catch {
    if (!autoSteps) autoSteps = 28
    if (!autoCfg) autoCfg = 7
  }

  let checkpoint =
    (built.isSelf &&
      (useSettingsStore.getState().settings as { preferredIdentityCheckpoint?: string })
        .preferredIdentityCheckpoint) ||
    liveMode.a1111Checkpoint || undefined
  if (!checkpoint) {
    try {
      const list = await window.kawaii?.imageA1111Models?.(
        liveMode.a1111BaseUrl
      )
      const models = (list as { models?: Array<{ title?: string; model_name?: string }> })
        ?.models || (Array.isArray(list) ? list : [])
      checkpoint = pickBestCheckpoint(
        models as Array<{ title?: string; model_name?: string }>,
        finalPrompt
      )
    } catch {
      /* ignore */
    }
    if (!checkpoint) {
      try {
        const disk = await window.kawaii?.sdListWeights?.()
        const weights = (disk as { weights?: Array<{ filename: string; kind?: string }> })?.weights
          || (disk as { checkpoints?: Array<{ filename: string }> })?.checkpoints
          || []
        const { pickBestFromDiskWeights } = await import('@core/generative/smart-checkpoint')
        checkpoint = pickBestFromDiskWeights(weights as Array<{ filename: string; kind?: string }>, finalPrompt)
      } catch {
        /* ignore */
      }
    }
  }
  // P1: no inyectar nombres de galería en el prompt (contaminan identidad)

  // Auto-start Forge when local/smart needs A1111
  const fileTitle = (() => {
    const it = parseImageIntent(deps.trimmed)
    if (it.isSelf) {
      const n = useSettingsStore.getState().settings.character?.name || 'Personaje'
      return n
    }
    return (
      deps.trimmed
        .replace(/\b(genera|haz|crea|una|foto|imagen|por favor|no seas t[uú]|es otra persona)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 48) || 'imagen'
    )
  })()
  // P1 — preflight FaceID for self-portraits
  if (built.isSelf) {
    try {
      const baseCn =
        forgeBaseForGen || liveMode.a1111BaseUrl
      const probe = await window.kawaii?.imageControlNetModels?.(baseCn)
      const names = (probe as { models?: string[] })?.models || []
      const { assessFaceIdFromModelNames } = await import('@core/image/faceid-status')
      if (!assessFaceIdFromModelNames(names).available) {
        deps.updateMessage(convId, assistantId, {
          content: 'Preparando FaceID (identidad)…',
          isStreaming: true
        })
        try {
          const { executeAppTool } = await import('./hostTools')
          await executeAppTool({ tool: 'ensure_faceid', args: {} })
        } catch {
          /* best-effort */
        }
      }
    } catch {
      /* non-blocking */
    }
  }

  const runGen = async (weightOverride?: number) =>
    window.kawaii?.imageGenerate?.({

    userText: deps.trimmed,
    prompt: finalPrompt,
    negativePrompt: negative,
    width,
    height,
    seed: revisionSeed ?? deps.req.seed,
    provider: providerPref,
    title: fileTitle,
    referenceImage: built.referenceImage,
    referenceImages: built.referenceImages,
    isSelf: built.isSelf,
    requireFaceId: built.isSelf || built.requireFaceId,
    referenceDenoisingStrength: built.referenceDenoisingStrength,
    // I2: autorretrato → N candidatos secuenciales (Forge batch_size=1 cada uno)
    batchSize: built.isSelf
      ? Math.min(3, Math.max(2, (built as { suggestedBatch?: number }).suggestedBatch || 2))
      : (built as { suggestedBatch?: number }).suggestedBatch ||
        (/catsuit|cuerpo entero|full body|de noche|parque/i.test(deps.trimmed) ? 3 : 1),

    a1111BaseUrl: forgeBaseForGen || liveMode.a1111BaseUrl,
    steps: autoSteps || 28,
    cfgScale: autoCfg || 7,
    checkpoint,
    cloudflareAccountId:
      (liveMode.cloudflareAccountId || '').trim() ||
      undefined,
    // FaceID + 2–3 seeds needs more than 3 min on 1536×2048
    timeoutMs: built.isSelf ? 420_000 : 180_000,
    ipAdapterWeight: weightOverride != null ? weightOverride : built.ipAdapterWeight
  })

  let result = await runGen()
  // I2b — retry if score low or missing; keep the higher-scoring result
  try {
    if (built.isSelf && result && 'ok' in result && result.ok) {
      const score1 = (result as { faceMatchScore?: number | null }).faceMatchScore
      const needRetry =
        (typeof score1 === 'number' && score1 < 0.5) ||
        (score1 == null && Boolean(built.referenceImage))
      if (needRetry) {
        const why =
          typeof score1 === 'number'
            ? 'Identidad débil (score ' + score1.toFixed(2) + '). Reintentando con más ancla facial…'
            : 'Sin score facial fiable. Reintentando otra pasada I2…'
        deps.updateMessage(convId, assistantId, { content: why, isStreaming: true })
        const boosted = Math.min(
          0.88,
          (built.ipAdapterWeight || 0.85) + (typeof score1 === 'number' ? 0.05 : 0.03)
        )
        const retry = await runGen(boosted)
        if (retry && 'ok' in retry && retry.ok && retry.dataUrl) {
          const score2 = (retry as { faceMatchScore?: number | null }).faceMatchScore
          const s1 = typeof score1 === 'number' ? score1 : -1
          const s2 = typeof score2 === 'number' ? score2 : -1
          if (s2 > s1 || (s1 < 0 && retry.dataUrl)) {
            result = retry
          }
        }
      }
    }
  } catch {
    /* keep first result */
  }
  unsubImg?.()
  if (result && 'ok' in result && result.ok && result.dataUrl) {
    try {
      if (built.isSelf && checkpoint) {
        useSettingsStore.getState().update({
          preferredIdentityCheckpoint: String(checkpoint)
        } as never)
      }
    } catch {
      /* */
    }
    const dataUrl = result.dataUrl
    const imageTitle = (() => {
      const it = parseImageIntent(deps.trimmed)
      if (it.isSelf) {
        const n = useSettingsStore.getState().settings.character?.name || 'Personaje'
        return n  // sin «· half» en UI
      }
      const short = deps.trimmed
        .replace(/\b(genera|haz|crea|una|foto|imagen|por favor|no seas t[uú]|es otra persona)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 56)
      return short || 'Imagen generada'
    })()
    const att = dataUrl
      ? [
          {
            id: `img_${Date.now()}`,
            name: `${imageTitle.slice(0, 40).replace(/[^\w\s\-·]/g, '').trim() || 'imagen'}.png`,
            mimeType: 'image/png',
            sizeBytes: Math.round((dataUrl.length * 3) / 4),
            dataUrl,
            filePath: result.filePath
          }
        ]
      : undefined
    deps.updateMessage(convId, assistantId, {
      content:
        `Aquí tienes la imagen.` +
        (result.model && String(result.model).includes('fallback')
          ? `\n\n_Nota: ${String(result.model).slice(0, 160)}_`
          : '') +
        (() => {
          const fid = resolveFaceIdStatus({
            faceIdApplied: (result as { faceIdApplied?: boolean }).faceIdApplied,
            model: String(result.model || ''),
            faceIdWarning: (result as { faceIdWarning?: string }).faceIdWarning
          })
          if (built.isSelf && fid === 'missing') {
            const hasRef = Boolean(built.referenceImage)
            return (
              '\n\n_⚠️ Autorretrato sin FaceID en Forge' +
              (hasRef
                ? ' (sí hay foto de referencia en la ficha, pero Forge no aplicó FaceID). '
                : ' (no hay avatar/ref usable en la ficha). ') +
              'Instala ip-adapter-faceid-plusv2 o di «revisa Forge» / «instala FaceID»._'
            )
          }
          if (built.isSelf && fid === 'applied') {
            const n = (built as { referenceCount?: number }).referenceCount || 1
            const srcs = (built as { refSources?: string[] }).refSources || []
            const srcLine = srcs.length
              ? ' Fuentes: ' + srcs.join('; ') + '.'
              : ''
            const score = (result as { faceMatchScore?: number | null }).faceMatchScore
            const scoreLine =
              typeof score === 'number'
                ? ' Similitud≈' + score.toFixed(2) + (score < 0.5 ? ' (baja)' : '') + '.'
                : ''
            const warnExtra = (result as { faceIdWarning?: string }).faceIdWarning
            const warnLine =
              warnExtra && /similitud|InsightFace|match/i.test(warnExtra)
                ? ' ' + warnExtra
                : ''
            return (
              '\n\n_Identidad FaceID aplicada · ' +
              n +
              ' ref(s).' +
              srcLine +
              scoreLine +
              warnLine +
              (typeof score === 'number' && score < 0.45
                ? ' Si el rostro no coincide: regenera o di «instala FaceID».'
                : '') +
              (weakVisualDesc
                ? ' _Aviso: la ficha no tiene descripción física fuerte; el ancla es solo la foto del avatar principal. Si no es ella, cambia el avatar en Ajustes → Personalidad._'
                : '') +
              '_'
            )
          }
          if (built.isSelf && !built.referenceImage) {
            return (
              '\n\n_⚠️ Sin imagen de referencia: sube un retrato en Ajustes → Personalidad para anclar la cara._'
            )
          }
          return ''
        })() +
        `\n\n_Puedes decirme qué cambiar (color, fondo, tamaño «el doble»…) y la ajusto._`,
      isStreaming: false,
      attachments: att,
      meta: {
        model: result.model || result.providerId || 'image',
        provider: result.providerId || 'image',
        route: 'image',
        reason: finalPrompt.slice(0, 160),
        imageProvider: result.providerId,
        imageModel: result.model,
        imageWidth: result.width || width,
        imageHeight: result.height || height,
        imageSeed: result.seed,
        imageFilePath: result.filePath,
        imagePrompt: finalPrompt,
        imageNegative: negative,
        imageWasSelf: built.isSelf,
        imageTitle,
        imageFinalPrompt:
          (result as { finalPrompt?: string }).finalPrompt ||
          String(finalPrompt || '').slice(0, 2000),
        imageFinalNegative:
          (result as { finalNegative?: string }).finalNegative ||
          String(negative || '').slice(0, 1200),
        imageFaceId: resolveFaceIdStatus({
          faceIdApplied: (result as { faceIdApplied?: boolean }).faceIdApplied,
          model: String(result.model || ''),
          faceIdWarning: (result as { faceIdWarning?: string }).faceIdWarning
        }),
        imageFaceIdWeight: (result as { faceIdWeight?: number }).faceIdWeight,
        imageFaceIdWarning: (result as { faceIdWarning?: string }).faceIdWarning,
        imageRefCount: (built as { referenceCount?: number }).referenceCount,
        imageHasReference: Boolean(built.referenceImage),
        imageRefSources: (built as { refSources?: string[] }).refSources,
        imageFaceMatchScore: (result as { faceMatchScore?: number | null }).faceMatchScore,
        imageMode:
          (result as { imageMode?: string }).imageMode ||
          (String(result.model || '').includes('txt2img') ? 'txt2img' : undefined),
        imageBatchSize: (result as { batchSize?: number }).batchSize || 1
      }
    })
  } else {
    const generationError =
      result && 'error' in result && typeof result.error === 'string'
        ? result.error
        : ''
    deps.updateMessage(convId, assistantId, {
      content:
        (generationError
          ? `No pude generar la imagen: ${generationError}`
          : 'No pude generar la imagen ahora. Estoy dejando los motores listos en segundo plano; ' +
            'prueba de nuevo en unos segundos o abre Ajustes → Reparar capa de imágenes.'),
      isStreaming: false,
      meta: {
        isError: true,
        errorCode:
          result && 'code' in result && typeof result.code === 'string'
            ? result.code
            : 'IMAGE_GEN_FAILED'
      }
    })
    deps.setError(generationError || 'Generación de imagen no disponible todavía.')
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  deps.updateMessage(convId, assistantId, {
    content:
      'Error al generar imagen: ' +
      msg +
      (/KeyError|ControlNet|postprocess_batch|current_params/i.test(msg)
        ? '\n\n_Forge/ControlNet falló (a menudo batch+FaceID). La app ya fuerza batch=1 en autorretrato. Di «instala FaceID» o reinicia Forge y reintenta._'
        : /faceid|FaceID/i.test(msg)
          ? '\n\n_Revisa el stack de identidad: di «instala FaceID» (descarga HF + LoRA)._'
          : ''),
    isStreaming: false,
    meta: { isError: true }
  })
  deps.setError(msg)
} finally {
  deps.clearLoading()
  try { deps.setLiveStatus?.(null) } catch { /* */ }
}

}
