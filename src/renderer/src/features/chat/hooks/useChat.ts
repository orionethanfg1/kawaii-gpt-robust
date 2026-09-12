import { notifyUser } from '@shared/lib/notify'
import { isMusicCapabilityQuestion } from '@core/generative/intent'
import {
  parseInitiativeSnooze,
  annotateEmojisForModel,
  buildTimeAwarenessBlock
} from '@core/conversation/initiative'
import { safePlanGenerativeTurn } from '@core/generative'
import { pickBestCheckpoint } from '@core/generative/smart-checkpoint'
import { detectGenerativeIntent } from '@core/generative/intent'
import { composeImagePrompt, recommendSdParams, parseImageIntent } from '@core/generative/prompt-compose'
import { useCallback, useRef, useState } from 'react'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { sendChatMessage, type RouteInfo } from '../services/chatOrchestrator'
import { AppError, friendlyProviderMessage } from '@core/errors'
import {
  learnFromError,
  markRemedyWorked,
  softTipFromLearning
} from '@core/diagnostics/mini-brain'
import { useRecoveryStore } from '@shared/lib/stores/recoveryStore'
import { useDownloadStore } from '@features/models/downloadStore'
import { runSelfDiagnosis } from '@core/diagnostics/self-heal'
import { runNetworkProbe, networkHintForError } from '@core/diagnostics/network-probe'
import type { ChatMessage } from '@core/providers'
import {
  labelForPhase,
  type LivePhase,
  type LiveStatus
} from '../components/RouteLiveIndicator'
import { syncRelationshipFromTurn } from '../services/relationshipSync'
import {
  buildAppAgentSystemBlock,
  runActionsFromAssistantText,
  buildToolObservationPrompt,
  applyAutoModelRouting,
  forceStatusAndModelsReport,
  isStatusOrModelsQuery,
  extractModelTagsFromObservations,
  formatHostModelListReply,
  isHallucinatedModelList
} from '../services/appAgent'
import { stripHarnessMarkup } from '@core/agent'
import { ensureVisualDescriptionFromAvatar } from '@features/settings/ensureVisualDescription'
import { looksLikeAppearanceQuestion } from '@core/character/profile'
import { setBackgroundSummaryBusy } from '../services/backgroundSummary'
import { useActivityStore } from '@shared/lib/stores/activityStore'
import {
  extractUserFactsFromMessage,
  mergeUserMemory
} from '@core/conversation/user-memory'
import {
  looksLikeImageRevision,
  shouldForceImageRevision,
  reviseImagePrompt,
  looksLikeIdentityReject,
  type ImageRevisionMemory
} from '@core/generative/image-revision'

