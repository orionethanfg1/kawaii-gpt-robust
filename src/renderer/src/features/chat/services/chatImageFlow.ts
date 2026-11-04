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
import {
  craftImagePromptWithLlm,
  type CraftedImagePrompt
} from '@core/image/craft-image-prompt'
import { craftImageReactionWithLlm } from '@core/image/image-reaction'
import { buildIdentityProfile, stripOutfitFromAppearance } from '@core/image/identity-profile'
import { OpenAICompatibleProvider, OllamaProvider } from '@core/providers'

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
  // Host baseline first (identity, FaceID refs, size, revision memory)
  const built = buildChatImageRequest({
    userText: deps.trimmed,
    requestPrompt: String(deps.req.prompt || '').trim(),
    width: deps.req.width || liveSz.imageWidth || 1024,
    height: deps.req.height || liveSz.imageHeight || 1024,
    negativePrompt: deps.req.negativePrompt,
    messages: conv?.messages,
    character: charLive,
    useCharacterStyle: liveSz.imageUseCharacterStyle !== false
  })
  if (built.isSelf && !built.referenceImage) {
    deps.updateMessage(convId, assistantId, {
      content:
        'Para que conserve mi identidad necesito una foto de referencia en Ajustes → Personalidad. Configúrala y vuelve a pedirme la imagen.',
      isStreaming: false,
      meta: { isError: true, errorCode: 'FACEID_REFERENCE_REQUIRED' }
    })
    return
  }
  let finalPrompt = built.finalPrompt
  let width = built.width
  let height = built.height
  let negative = built.negative
  const revisionSeed = built.seed
  let revisionNote = built.revisionNote || ''

  // I1 — LLM crafts detailed SD prompt (Gemma/LMS); host keeps identity locks
  let craftMeta: CraftedImagePrompt | null = null
  try {
    deps.setLiveStatus?.({
      phase: 'image-craft',
      route: null,
      label: 'Preparando prompt con el modelo local…',
      tried: deps.getTried?.() || []
    })
    const appearance = stripOutfitFromAppearance(
      String(charLive?.visualDescription || '').trim()
    )
    const idProfile = buildIdentityProfile({
      character: charLive as import('@core/character/profile').CharacterProfile | null,
      primaryPhoto: built.referenceImage,
      secondaryRefs: built.referenceImages || []
    })
    const modelId = (liveSz.localModel || '').trim()
    if (modelId) {
      craftMeta = await craftImagePromptWithLlm(
        {
          userText: deps.trimmed,
          isSelf: built.isSelf,
          characterName: charLive?.name,
          appearanceSummary: appearance,
          identity: idProfile,
          baselinePositive: built.finalPrompt,
          baselineNegative: built.negative,
          hasFaceIdRef: Boolean(built.referenceImage)
        },
        async (system, user) => {
          // Prefer OpenAI-compatible (LM Studio); fall back to Ollama
          const openAiBase =
            String(
              (liveSz as { localOpenAIBaseUrl?: string }).localOpenAIBaseUrl || ''
            ).trim() ||
            (String(liveSz.localBaseUrl || '').includes('1234')
              ? String(liveSz.localBaseUrl)
              : 'http://127.0.0.1:1234')
          try {
            const openai = new OpenAICompatibleProvider({
              id: 'local-image-craft',
              displayName: 'Local image craft',
              baseUrl: openAiBase.replace(/\/$/, ''),
              apiKey: 'not-needed',
              timeoutMs: 8_000
            })
            const r = await openai.chat({
              model: modelId,
              temperature: 0.25,
              maxTokens: 450,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
              ]
            })
            const c = String(r.content || '').trim()
            if (c.length > 20) return c
          } catch {
            /* try Ollama */
          }
          const ollama = new OllamaProvider({
            baseUrl: liveSz.localBaseUrl || 'http://127.0.0.1:11434',
            timeoutMs: 8_000
          })
          const r2 = await ollama.chat({
            model: modelId,
            temperature: 0.25,
            maxTokens: 450,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user }
            ]
          })
          return String(r2.content || '')
        },
        5500
      )
      if (craftMeta?.positive) {
        finalPrompt = craftMeta.positive
        negative = craftMeta.negative || negative
        revisionNote = (revisionNote ? revisionNote + ' · ' : '') + 'I1 LLM craft'
        try {
          if (craftMeta.framing) {
            const rec = recommendSdParams({
              prompt: deps.trimmed,
              framing:
                craftMeta.framing === 'close'
                  ? 'portrait'
                  : (craftMeta.framing as 'full' | 'half' | 'wide' | 'portrait'),
              style: (craftMeta.style as never) || undefined
            })
            width = rec.width
            height = rec.height
          }
        } catch {
          /* keep baseline size */
        }
      }
    }
  } catch {
    craftMeta = null
  }
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
    void (async () => {
      try {
        const { formatImageProgressLabel } = await import('@core/image/job-ux')
        deps.setLiveStatus?.({
          phase: 'generating',
          route: null,
          label: formatImageProgressLabel(p.pct, p.detail, (p as { phase?: string }).phase),
          tried: [...(deps.getTried?.() || [])]
        })
      } catch {
        deps.setLiveStatus?.({
          phase: 'generating',
          route: null,
          label: p.detail || `Imagen ${Math.round(p.pct)}%`,
          tried: [...(deps.getTried?.() || [])]
        })
      }
    })()
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
    visualDescription: (
      useSettingsStore.getState().settings.character as { visualDescription?: string } | undefined
    )?.visualDescription,
    characterName: useSettingsStore.getState().settings.character?.name,
    useCharacterStyle:
      (useSettingsStore.getState().settings as { imageUseCharacterStyle?: boolean })
        .imageUseCharacterStyle !== false,
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

  // Ensure no stale busy from a previous cancel that never reached Forge
  try {
    await window.kawaii?.imageForceUnlock?.()
  } catch {
    /* */
  }

  let result = await runGen()
  // If main still reported busy, force unlock and retry once
  if (
    result &&
    typeof result === 'object' &&
    'ok' in result &&
    !result.ok &&
    (result as { code?: string }).code === 'IMAGE_BUSY'
  ) {
    try {
      await window.kawaii?.imageCancel?.()
      await window.kawaii?.imageForceUnlock?.()
      await new Promise((r) => setTimeout(r, 400))
    } catch {
      /* */
    }
    result = await runGen()
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

    const fidStatus = resolveFaceIdStatus({
      faceIdApplied: (result as { faceIdApplied?: boolean }).faceIdApplied,
      model: String(result.model || ''),
      faceIdWarning: (result as { faceIdWarning?: string }).faceIdWarning
    })
    let faceIdStatus: string = fidStatus || 'unknown'
    if (built.isSelf && !built.referenceImage) faceIdStatus = 'no-ref'
    else if (built.isSelf && fidStatus === 'missing') faceIdStatus = 'missing'

    // I3 — show image first, then in-character reaction (LLM micro-turn)
    deps.updateMessage(convId, assistantId, {
      content: '…',
      isStreaming: true,
      attachments: att,
      meta: {
        model: result.model || result.providerId || 'image',
        provider: result.providerId || 'image',
        route: 'image',
        reason: 'imagen',
        imageProvider: result.providerId,
        imageModel: result.model,
        imageWidth: result.width || width,
        imageHeight: result.height || height,
        imageSeed: result.seed,
        imageFilePath: result.filePath,
        imagePrompt: finalPrompt,
        imageNegative: negative,
        imagePromptCraft: craftMeta?.source === 'llm' ? 'llm' : 'heuristic',
        imageRevisionNote: revisionNote || undefined,
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
        imageFaceMatchMethod: (result as { faceMatchMethod?: string }).faceMatchMethod,
        imageFaceMatchNote: (result as { faceMatchNote?: string }).faceMatchNote,
        imageMode:
          (result as { imageMode?: string }).imageMode ||
          (String(result.model || '').includes('txt2img') ? 'txt2img' : undefined),
        imageBatchSize: (result as { batchSize?: number }).batchSize || 1
      }
    })

    // I3 reaction micro-turn (same resident as chat: LMS → Ollama)
    try {
      deps.setLiveStatus?.({
        phase: 'image-reaction',
        route: null,
        label: 'Reaccionando en personaje…',
        tried: deps.getTried?.() || []
      })
      const liveRx = useSettingsStore.getState().settings
      const modelId = (liveRx.localModel || '').trim()
      const reaction = await craftImageReactionWithLlm(
        {
          userText: deps.trimmed,
          isSelf: built.isSelf,
          characterName: liveRx.character?.name,
          imageTitle,
          faceIdStatus,
          faceMatchScore: (result as { faceMatchScore?: number | null }).faceMatchScore,
          usedFallbackProvider: Boolean(
            result.model && String(result.model).includes('fallback')
          ),
          revisionNote: revisionNote || undefined
        },
        async (system, user) => {
          if (!modelId) throw new Error('no-local-model')
          const openAiBase =
            String(
              (liveRx as { localOpenAIBaseUrl?: string }).localOpenAIBaseUrl || ''
            ).trim() ||
            (String(liveRx.localBaseUrl || '').includes('1234')
              ? String(liveRx.localBaseUrl)
              : 'http://127.0.0.1:1234')
          try {
            const openai = new OpenAICompatibleProvider({
              id: 'local-image-reaction',
              displayName: 'Local image reaction',
              baseUrl: openAiBase.replace(/\/$/, ''),
              apiKey: 'not-needed',
              timeoutMs: 10_000
            })
            const r = await openai.chat({
              model: modelId,
              temperature: 0.7,
              maxTokens: 220,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
              ]
            })
            const c = String(r.content || '').trim()
            if (c.length > 8) return c
          } catch {
            /* Ollama */
          }
          const ollama = new OllamaProvider({
            baseUrl: liveRx.localBaseUrl || 'http://127.0.0.1:11434',
            timeoutMs: 10_000
          })
          const r2 = await ollama.chat({
            model: modelId,
            temperature: 0.7,
            maxTokens: 220,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user }
            ]
          })
          return String(r2.content || '')
        },
        6500
      )
      deps.updateMessage(convId, assistantId, {
        content: reaction.content,
        isStreaming: false,
        attachments: att,
        meta: {
          model: result.model || result.providerId || 'image',
          provider: result.providerId || 'image',
          route: 'image',
          reason: 'imagen',
          imageProvider: result.providerId,
          imageModel: result.model,
          imageWidth: result.width || width,
          imageHeight: result.height || height,
          imageSeed: result.seed,
          imageFilePath: result.filePath,
          imagePrompt: finalPrompt,
          imageNegative: negative,
          imagePromptCraft: craftMeta?.source === 'llm' ? 'llm' : 'heuristic',
          imageRevisionNote: revisionNote || undefined,
          imageReactionSource: reaction.source,
          imageWasSelf: built.isSelf,
          imageTitle,
          imageFinalPrompt:
            (result as { finalPrompt?: string }).finalPrompt ||
            String(finalPrompt || '').slice(0, 2000),
          imageFinalNegative:
            (result as { finalNegative?: string }).finalNegative ||
            String(negative || '').slice(0, 1200),
          imageFaceId: fidStatus,
          imageFaceIdWeight: (result as { faceIdWeight?: number }).faceIdWeight,
          imageFaceIdWarning: (result as { faceIdWarning?: string }).faceIdWarning,
          imageRefCount: (built as { referenceCount?: number }).referenceCount,
          imageHasReference: Boolean(built.referenceImage),
          imageRefSources: (built as { refSources?: string[] }).refSources,
          imageFaceMatchScore: (result as { faceMatchScore?: number | null }).faceMatchScore,
          imageFaceMatchMethod: (result as { faceMatchMethod?: string }).faceMatchMethod,
          imageFaceMatchNote: (result as { faceMatchNote?: string }).faceMatchNote,
          imageMode:
            (result as { imageMode?: string }).imageMode ||
            (String(result.model || '').includes('txt2img') ? 'txt2img' : undefined),
          imageBatchSize: (result as { batchSize?: number }).batchSize || 1
        }
      })
    } catch {
      const { buildImageReactionFallback } = await import('@core/image/image-reaction')
      deps.updateMessage(convId, assistantId, {
        content: buildImageReactionFallback({
          userText: deps.trimmed,
          isSelf: built.isSelf,
          characterName: useSettingsStore.getState().settings.character?.name,
          faceIdStatus,
          usedFallbackProvider: Boolean(
            result.model && String(result.model).includes('fallback')
          )
        }),
        isStreaming: false,
        attachments: att
      })
    }
  } else {
    const generationError =
      result && 'error' in result && typeof result.error === 'string'
        ? result.error
        : ''
    let failLine =
      'No pude generar la imagen ahora. Estoy dejando los motores listos en segundo plano; ' +
      'prueba de nuevo en unos segundos o abre Ajustes → Reparar capa de imágenes.'
    let failCode = 'IMAGE_GEN_FAILED'
    if (generationError) {
      try {
        const { humanizeImageError, formatHumanImageErrorLine } = await import(
          '@core/image/job-ux'
        )
        const h = humanizeImageError(generationError)
        failLine = formatHumanImageErrorLine(h)
        failCode = h.code
      } catch {
        failLine = `No pude generar la imagen: ${generationError}`
      }
    }
    deps.updateMessage(convId, assistantId, {
      content: failLine,
      isStreaming: false,
      meta: {
        isError: true,
        errorCode:
          result && 'code' in result && typeof result.code === 'string'
            ? result.code
            : failCode
      }
    })
    deps.setError(generationError || failLine)
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  let catchLine = 'Error al generar imagen: ' + msg
  try {
    const { humanizeImageError, formatHumanImageErrorLine } = await import('@core/image/job-ux')
    catchLine = formatHumanImageErrorLine(humanizeImageError(msg))
  } catch {
    if (/KeyError|ControlNet|postprocess_batch|current_params/i.test(msg)) {
      catchLine +=
        '\n\n_Forge/ControlNet falló (a menudo batch+FaceID). La app ya fuerza batch=1 en autorretrato. Di «instala FaceID» o reinicia Forge y reintenta._'
    } else if (/faceid|FaceID/i.test(msg)) {
      catchLine +=
        '\n\n_Revisa el stack de identidad: di «instala FaceID» (descarga HF + LoRA)._'
    }
  }
  deps.updateMessage(convId, assistantId, {
    content: catchLine,
    isStreaming: false,
    meta: { isError: true }
  })
  deps.setError(msg)
} finally {
  deps.clearLoading()
  try { deps.setLiveStatus?.(null) } catch { /* */ }
  // X7: free initiative timer after image turn (success or fail)
  try {
    const { markAssistantStreamDone } = await import('./turn-initiative-hooks')
    if (convId) markAssistantStreamDone(convId)
  } catch {
    /* optional */
  }
}

}