function notifyChatReply(preview: string, meta?: { model?: string; isError?: boolean }) {
  const body = stripHarnessMarkup(preview || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  if (!body || /\{\s*"goal"|<<<APP_/i.test(body)) return // no notify on harness noise
  if (meta?.isError) {
    void notifyUser('Error en la respuesta', body || 'Revisa el mensaje en el chat', {
      kind: 'error',
      sticky: true,
      os: true
    })
    return
  }
  void notifyUser('Nueva respuesta', body || 'El chat respondió', {
    kind: 'success',
    sticky: true,
    os: true, // notify.ts skips OS when window focused
    silent: false
  })
}


export function useChat() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRoute, setLastRoute] = useState<RouteInfo | null>(null)
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const triedRef = useRef<string[]>([])
  const inFlightRef = useRef(false)
  const loadWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearLoading = useCallback(() => {
    inFlightRef.current = false
    setIsLoading(false)
    setBackgroundSummaryBusy(false)
    if (loadWatchdogRef.current) {
      clearTimeout(loadWatchdogRef.current)
      loadWatchdogRef.current = null
    }
  }, [])

  const armLoading = useCallback(() => {
    inFlightRef.current = true
    setIsLoading(true)
    if (loadWatchdogRef.current) clearTimeout(loadWatchdogRef.current)
    // Safety: never leave the input locked more than 4 minutes
    loadWatchdogRef.current = setTimeout(() => {
      if (inFlightRef.current) {
        console.warn('[useChat] loading watchdog fired — unlocking input')
        abortRef.current?.abort()
        abortRef.current = null
        clearLoading()
        setLiveStatus(null)
        setError((e) => e || 'La operación tardó demasiado y se liberó el chat.')
      }
    }, 240_000)
  }, [clearLoading])

  const { settings } = useSettingsStore()
  const { activeId, create, addMessage, updateMessage, deleteMessage, deleteMessagesFrom, getActive, setRollingSummary } =
    useChatStore()

  const setPhase = useCallback((phase: LivePhase, route: RouteInfo | null = null) => {
    setLiveStatus({
      phase,
      route,
      label: labelForPhase(phase, route),
      tried: [...triedRef.current]
    })
  }, [])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    clearLoading()
    setLiveStatus(null)
    triedRef.current = []
  }, [clearLoading])

  const sendMessage = useCallback(
    async (content: string, attachments?: import('@core/conversation').Attachment[]) => {
      const trimmed = content.trim()
      const hasAtt = !!(attachments && attachments.length)
      if ((!trimmed && !hasAtt) || inFlightRef.current) return

      // Natural-language initiative snooze ("dame 5 minutos", "no me hables en 2 minutos")
      try {
        const snooze = parseInitiativeSnooze(trimmed)
        if (snooze) {
          const until = Date.now() + snooze.ms
          useSettingsStore.getState().update({
            conversationInitiativeSnoozeUntil: until,
            conversationInitiativeEnabled: true
          })
          let convId = activeId
          if (!convId) convId = create()
          addMessage(convId, { role: 'user', content: trimmed || '📷', attachments: hasAtt ? attachments : undefined })
          const ack =
            snooze.kind === 'silence'
              ? `De acuerdo… me quedo en silencio unos ${snooze.label}. Cuando quieras, me escribes.`
              : snooze.kind === 'busy'
                ? `Entendido, te dejo espacio (~${snooze.label}). Aquí estaré cuando puedas.`
                : `Vale, te espero ${snooze.label}. No te interrumpo 💕`
          addMessage(convId, {
            role: 'assistant',
            content: ack,
            meta: {
              model: 'initiative-snooze',
              provider: 'app',
              route: 'local',
              reason: 'Pausa de iniciativa'
            }
          })
          // Continue to full LLM reply as well only if message is more than pure snooze
          // Short pure commands stop here; longer messages still go to the model.
          if (trimmed.length < 80 && !/[?.!]/.test(trimmed.slice(0, -1))) {
            return
          }
        }
      } catch {
        /* ignore */
      }

      // ——— Harness: status / model inventory is HOST-OWNED (never trust LLM inventory) ———
      if (isStatusOrModelsQuery(trimmed) && !hasAtt) {
        let convId = activeId
        if (!convId) convId = create()
        inFlightRef.current = true
        setIsLoading(true)
        setError(null)
        addMessage(convId, {
          role: 'user',
          content: trimmed,
          attachments: undefined
        })
        const assistantId = addMessage(convId, {
          role: 'assistant',
          content: 'Un momento, estoy revisando el estado y los modelos en la app…',
          isStreaming: true
        })
        try {
          const report = await forceStatusAndModelsReport()
          updateMessage(convId, assistantId, {
            content: report.content,
            isStreaming: false,
            meta: {
              model: 'harness-host',
              provider: 'app',
              route: 'local',
              reason: 'Estado y modelos (determinista)',
              planSummary: 'diagnóstico host: estado + modelos locales',
              harnessLog: report.actionLog.slice(0, 12)
            }
          })
          notifyChatReply(report.content.slice(0, 120))
        } catch (e) {
          updateMessage(convId, assistantId, {
            content:
              'No pude completar el diagnóstico automático. Revisa Ajustes → Capas o el Tester de sistema.\n\n' +
              (e instanceof Error ? e.message : String(e)),
            isStreaming: false,
            meta: { model: 'harness-host', provider: 'app', route: 'local', reason: 'Error diagnóstico' }
          })
        } finally {
          inFlightRef.current = false
          setIsLoading(false)
          setLiveStatus(null)
        }
        return
      }

      // Multi-layer generative (fail-soft): never block pure chat if media stack fails
      let mediaRequests: Array<{
        modality: string
        prompt?: string
        negativePrompt?: string
        width?: number
        height?: number
        seed?: number
        stylePrompt?: string
        meta?: { source?: string }
      }> = []
      // Default ON if undefined (older persisted settings)
      let imageOn = settings.imageGenEnabled !== false
      let imageMode = settings.imageProviderMode
      try {
        // Auto-enable smart image layer on clear visual intent (fail-soft)
        if (
          (!imageOn || imageMode === 'off') &&
          /\b(imagen|foto|dibujo|ilustraci|picture|image)\b/i.test(trimmed)
        ) {
          imageOn = true
          imageMode = imageMode === 'off' ? 'smart' : imageMode
          try {
            useSettingsStore.getState().update({
              imageGenEnabled: true,
              imageProviderMode: imageMode
            })
          } catch {
            /* ignore */
          }
        }
        const live = useSettingsStore.getState().settings
        const photoAsk = /\b(foto|fotografía|fotografia|photo|realista|retrato)\b/i.test(trimmed)
        const selfPortrait =
          /\b(tuya|tuyo|foto tuya|imagen tuya|de ti(?:\s+misma)?|como t[uú]|tu avatar|autorretrato|selfie)\b/i.test(
            trimmed
          ) ||
          Boolean(
            live.character?.name &&
              new RegExp(
                `\\b${String(live.character.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
                'i'
              ).test(trimmed)
          )
        const safe = safePlanGenerativeTurn(trimmed, {
          imageGenEnabled: imageOn,
          imageProviderMode: imageMode,
          musicEnabled: live.musicGenEnabled === true,
          videoEnabled: live.videoGenEnabled === true,
          character: live.character,
          // Self-portrait → character look; generic photo → no avatar bleed
          useCharacterStyle: selfPortrait
            ? true
            : photoAsk
              ? false
              : live.imageUseCharacterStyle !== false,
          imageWidth: live.imageWidth || 1024,
          imageHeight: live.imageHeight || 1024
        })
        mediaRequests = safe.mediaRequests as typeof mediaRequests
        if (safe.mediaHint) console.debug('[kawaii:generative-bridge]', safe.mediaHint)
        if (safe.error) console.warn('[kawaii:generative-bridge]', safe.error)
      } catch (e) {
        console.error('[kawaii:generative] isolated failure', e)
      }

      // Natural revision of last image even without «genera imagen»
      // Detect prior image early (ChatGPT-style short edits: "hazla más joven")
      const convPeekEarly = activeId
        ? useChatStore.getState().conversations.find((c) => c.id === activeId)
        : null
      const hasPrevImg = Boolean(
        convPeekEarly?.messages.some(
          (m) =>
            m.meta?.imageFilePath ||
            m.meta?.imagePrompt ||
            m.attachments?.some((a) => a.mimeType?.startsWith('image/'))
        )
      )

      // Hard guarantee: explicit "haz una foto/imagen…" must generate, not only chat
      try {
        const intent = detectGenerativeIntent(trimmed)
        if (intent.modality === 'image' && imageOn) {
          if (mediaRequests.length === 0) {
            mediaRequests = [
              {
                modality: 'image',
                prompt: intent.prompt || trimmed,
                width: settings.imageWidth || 1024,
                height: settings.imageHeight || 1024
              }
            ]
          }
        }
      } catch {
        /* ignore */
      }

      // Force image revision path (must work even if planner returned text-only)
      if (
        imageOn &&
        hasPrevImg &&
        mediaRequests.length === 0 &&
        (looksLikeImageRevision(trimmed, true) || shouldForceImageRevision(trimmed, true))
      ) {
        mediaRequests = [
          {
            modality: 'image',
            prompt: trimmed,
            width: settings.imageWidth || 1024,
            height: settings.imageHeight || 1024
          }
        ]
      }

      // Analyze / describe last image → text only with generation memory (ChatGPT-style)
      let imageContextForText = ''
      if (
        /\b(analiz|describ|explic|cu[eé]ntame|qu[eé]\s+ves|c[oó]mo\s+se\s+ve|opina)\b/i.test(
          trimmed
        ) &&
        /\b(foto|imagen|dibujo)\b/i.test(trimmed)
      ) {
        const convPeek = activeId
          ? useChatStore.getState().conversations.find((c) => c.id === activeId)
          : null
        const lastImg = [...(convPeek?.messages || [])]
          .reverse()
          .find(
            (m) =>
              m.meta?.imagePrompt ||
              m.meta?.imageFilePath ||
              m.attachments?.some((a) => a.mimeType?.startsWith('image/'))
          )
        if (lastImg) {
          const att = lastImg.attachments?.find((a) => a.mimeType?.startsWith('image/'))
          imageContextForText = [
            '[Análisis de imagen en este chat — responde en texto, NO generes otra imagen]',
            lastImg.meta?.imagePrompt
              ? `Prompt usado: ${String(lastImg.meta.imagePrompt).slice(0, 500)}`
              : '',
            lastImg.meta?.imageProvider
              ? `Proveedor: ${lastImg.meta.imageProvider}`
              : '',
            lastImg.meta?.imageWidth
              ? `Tamaño: ${lastImg.meta.imageWidth}×${lastImg.meta.imageHeight}`
              : '',
            att?.name ? `Archivo adjunto: ${att.name}` : '',
            lastImg.meta?.imageFilePath
              ? `Ruta local: ${String(lastImg.meta.imageFilePath)}`
              : '',
            'Analiza con honestidad: composición, estilo, defectos (manos, ojos, texto), coherencia con el pedido y con el avatar del personaje si aplica. Si no ves la imagen real, basa el análisis en el prompt y sé transparente.'
          ]
            .filter(Boolean)
            .join('\n')
        }
      }

      // Meta capability ONLY when not generating a concrete image
      const lowerQ = trimmed.toLowerCase()
      // "esa no eres tú" after an image → must regenerate, not only apologize in text
      if (
        mediaRequests.length === 0 &&
        looksLikeIdentityReject(trimmed) &&
        hasPrevImg
      ) {
        const char = settings.character
        const look = (char?.visualDescription || '').trim()
        mediaRequests = [
          {
            modality: 'image' as const,
            prompt: look
              ? `photorealistic portrait of ${char?.name || 'character'}, ${look}`
              : `photorealistic portrait of ${char?.name || 'the character'}, match avatar identity`,
            negativePrompt:
              'wrong person, different face, wrong hair color, two people, blurry',
            width: settings.imageWidth || 768,
            height: settings.imageHeight || 1024
          }
        ]
      }


      // Music capability question (no generation job)
      if (
        mediaRequests.length === 0 &&
        isMusicCapabilityQuestion(trimmed)
      ) {
        let convId = activeId
        if (!convId) convId = create()
        addMessage(convId, { role: 'user', content: trimmed || '📷', attachments: hasAtt ? attachments : undefined })
        const liveM = useSettingsStore.getState().settings
        const musicOn = liveM.musicGenEnabled === true
        const reply = musicOn
          ? `Sí — puedo generar canciones con la capa de música (ACE-Step local). Dime un estilo o tema, por ejemplo: «genera una canción pop sobre un viaje» o «haz una balada suave». La primera vez el motor puede tardar en arrancar.`
          : `Puedo generar música, pero la capa está desactivada. Actívala en Ajustes → Capas → Música (o di «activa la música» si el control de app está disponible) y luego pídeme una canción concreta.`
        addMessage(convId, {
          role: 'assistant',
          content: reply,
          meta: {
            model: 'local-capability',
            provider: 'app',
            route: 'local',
            reason: 'Capacidad de música'
          }
        })
        return
      }

      const hasMediaJob = mediaRequests.some(
        (r) => (r.modality === 'image' || r.modality === 'music') && String(r.prompt || '').trim()
      )
      const wantsConcreteImage =
        /\b(imagen|foto|dibujo)\s+(tuya|tuyo|de ti|como tú|como tu)\b/i.test(trimmed) ||
        /\b(genera|generame|genérame|dibuja|crea|haz)\b[\s\S]{0,40}\b(imagen|foto|dibujo)\b/i.test(
          trimmed
        )
      if (
        !hasMediaJob &&
        !wantsConcreteImage &&
        (/\b(puedes|podes|podés|can you)\b.*\b(generar|crear|hacer)\b.*\b(im[aá]genes?|imagen|dibujo)/i.test(
          trimmed
        ) ||
          /\b(generas|haces)\b.*\b(im[aá]genes?)\b/i.test(lowerQ))
      ) {
        let convId = activeId
        if (!convId) convId = create()
        addMessage(convId, { role: 'user', content: trimmed || '📷', attachments: hasAtt ? attachments : undefined })
        const imgOn = settings.imageGenEnabled !== false
        const mode = settings.imageProviderMode || 'off'
        const reply = imgOn
          ? `Sí — puedes pedirme imágenes en el chat (p. ej. «dibuja un gato» o «genera una imagen tuya»). Modo: ${mode}.`
          : `La generación de imágenes está desactivada. Actívala en Ajustes.`
        addMessage(convId, {
          role: 'assistant',
          content: reply,
          meta: {
            model: 'local-capability',
            provider: 'app',
            route: 'local',
            reason: 'Respuesta de capacidades (sin cloud)'
          }
        })
        return
      }

      let mediaHandled = false
      try {
        if (mediaRequests.some((r) => r.modality === "image" && (r.prompt || "").trim())) {
          mediaHandled = true
          const req = mediaRequests.find((r) => r.modality === 'image') || mediaRequests[0]
          if (req.modality === 'image' && (req.prompt || '').trim()) {
            let convId = activeId
            if (!convId) convId = create()
            addMessage(convId, { role: 'user', content: trimmed || '📷', attachments: hasAtt ? attachments : undefined })
            const assistantId = addMessage(convId, {
              role: 'assistant',
              content: 'Generando imagen…',
              isStreaming: true
            })
            armLoading()
            setError(null)
            try {
              // Last image in this conversation → revision memory
              const conv = useChatStore
                .getState()
                .conversations.find((c) => c.id === convId)
              let prevMem: ImageRevisionMemory | null = null
              if (conv) {
                for (let i = conv.messages.length - 1; i >= 0; i--) {
                  const m = conv.messages[i]
                  if (m.meta?.imageFilePath || m.attachments?.some((a) => a.mimeType?.startsWith('image/'))) {
                    prevMem = {
                      prompt: String(m.meta?.imagePrompt || m.meta?.reason || ''),
                      width: m.meta?.imageWidth,
                      height: m.meta?.imageHeight,
                      seed: m.meta?.imageSeed,
                      provider: m.meta?.imageProvider
                    }
                    // Prefer stored full prompt if present
                    if (!prevMem.prompt && m.content) {
                      const line = m.content.split('\n').find((l) => l.startsWith('Prompt:'))
                      if (line) prevMem.prompt = line.replace(/^Prompt:\s*/i, '')
                    }
                    break
                  }
                }
              }
              let finalPrompt = String(req.prompt || '').trim()
              const liveSz = useSettingsStore.getState().settings
              let width = req.width || liveSz.imageWidth || 1024
              let height = req.height || liveSz.imageHeight || 1024
              let negative = req.negativePrompt
              {
                const intentRev = parseImageIntent(trimmed)
                const wantsSelfRev =
                  !intentRev.explicitOther &&
                  (intentRev.isSelf ||
                    /\b(como t[uú]|igual que t[uú]|tu misma|tu mismo)\b/i.test(trimmed))
                // Only revise previous image if user is iterating on self / same subject
                if (prevMem && looksLikeImageRevision(trimmed, true) && wantsSelfRev) {
                  const base = {
                    ...prevMem,
                    prompt:
                      prevMem.prompt ||
                      'photorealistic portrait of a young woman, detailed face, natural lighting'
                  }
                  const char = useSettingsStore.getState().settings.character
                  const revised = reviseImagePrompt(base, trimmed, {
                    characterLook:
                      (char?.visualDescription || '').trim() || undefined,
                    characterName: char?.name
                  })
                  finalPrompt = revised.prompt
                  width = revised.width || width
                  height = revised.height || height
                  negative = revised.negativePrompt || negative
                }
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
              const unsubImg = window.kawaii?.onImageGenerateProgress?.((p) => {
                setLiveStatus({
                  phase: 'generating',
                  route: null,
                  label: p.detail || `Imagen ${Math.round(p.pct)}%`,
                  tried: [...triedRef.current]
                })
              })
              // Local SD: re-compose as SD1.5 tags + identity from ficha visual
              if (providerPref === 'a1111' || providerPref === 'smart') {
                try {
                  const charLive = useSettingsStore.getState().settings.character
                  // Identity lock ONLY for self-portraits ("foto tuya", selfie…) — never override unrelated subjects
                  const intentForChar = parseImageIntent(trimmed)
                  const wantsSelf =
                    !intentForChar.explicitOther &&
                    (intentForChar.isSelf ||
                      /\b(como t[uú]|igual que t[uú]|tu misma|tu mismo|de niamh|sé t[uú] misma)\b/i.test(
                        trimmed
                      ))
                  const useChar =
                    liveMode.imageUseCharacterStyle !== false && wantsSelf
                  const composed = composeImagePrompt(
                    prevMem && looksLikeImageRevision(trimmed, true) && wantsSelf
                      ? finalPrompt
                      : trimmed,
                    'sd15',
                    {
                      visualDescription: (charLive?.visualDescription || '').trim() || undefined,
                      characterName: charLive?.name,
                      useCharacter: useChar
                    }
                  )
                  // Always prefer identity-aware composition for self / first shot
                  if (!prevMem || !looksLikeImageRevision(trimmed, true)) {
                    finalPrompt = composed.prompt
                    negative = composed.negativePrompt || negative
                  } else {
                    finalPrompt = [composed.prompt, finalPrompt].filter(Boolean).join(', ')
                    negative = [negative, composed.negativePrompt].filter(Boolean).join(', ')
                  }
                  const rec = recommendSdParams({ prompt: finalPrompt, framing: composed.parsed?.framing, style: composed.styleId })
                  if (useChar) {
                    negative = [negative, 'two heads, two faces, double head, stacked heads, conjoined'].filter(Boolean).join(', ')
                  }

                  if (!req.width && !liveSz.imageWidth) {
                    width = rec.width
                    height = rec.height
                  }
                  // Prefer recommended when user left defaults
                  if (!liveMode.a1111Steps && !settings.a1111Steps) {
                    /* steps applied below */
                  }
                } catch {
                  /* ignore */
                }
              }
              let autoSteps = liveMode.a1111Steps || settings.a1111Steps || 0
              let autoCfg = liveMode.a1111CfgScale || settings.a1111CfgScale || 0
              try {
                const intent = parseImageIntent(trimmed)
                const rec = recommendSdParams({
                  prompt: finalPrompt,
                  framing: intent.framing,
                  style: intent.style
                })
                if (!autoSteps) autoSteps = rec.steps
                if (!autoCfg) autoCfg = rec.cfgScale
                const smartUi = (liveMode.uiComplexity || 'smart') !== 'advanced'
                // Smart mode: always use SD-native friendly sizes unless user asked 2x/4k in text
                if (smartUi && !/\b(el doble|2x|4k|m[aá]s grande)\b/i.test(trimmed)) {
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
                liveMode.a1111Checkpoint || settings.a1111Checkpoint || undefined
              if (!checkpoint) {
                try {
                  const list = await window.kawaii?.imageA1111Models?.(
                    liveMode.a1111BaseUrl || settings.a1111BaseUrl
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
              // Multi-avatar gallery: bias scene/outfit without changing identity
              try {
                const gal = useSettingsStore.getState().settings.character?.visualGallery || []
                const labels = gal
                  .map((g) => g.scene || g.label)
                  .filter(Boolean)
                  .slice(0, 4)
                if (labels.length && /\b(tuya|tuyo|de ti|avatar|autorretrato|selfie)\b/i.test(trimmed + ' ' + finalPrompt)) {
                  finalPrompt =
                    finalPrompt +
                    `, consistent character identity, alternate reference looks: ${labels.join(' / ')}`
                }
              } catch {
                /* ignore */
              }

              // Auto-start Forge when local/smart needs A1111
              if (providerPref === 'a1111' || providerPref === 'smart') {
                try {
                  const health = await window.kawaii?.imageA1111Health?.(
                    liveMode.a1111BaseUrl || settings.a1111BaseUrl
                  )
                  if (!health?.ok) {
                    updateMessage(convId, assistantId, {
                      content: 'Arrancando Forge/SD (API local)… esto puede tardar 1–3 min la primera vez.',
                      isStreaming: true,
                      meta: {
                        model: 'app',
                        provider: 'app',
                        route: 'local',
                        reason: 'Auto-arranque Forge'
                      }
                    })
                    const started = await window.kawaii?.forgeStart?.()
                    let ready = false
                    for (let i = 0; i < 36; i++) {
                      await new Promise((r) => setTimeout(r, 2500))
                      const pct = Math.min(95, Math.round(((i + 1) / 36) * 100))
                      updateMessage(convId, assistantId, {
                        content: `Arrancando Forge/SD… ${pct}% (esperando API en el puerto). No cierres la app.`,
                        isStreaming: true
                      })
                      try {
                        const h2 = await window.kawaii?.imageA1111Health?.(
                          (started as { baseUrl?: string })?.baseUrl ||
                            liveMode.a1111BaseUrl ||
                            settings.a1111BaseUrl
                        )
                        if (h2?.ok) {
                          ready = true
                          updateMessage(convId, assistantId, {
                            content: 'Forge listo. Generando imagen…',
                            isStreaming: true
                          })
                          break
                        }
                      } catch {
                        /* keep waiting */
                      }
                    }
                    if (!ready) {
                      updateMessage(convId, assistantId, {
                        content:
                          'Forge aún no responde a la API. Abre Ajustes → Capas → Arrancar Forge API y espera a Health OK; luego reintenta la imagen.',
                        isStreaming: false,
                        meta: { isError: true, errorCode: 'FORGE_TIMEOUT' }
                      })
                      // abort this generation path
                      return
                    }
                  }
                } catch {
                  /* continue; imageGenerate will report error */
                }
              }
              const result = await window.kawaii?.imageGenerate?.({
                prompt: finalPrompt,
                negativePrompt: negative,
                width,
                height,
                seed: req.seed,
                provider: providerPref,
                a1111BaseUrl: liveMode.a1111BaseUrl || settings.a1111BaseUrl,
                steps: autoSteps || 28,
                cfgScale: autoCfg || 7,
                checkpoint,
                cloudflareAccountId:
                  (liveMode.cloudflareAccountId || settings.cloudflareAccountId || '').trim() ||
                  undefined,
                timeoutMs: 180_000
              })
              unsubImg?.()
              if (result && 'ok' in result && result.ok) {
                const dataUrl = result.dataUrl
                const imageTitle = (() => {
                  const it = parseImageIntent(trimmed)
                  if (it.isSelf) {
                    const n = useSettingsStore.getState().settings.character?.name || 'Personaje'
                    return `${n} · ${it.framing}`
                  }
                  const short = trimmed
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
                        dataUrl
                      }
                    ]
                  : undefined
                updateMessage(convId, assistantId, {
                  content:
                    `**${imageTitle}**\n\nAquí tienes la imagen.` +
                    (result.providerId ? ` (${result.providerId})` : '') +
                    (result.model && String(result.model).includes('fallback')
                      ? `\n\n_Nota: ${String(result.model).slice(0, 160)}_`
                      : '') +
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
                    imageTitle,
                  }
                })
              } else {
                updateMessage(convId, assistantId, {
                  content:
                    'No pude generar la imagen ahora. Estoy dejando los motores listos en segundo plano; ' +
                    'prueba de nuevo en unos segundos o abre Ajustes → Reparar capa de imágenes.',
                  isStreaming: false,
                  meta: { isError: true, errorCode: 'IMAGE_GEN_FAILED' }
                })
                setError('Generación de imagen no disponible todavía. Reintentando preparación…')
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              updateMessage(convId, assistantId, {
                content: `Error al generar imagen: ${msg}`,
                isStreaming: false,
                meta: { isError: true }
              })
              setError(msg)
            } finally {
              clearLoading()
            }
            return // image path done — never run text LLM / context summary
          }
          if (req.modality === 'video') {
            setError(
              'Capa de video pendiente. Prompt preparado: ' +
                String(req.prompt || '').slice(0, 120)
            )
            return
          }
        }

                // "Where are my files?" / "open music folder"
        const wantsOpenFolder =
          /\b(abre|abrir|open)\b/i.test(trimmed) &&
          /\b(carpeta|folder|directorio)\b/i.test(trimmed)
        const wantsWhereFiles =
          (/\b(d[oó]nde|donde)\b/i.test(trimmed) &&
            /\b(archivo|archivos|m[uú]sica|cancion|canción|imagen|im[aá]genes|guarda|carpeta|descarga|ver)\b/i.test(
              trimmed
            )) ||
          /\b(m[uú]sica generada|ver la m[uú]sica|d[oó]nde.*m[uú]sica)\b/i.test(trimmed)
        if (wantsWhereFiles || wantsOpenFolder) {
          let convId = activeId
          if (!convId) convId = create()
          addMessage(convId, { role: 'user', content: trimmed })
          const assistantId = addMessage(convId, {
            role: 'assistant',
            content: 'Buscando carpetas de la app…',
            isStreaming: true
          })
          try {
            const res = await window.kawaii?.filesListKnownDirs?.()
            const dirs = res?.dirs || []
            // Auto-open if user asked to open a specific folder
            if (wantsOpenFolder && dirs.length) {
              const t = trimmed.toLowerCase()
              const pick =
                dirs.find((d) => /m[uú]sica|music|ace/i.test(t) && /music|ace|m[uú]sica/i.test(d.id + d.label)) ||
                dirs.find((d) => /imagen|image|foto/i.test(t) && /image/i.test(d.id + d.label)) ||
                dirs.find((d) => /forge|sd|stable/i.test(t) && /forge|sd/i.test(d.id + d.label)) ||
                dirs[0]
              if (pick?.path) {
                await window.kawaii?.filesOpenPath?.(pick.path)
              }
            }
            const lines = dirs.map(
              (d) => `- **${d.label}**\n  \`${d.path}\``
            )
            updateMessage(convId, assistantId, {
              content:
                (lines.length
                  ? 'Estas son las carpetas de KawaiiGPT. **Usa los botones de abajo** para abrirlas en el explorador:\n\n' +
                    lines.join('\n\n')
                  : 'No pude listar carpetas todavía. Revisa Ajustes → Capas.') +
                (res?.error ? `\n\n_(${res.error})_` : ''),
              isStreaming: false,
              meta: {
                modality: 'files',
                knownDirs: dirs
              }
            })
          } catch (e) {
            updateMessage(convId, assistantId, {
              content: `No pude localizar carpetas: ${e instanceof Error ? e.message : String(e)}`,
              isStreaming: false,
              meta: { isError: true }
            })
          }
          clearLoading()
          inFlightRef.current = false
          return
        }

        // Image jobs already handled inline above; avoid opening the separate panel.
      
        // Music generation (ACE-Step local)
        if (mediaRequests.some((r) => r.modality === 'music' && String(r.prompt || r.stylePrompt || '').trim())) {
          mediaHandled = true
          const req = mediaRequests.find((r) => r.modality === 'music')!
          let convId = activeId
          if (!convId) convId = create()
          addMessage(convId, { role: 'user', content: trimmed || '📷', attachments: hasAtt ? attachments : undefined })
          const assistantId = addMessage(convId, {
            role: 'assistant',
            content: 'Preparando motor de música (ACE-Step)…',
            isStreaming: true
          })
          armLoading()
          setError(null)
          setPhase('generating', null)
          const prompt = String(req.stylePrompt || req.prompt || trimmed).trim()
          const lyrics = String((req as { lyrics?: string }).lyrics || '').trim()
          try {
            // Auto-enable on first use if the user asked for music
            if (!settings.musicGenEnabled) {
              try {
                useSettingsStore.getState().update({ musicGenEnabled: true })
              } catch {
                /* ignore */
              }
            }
            const gen = await window.kawaii.musicGenerate?.({
              prompt,
              lyrics: lyrics || undefined,
              durationSec: 60,
              vocalLanguage: 'es'
            })
            if (!gen?.ok) {
              throw new Error(gen?.error || 'No se pudo generar la pista')
            }
            const pathLabel = String((gen as { path?: string; audioPath?: string }).path || (gen as { audioPath?: string }).audioPath || '').trim()
            let dataUrl: string | undefined
            if (pathLabel && window.kawaii?.filesToDataUrl) {
              try {
                const emb = await window.kawaii.filesToDataUrl(pathLabel)
                if (emb?.ok && emb.dataUrl) dataUrl = emb.dataUrl
              } catch {
                /* ignore */
              }
            }
            const att = pathLabel
              ? [
                  {
                    id: `music_${Date.now()}`,
                    name: pathLabel.split(/[/\\]/).pop() || 'track.mp3',
                    mimeType: pathLabel.toLowerCase().endsWith('.wav')
                      ? 'audio/wav'
                      : 'audio/mpeg',
                    sizeBytes: 0,
                    filePath: pathLabel,
                    dataUrl
                  }
                ]
              : undefined
            updateMessage(convId, assistantId, {
              content:
                'Listo — pista generada con ACE-Step. Repródúcela abajo o abre la carpeta.' +
                (pathLabel ? `\n\n📁 \`${pathLabel}\`` : ''),
              isStreaming: false,
              attachments: att,
              meta: {
                musicPath: pathLabel || undefined,
                musicTaskId: gen.taskId,
                modality: 'music'
              }
            })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            updateMessage(convId, assistantId, {
              content: `Error al generar música: ${msg}`,
              isStreaming: false,
              meta: { isError: true }
            })
            setError(msg)
          } finally {
            clearLoading()
          }
          return
        }

} catch (e) {
        console.error('[kawaii:media-handoff] isolated failure', e)
        if (mediaHandled) {
          // Do not fall through to cloud chat after a failed image job
          setError(e instanceof Error ? e.message : String(e))
          clearLoading()
          inFlightRef.current = false
          return
        }
      }
      if (mediaHandled) {
        inFlightRef.current = false
        return
      }

      let convId = activeId
      if (!convId) {
        convId = create()
      }

      addMessage(convId, { role: 'user', content: trimmed || '📷', attachments: hasAtt ? attachments : undefined })
      try {
        const facts = extractUserFactsFromMessage(trimmed)
        if (facts.length) {
          const prev = useSettingsStore.getState().settings.userMemory
          useSettingsStore.getState().update({
            userMemory: mergeUserMemory(prev, facts)
          })
        }
        // Relationship role auto-sync (user-initiated shift)
        try {
          syncRelationshipFromTurn(trimmed)
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
      const assistantId = addMessage(convId, {
        role: 'assistant',
        content: '',
        isStreaming: true
      })

      armLoading()
      setBackgroundSummaryBusy(true)
      setError(null)
      triedRef.current = []
      setPhase('generating', null) // avoid long 'Preparando' before route resolves
      useRecoveryStore.getState().touch({
        dirty: true,
        activeConversationId: convId,
        pendingAssistantId: assistantId,
        pendingUserPreview: trimmed.slice(0, 120),
        draftText: undefined
      })

      const controller = new AbortController()
      abortRef.current = controller

      const conv = getActive()
      const history: ChatMessage[] = (conv?.messages ?? [])
        .filter((m) => m.id !== assistantId && m.content)
        .slice(0, -1)
        .map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content
        }))

      let apiKey = ''
      let providerKeys: Record<string, string> = {}
      try {
        providerKeys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
        apiKey =
          providerKeys.openrouter ||
          providerKeys.main ||
          (await window.kawaii?.getCloudApiKey?.()) ||
          ''
      } catch {
        try {
          apiKey = (await window.kawaii?.getCloudApiKey?.()) ?? ''
        } catch {
          // ignore
        }
      }

      const routeSnapshot = { current: null as RouteInfo | null }

      try {
        const convState = getActive()
        let extraSystem = ''
        try {
          // No app-agent tools while generating/revising media — avoids health_forge noise
          if (!hasMediaJob) {
            extraSystem = await buildAppAgentSystemBlock()
          } else {
            extraSystem =
              'El usuario pidió generar o revisar una imagen. Responde breve en lenguaje natural. ' +
              'NO uses bloques APP_ACTION ni herramientas de Forge/Ollama en este turno. ' +
              (looksLikeIdentityReject(trimmed)
                ? 'El usuario rechazó la imagen anterior porque NO era tu apariencia. ' +
                  'No digas "aquí tienes la imagen" hasta que el sistema adjunte una nueva. ' +
                  'Disculpate en 1 frase y espera el adjunto real.'
                : '')
          }
          if (imageContextForText) {
            extraSystem = (extraSystem ? extraSystem + '\n\n' : '') + imageContextForText
          }
        } catch {
          /* ignore */
        }
        // Never block the reply on vision re-scan (was adding 30–90s). Background only.
        try {
          void ensureVisualDescriptionFromAvatar({ force: false })
        } catch {
          /* ignore */
        }


      // Vision: analyze user-uploaded images (with optional instructions in text)
      if (hasAtt && attachments?.some((a) => a.mimeType?.startsWith('image/') && a.dataUrl)) {
        try {
          const imgs = attachments.filter((a) => a.dataUrl && a.mimeType?.startsWith('image/'))
          const visionPrompt =
            (trimmed && trimmed !== '📷'
              ? `El usuario envió imagen(es) con esta instrucción: ${trimmed}\n\n`
              : 'El usuario envió imagen(es). ') +
            'Describe con detalle lo que ves (personas, rasgos físicos, ropa, escena). ' +
            'Si parece una foto del usuario, resume su apariencia de forma útil para recordarlo. ' +
            'Si pide editar/generar algo a partir de la foto, indica qué elementos conservar.'

          // Prefer local vision model via Ollama if available
          // Attachments go to the model via message; also leave a strong system hint
          extraSystem =
            (extraSystem ? extraSystem + '\n\n' : '') +
            `[VISION_USUARIO] El usuario adjuntó ${imgs.length} imagen(es). ` +
            visionPrompt +
            ' Las imágenes están en el mensaje del usuario (data URL / adjuntos visibles en UI). ' +
            'Si tienes visión multimodal, analízalas; si no, pide descripción o usa el contexto del chat.'
          if (/\b(yo|mi foto|así soy|asi soy|this is me|soy yo)\b/i.test(trimmed)) {
            extraSystem +=
              ' Parece una foto del usuario: resume rasgos físicos y recuerda apariencia en la conversación.'
          }
        } catch {
          extraSystem =
            (extraSystem ? extraSystem + '\n\n' : '') +
            '[VISION] Imagen adjuntada; descríbela con lo que puedas o pide más detalle si no tienes visión activa.'
        }
      }

      // User appearance memory for the model
      try {
        const appNotes = useSettingsStore.getState().settings.userMemory?.appearanceNotes
        if (appNotes) {
          extraSystem =
            (extraSystem ? extraSystem + '\n\n' : '') +
            `[APARIENCIA_USUARIO] ${appNotes.slice(0, 400)}`
        }
        const scenes = useSettingsStore.getState().settings.userMemory?.avatarScenes
        if (scenes?.length) {
          extraSystem =
            (extraSystem ? extraSystem + '\n\n' : '') +
            `[ESCENAS_AVATAR] Escenas/vestuario ya usados: ${scenes.slice(-6).join(' · ')}`
        }
      } catch { /* ignore */ }


        // Wall-clock gap (persisted createdAt → works after app restart)
        try {
          const msgs = conv?.messages ?? []
          const last = msgs.length ? msgs[msgs.length - 1] : null
          const lastAt =
            last && typeof (last as { createdAt?: number }).createdAt === 'number'
              ? (last as { createdAt: number }).createdAt
              : typeof (conv as { updatedAt?: number } | undefined)?.updatedAt === 'number'
                ? (conv as { updatedAt: number }).updatedAt
                : 0
          const live = useSettingsStore.getState().settings
          const block = buildTimeAwarenessBlock({
            lastMessageAt: lastAt,
            personality: live.character?.personality,
            style: live.character?.style,
            relationshipRole: live.character?.relationshipRole,
            traits: live.character?.traits,
            tagline: live.character?.tagline,
            characterName: live.character?.name
          })
          if (block) {
            extraSystem = (extraSystem ? extraSystem + '\n\n' : '') + block
          }
        } catch {
          /* ignore */
        }

        try {
          const act = useActivityStore.getState()
          const cName = settings.character?.name
          const block = act.extraSystemBlock(cName)
          if (block) {
            extraSystem = (extraSystem ? extraSystem + '\n\n' : '') + block
            if (act.mode === 'adventure') act.noteAdventureMove(trimmed)
          } else if (/\b(aburr|jugamos|juego|ajedrez|aventura|dungeon|dnd)\b/i.test(trimmed)) {
            extraSystem =
              (extraSystem ? extraSystem + '\n\n' : '') +
              '# Actividades disponibles\n' +
              'Si encaja con tu personalidad, sugiere jugar y usa enlaces markdown:\n' +
              '- [Ajedrez visual](kawaii-activity://chess)\n' +
              '- [Aventura](kawaii-activity://adventure)\n' +
              'Tú acompañas al usuario (comentarios, voz si pide). Reglas flexibles.'
          }
        } catch {
          /* ignore */
        }

        // Harness: auto-route local model by task (code / vision / summary / chat)
        let liveSettings = useSettingsStore.getState().settings
        let routeMeta: { task?: string; reason?: string; switched?: boolean } = {}
        try {
          const ar = await applyAutoModelRouting(trimmed, {
            hasImageAttachment: Boolean(hasAtt)
          })
          routeMeta = {
            task: ar.task,
            reason: ar.reason,
            switched: ar.applied
          }
          liveSettings = useSettingsStore.getState().settings
        } catch {
          /* non-fatal */
        }

        await sendChatMessage({
          settings: liveSettings,
          apiKey: apiKey || undefined,
          providerKeys,
          userContent: annotateEmojisForModel(trimmed),
          history,
          previousSummary: convState?.rollingSummary,
          previousSummarySource: convState?.summarySource,
          summaryCoveredCount: convState?.summaryCoveredCount ?? 0,
          signal: controller.signal,
          extraSystem,
          callbacks: {
            onToken: (token) => {
              const current = useChatStore
                .getState()
                .conversations.find((c) => c.id === convId)
                ?.messages.find((m) => m.id === assistantId)
              const prev = current?.content ?? ''
              // Some cloud providers stream cumulative text (full so far), not deltas
              let next: string
              if (
                prev &&
                token.length >= prev.length &&
                (token.startsWith(prev) || token.includes(prev.slice(0, Math.min(48, prev.length))))
              ) {
                next = token
              } else {
                next = prev + token
              }
              updateMessage(convId!, assistantId, {
                content: stripHarnessMarkup(next),
                isStreaming: true
              })
            },
            onRoute: (info) => {
              const prevRoute = routeSnapshot.current
              const modelSwitched = Boolean(
                prevRoute &&
                  (prevRoute.model !== info.model || prevRoute.target !== info.target)
              )
              routeSnapshot.current = info
              setLastRoute(info)
              const modelKey = `${info.model}`
              if (modelKey && !triedRef.current.includes(modelKey)) {
                triedRef.current = [...triedRef.current, modelKey]
              }
              const phase: LivePhase = info.failover ? 'failover' : 'generating'
              setPhase(phase, info)
              // Wipe buffer on failover OR provider/model switch (prevents double text)
              updateMessage(convId!, assistantId, {
                ...((info.failover || modelSwitched) ? { content: '', isStreaming: true } : {}),
                meta: {
                  model: info.model,
                  route: info.target,
                  reason:
                    (routeMeta.switched
                      ? `Auto-modelo [${routeMeta.task}]: ${routeMeta.reason} · `
                      : routeMeta.task
                        ? `Tarea ${routeMeta.task} · `
                        : '') + (info.reason || ''),
                  switchedAt: info.at,
                  failover: info.failover,
                  contextPacked: info.contextPacked,
                  summarySource: info.summarySource,
                  autoRouteTask: routeMeta.task,
                  autoRouteSwitched: routeMeta.switched
                }
              })
            },
            onPhase: (phase) => {
              if (phase === 'summarizing') setPhase('summarizing', routeSnapshot.current)
              if (phase === 'failover') setPhase('failover', routeSnapshot.current)
            },
            onSummary: ({ summary, coveredCount, source }) => {
              setRollingSummary(convId!, summary, coveredCount, source)
            },
            onDone: (meta) => {
              try {
                const cur = useChatStore
                  .getState()
                  .conversations.find((c) => c.id === convId)
                  ?.messages.find((m) => m.id === assistantId)
                syncRelationshipFromTurn(trimmed, cur?.content || '')
              } catch {
                /* ignore */
              }
              useRecoveryStore.getState().markClean()
              if (routeSnapshot.current?.failover) {
                markRemedyWorked('PROVIDER_MODEL_NOT_FOUND', routeSnapshot.current.target)
              }

              // App agent: execute tool tags, clean text, optional second micro-turn
              void (async () => {
                try {
                  const cur = useChatStore
                    .getState()
                    .conversations.find((c) => c.id === convId)
                    ?.messages.find((m) => m.id === assistantId)
                  const raw = cur?.content || ''
                  const { cleanText, actionLog, observations, hadActions, planSummary } =
                    await runActionsFromAssistantText(raw, { userGoal: trimmed })
                  // Natural UX: never dump harness logs into the bubble.
                  // Keep a short placeholder; the follow-up turn is the real answer.
                  const cleaned = stripHarnessMarkup(cleanText)
                  // If tools ran, never leave plan JSON / reasoning noise in the bubble
                  const holding = hadActions
                    ? 'Un momento, estoy revisando eso en la app…'
                    : cleaned.trim()
                  updateMessage(convId!, assistantId, {
                    content: holding,
                    isStreaming: false,
                    meta: {
                      ...(useChatStore
                        .getState()
                        .conversations.find((c) => c.id === convId)
                        ?.messages.find((m) => m.id === assistantId)?.meta || {}),
                      harnessLog: actionLog.slice(0, 12),
                      planSummary: planSummary || undefined
                    }
                  })

                  // Phase A: second turn — natural reply from tool observations
                  if (hadActions && observations.length > 0 && convId) {
                    const wantsStatusOrModels =
                      /\b(estado|status|diagn|revisa|modelos|lista|listar|forge|capas)\b/i.test(
                        trimmed
                      )
                    // Status / model inventory: host formats truth — no second LLM (avoids JSON leaks & bad lists)
                    if (wantsStatusOrModels) {
                      const tags = extractModelTagsFromObservations(observations)
                      const content = formatHostStatusAndModelsReply(observations, tags)
                      updateMessage(convId, assistantId, {
                        content,
                        isStreaming: false,
                        meta: {
                          model: meta.model,
                          provider: meta.provider,
                          latencyMs: meta.latencyMs,
                          route: meta.route?.target,
                          reason: 'Estado/modelos vía harness (host)',
                          harnessLog: actionLog.slice(0, 12),
                          planSummary
                        }
                      })
                      notifyChatReply(content.slice(0, 120))
                      return
                    }
                    const follow = buildToolObservationPrompt(observations, trimmed, planSummary)
                    if (!follow) return
                    setPhase('generating', routeSnapshot.current)
                    // Reuse same bubble when the first was only a placeholder / tags
                    const genericHallucination =
                      /\bModelo\s*[ABC]\b/i.test(cleanText) ||
                      /Nombre del modelo\s*\d/i.test(cleanText) ||
                      /<<<APP_/i.test(cleanText) ||
                      (/\bgroq\b|\bgemini\b|\bopenrouter\b/i.test(cleanText) &&
                        /lista de modelos|modelos (instalados|disponibles)/i.test(trimmed)) ||
                      (/excelente para tareas generales/i.test(cleanText) &&
                        !/qwen|llama|moondream|mistral|gemma/i.test(cleanText))
                    const reuseSame =
                      !cleanText.trim() ||
                      cleanText.trim().length < 80 ||
                      holding.startsWith('Un momento') ||
                      genericHallucination ||
                      observations.some((o) => /Modelos:|list_installed|\bqwen|moondream|llama/i.test(o))
                    const followId = reuseSame
                      ? assistantId
                      : addMessage(convId, {
                          role: 'assistant',
                          content: '',
                          isStreaming: true
                        })
                    if (reuseSame) {
                      updateMessage(convId, assistantId, { content: '', isStreaming: true })
                    }
                    try {
                      let extraSystem2 = ''
                      try {
                        extraSystem2 = await buildAppAgentSystemBlock()
                      } catch {
                        /* ignore */
                      }
                      const liveSettings = useSettingsStore.getState().settings
                      const hist: ChatMessage[] = (
                        useChatStore.getState().conversations.find((c) => c.id === convId)
                          ?.messages ?? []
                      )
                        .filter((m) => m.id !== followId && m.role !== 'system')
                        .slice(-10)
                        .map((m) => ({
                          role: m.role as 'user' | 'assistant',
                          content: m.content
                        }))
                      // Never block the reply on vision re-scan (was adding 30–90s). Background only.
        try {
          void ensureVisualDescriptionFromAvatar({ force: false })
        } catch {
          /* ignore */
        }

        try {
          const act = useActivityStore.getState()
          const cName = settings.character?.name
          const block = act.extraSystemBlock(cName)
          if (block) {
            extraSystem = (extraSystem ? extraSystem + '\n\n' : '') + block
            if (act.mode === 'adventure') act.noteAdventureMove(trimmed)
          } else if (/\b(aburr|jugamos|juego|ajedrez|aventura|dungeon|dnd)\b/i.test(trimmed)) {
            extraSystem =
              (extraSystem ? extraSystem + '\n\n' : '') +
              '# Actividades disponibles\n' +
              'Si encaja con tu personalidad, sugiere jugar y usa enlaces markdown:\n' +
              '- [Ajedrez visual](kawaii-activity://chess)\n' +
              '- [Aventura](kawaii-activity://adventure)\n' +
              'Tú acompañas al usuario (comentarios, voz si pide). Reglas flexibles.'
          }
        } catch {
          /* ignore */
        }

        await sendChatMessage({
                        settings: liveSettings,
                        userContent: follow,
                        history: hist,
                        signal: abortRef.current?.signal,
                        extraSystem: extraSystem2,
                        callbacks: {
                          onToken: (tok) => {
                            const live = useChatStore
                              .getState()
                              .conversations.find((c) => c.id === convId)
                              ?.messages.find((m) => m.id === followId)
                            updateMessage(convId, followId, {
                              content: stripHarnessMarkup((live?.content || '') + tok),
                              isStreaming: true
                            })
                          },
                          onDone: (meta2) => {
                            const liveMsg = useChatStore
                              .getState()
                              .conversations.find((c) => c.id === convId)
                              ?.messages.find((m) => m.id === followId)
                            const prev = liveMsg?.meta
                            let content = stripHarnessMarkup(liveMsg?.content || '')
                            const tags = extractModelTagsFromObservations(observations)
                            if (
                              isHallucinatedModelList(content) ||
                              (tags.length > 0 &&
                                /lista|modelos/i.test(trimmed) &&
                                !tags.some((tag) => content.includes(tag.split(':')[0].slice(0, 6))))
                            ) {
                              content = formatHostModelListReply(
                                tags,
                                useSettingsStore.getState().settings.character?.name
                              )
                            }
                            updateMessage(convId, followId, {
                              content,
                              isStreaming: false,
                              meta: {
                                ...prev,
                                model: meta2.model,
                                provider: meta2.provider,
                                latencyMs: meta2.latencyMs,
                                route: meta2.route.target,
                                reason:
                                  'Seguimiento tras herramientas · ' + (meta2.route.reason || ''),
                                harnessLog: actionLog.slice(0, 12),
                                planSummary: planSummary || prev?.planSummary
                              }
                            })
                          },
                          onError: () => {
                            const live = useChatStore
                              .getState()
                              .conversations.find((c) => c.id === convId)
                              ?.messages.find((m) => m.id === followId)
                            updateMessage(convId, followId, {
                              isStreaming: false,
                              content:
                                live?.content ||
                                'No pude completar el seguimiento tras las acciones.'
                            })
                          }
                        }
                      })
                    } catch {
                      updateMessage(convId, followId, {
                        isStreaming: false,
                        content: 'Seguimiento de herramientas no disponible en este turno.'
                      })
                    }
                  }
                } catch {
                  /* ignore */
                }
              })()

              updateMessage(convId!, assistantId, {
                isStreaming: false,
                meta: {
                  model: meta.model,
                  provider: meta.provider,
                  latencyMs: meta.latencyMs,
                  route: meta.route.target,
                  reason: meta.route.reason,
                  switchedAt: meta.route.at,
                  failover: meta.route.failover,
                  contextPacked: meta.route.contextPacked,
                  summarySource: meta.route.summarySource
                }
              })
              try {
                const doneMsg = useChatStore
                  .getState()
                  .conversations.find((c) => c.id === convId)
                  ?.messages.find((m) => m.id === assistantId)
                const preview = stripHarnessMarkup(doneMsg?.content || '').trim()
                // Skip interim harness / plan noise; host or follow-up will notify when final
                if (
                  preview &&
                  preview.length > 48 &&
                  !/Generando imagen|Preparando motor|Buscando carpetas|Un momento, estoy revisando/i.test(
                    preview
                  ) &&
                  !/"goal"\s*:|<<<APP_/i.test(preview)
                ) {
                  notifyChatReply(preview, { model: meta.model })
                }
              } catch {
                /* ignore */
              }
              setLiveStatus({
                phase: 'done',
                route: meta.route,
                label: labelForPhase('done', meta.route),
                tried: [...triedRef.current]
              })
              // Brief "done" then clear so the bar doesn't stick
              window.setTimeout(() => {
                setLiveStatus((s) => (s?.phase === 'done' ? null : s))
              }, 1200)
            },
            onError: (err) => {
              const code = err instanceof AppError ? err.code : 'UNKNOWN'
              const msg = err instanceof AppError ? err.message : String(err)
              const provider = err instanceof AppError ? err.provider : undefined
              const suggestion = learnFromError({
                code,
                message: msg,
                provider,
                model: routeSnapshot.current?.model
              })
              useRecoveryStore.getState().touch({
                dirty: true,
                lastErrorCode: code,
                lastErrorMessage: msg.slice(0, 200),
                lastRemedy: suggestion.title
              })
              setError(
                err instanceof AppError
                  ? friendlyProviderMessage(err.code, err.message, err.provider)
                  : friendlyProviderMessage('UNKNOWN', String(err))
              )
              setLiveStatus(null)
              const existing =
                useChatStore
                  .getState()
                  .conversations.find((c) => c.id === convId)
                  ?.messages.find((m) => m.id === assistantId)?.content || ''
              const friendly =
                err instanceof AppError
                  ? friendlyProviderMessage(err.code, err.message, err.provider)
                  : friendlyProviderMessage('UNKNOWN', String(err))
              // Only put a short note in the bubble if nothing was streamed
              updateMessage(convId!, assistantId, {
                isStreaming: false,
                content: existing.trim()
                  ? existing
                  : `⚠️ ${friendly}`
              })

              if (settings.autoDiagnoseOnError && window.kawaii) {
                void (async () => {
                  try {
                    const probe = await runNetworkProbe({ timeoutMs: 3500 })
                    const code =
                      err instanceof Error && 'code' in err
                        ? String((err as { code?: string }).code || '')
                        : ''
                    const hint = networkHintForError(
                      probe,
                      code,
                      err instanceof Error ? err.message : String(err)
                    )
                    setError((prev) => `${prev ?? ''} · ${hint}`.trim())
                  } catch {
                    /* ignore probe fail */
                  }
                  const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
                  const report = await runSelfDiagnosis({
                    localBaseUrl: settings.localBaseUrl,
                    localModel: settings.localModel,
                    cloudBaseUrl: settings.cloudBaseUrl,
                    hasCloudKey: Boolean(apiKey),
                    providerMode: settings.providerMode,
                    ollamaStart: () => window.kawaii.ollamaStart(settings.localBaseUrl),
                    imageGenEnabled: settings.imageGenEnabled,
                    imageProviderMode: settings.imageProviderMode,
                    a1111BaseUrl: settings.a1111BaseUrl,
                    cloudflareAccountId: settings.cloudflareAccountId,
                    hasCloudflareToken: Boolean((keys.cloudflare || '').trim()),
                    forgeStart: async () => {
                      const r = await window.kawaii.forgeStart?.()
                      return {
                        ok: Boolean(r && (r as { state?: string }).state !== 'error'),
                        message: (r as { message?: string })?.message,
                        baseUrl: (r as { baseUrl?: string })?.baseUrl
                      }
                    },
                    imageA1111Health: (u?: string) =>
                      window.kawaii.imageA1111Health?.(u) as Promise<{
                        ok: boolean
                        baseUrl?: string
                        error?: string
                      }>,
                    cloudflareProbe: (id: string) =>
                      window.kawaii.imageCloudflareProbe?.(id) as Promise<{
                        ok: boolean
                        error?: string
                      }>
                  })
                  const failed = report.checks.filter((c) => c.status === 'fail')
                  if (failed.length > 0) {
                    setError(
                      (prev) =>
                        `${prev ?? ''} · Diagnóstico: ${failed
                          .map((f) => f.label)
                          .join(', ')}`.trim()
                    )
                  }
                })()
              }
            }
          }
        })
      } catch (err) {
        const appErr = AppError.fromUnknown(err)
        const suggestion = learnFromError({
          code: appErr.code,
          message: appErr.message,
          provider: appErr.provider,
          model: routeSnapshot.current?.model
        })
        useRecoveryStore.getState().touch({
          dirty: true,
          lastErrorCode: appErr.code,
          lastErrorMessage: appErr.message.slice(0, 200),
          lastRemedy: suggestion.title
        })
        {
          const tip = softTipFromLearning()
          const base = friendlyProviderMessage(appErr.code, appErr.message, appErr.provider)
          const dlJobs = Object.values(useDownloadStore.getState().jobs || {})
          const pulling = dlJobs.filter((j) => j.state === 'running')
          const dlTip =
            pulling.length > 0
              ? ` Hay una descarga en curso (${pulling.map((j) => j.model).join(', ')}); la red o Ollama pueden ir justos.`
              : ''
          const text = [base, tip, dlTip].filter(Boolean).join(' · ')
          setError(text)
          setLiveStatus(null)
          updateMessage(convId, assistantId, {
            content: text,
            isStreaming: false,
            meta: {
              model: routeSnapshot.current?.model,
              route: routeSnapshot.current?.target,
              reason: routeSnapshot.current?.reason,
              switchedAt: routeSnapshot.current?.at,
              failover: routeSnapshot.current?.failover,
              isError: true,
              errorCode: appErr.code
            }
          })
        }
      } finally {
        clearLoading()
        abortRef.current = null
        triedRef.current = []
      }
    },
    [
      activeId,
      isLoading,
      settings,
      create,
      addMessage,
      updateMessage,
      getActive,
      setRollingSummary,
      setPhase,
      armLoading,
      clearLoading
    ]
  )

  return {
    isLoading,
    error,
    lastRoute,
    liveStatus,
    clearError: () => setError(null),
    resendMessage: async (assistantMsgId: string) => {
      const conv = getActive()
      if (!conv || isLoading) return
      const idx = conv.messages.findIndex((m) => m.id === assistantMsgId)
      if (idx < 0) return
      // Find preceding user message
      let userContent = ''
      for (let i = idx - 1; i >= 0; i--) {
        if (conv.messages[i].role === 'user') {
          userContent = conv.messages[i].content
          // Remove from user message onward (user + failed assistant)
          deleteMessagesFrom(conv.id, conv.messages[i].id)
          break
        }
      }
      if (!userContent.trim()) return
      await sendMessage(userContent)
    },
    deleteMessage: (msgId: string) => {
      const conv = getActive()
      if (!conv) return
      deleteMessage(conv.id, msgId)
    },
    sendMessage,
    stopStreaming
  }
}