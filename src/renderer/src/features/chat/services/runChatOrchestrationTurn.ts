/**
 * P1 residual — chat LLM turn (history, stream, onDone, errors).
 * Extracted from useChat.sendMessage so the hook only sequences phases.
 */
import type { MutableRefObject } from 'react'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { sendChatMessage, type RouteInfo } from './chatOrchestrator'
import { AppError, friendlyProviderMessage } from '@core/errors'
import { buildDocumentsBlock } from '@core/chat/document-attach'
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
import type { LivePhase, LiveStatus } from '../components/RouteLiveIndicator'
import {
  buildAppAgentSystemBlock,
  runActionsFromAssistantText,
  buildToolObservationPrompt,
  applyAutoModelRouting,
  extractModelTagsFromObservations,
  formatHostModelListReply,
  formatHostStatusAndModelsReply,
  isHallucinatedModelList
} from './appAgent'
import { runPostReplyHarness } from './postReplyHarness'
import { finalizeCompletedAssistantReply } from './postReplyFinalize'
import { stripHarnessMarkup } from '@core/agent'
import { mergeStreamToken, stripWhileStreaming } from './chatPostProcess'
import { globalCircuitBreaker } from '@core/resilience'
import { ensureVisualDescriptionFromAvatar } from '@features/settings/ensureVisualDescription'
import { setBackgroundSummaryBusy } from './backgroundSummary'
import { useActivityStore } from '@shared/lib/stores/activityStore'
import { looksLikeIdentityReject } from '@core/generative/image-revision'
import { notifyChatReply } from './chatNotify'
import { annotateEmojisForModel, buildTimeAwarenessBlock } from '@core/conversation/initiative'

export type ChatOrchestrationTurnCtx = {
  convId: string
  assistantId: string
  trimmed: string
  hasAtt: boolean
  attachments?: import('@core/conversation').Attachment[]
  hasMediaJob: boolean
  imageContextForText?: string | null
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
  abortRef: MutableRefObject<AbortController | null>
  triedRef: MutableRefObject<string[]>
  armLoading: (watchdogMs?: number) => void
  clearLoading: () => void
  setError: (v: string | null | ((prev: string | null) => string | null)) => void
  setLiveStatus: (v: LiveStatus | null | ((prev: LiveStatus | null) => LiveStatus | null)) => void
  setLastRoute: (info: RouteInfo | null) => void
  setPhase: (phase: LivePhase, route?: RouteInfo | null) => void
  getActive: () => ReturnType<typeof useChatStore.getState>['conversations'][number] | undefined
  updateMessage: (convId: string, msgId: string, patch: Record<string, unknown>) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addMessage: (convId: string, msg: any) => string
  deleteMessage: (convId: string, msgId: string) => void
  setRollingSummary: (
    convId: string,
    summary: string,
    coveredCount: number,
    source: 'model' | 'heuristic'
  ) => void
}

export async function runChatOrchestrationTurn(ctx: ChatOrchestrationTurnCtx): Promise<void> {
  const {
    convId,
    assistantId,
    trimmed,
    hasAtt,
    attachments,
    hasMediaJob,
    imageContextForText,
    settings,
    abortRef,
    triedRef,
    armLoading,
    clearLoading,
    setError,
    setLiveStatus,
    setLastRoute,
    setPhase,
    getActive,
    updateMessage,
    addMessage,
    deleteMessage,
    setRollingSummary
  } = ctx

  try {
    globalCircuitBreaker.recordSuccess('local-openai')
    globalCircuitBreaker.recordSuccess('ollama')
  } catch {
    /* */
  }
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


    // Vision: analyze user-uploaded images (optional text + avatar identity compare)
    if (hasAtt && attachments?.some((a) => a.mimeType?.startsWith('image/') && a.dataUrl)) {
      try {
        const { buildVisionSystemHint } = await import('@core/chat/vision-attach')
        const imgs = attachments.filter((a) => a.dataUrl && a.mimeType?.startsWith('image/'))
        const char = useSettingsStore.getState().settings.character
        const gal = (char?.visualGallery || []) as Array<{
          label?: string
          scene?: string
          dataUrl?: string
        }>
        const primaryUrl = (char as { visualImageUrl?: string })?.visualImageUrl
        const galleryRefs = [
          ...(primaryUrl
            ? [{ label: 'Principal (chat)', scene: 'avatar principal', primary: true as const }]
            : []),
          ...gal.map((g) => ({
            label: g.label,
            scene: g.scene,
            primary: false as const
          }))
        ]
        const hint = buildVisionSystemHint({
          trimmed,
          imageCount: imgs.length,
          characterName: char?.name,
          visualDescription: char?.visualDescription,
          hasAvatar: Boolean(primaryUrl || gal.length),
          galleryRefs
        })
        extraSystem = (extraSystem ? extraSystem + '\n\n' : '') + hint
      } catch {
        extraSystem =
          (extraSystem ? extraSystem + '\n\n' : '') +
          '[VISION] Imagen adjuntada; descríbela con lo que puedas o pide más detalle si no tienes visión activa.'
      }
    }

    // Text / code documents for local/cloud models
    try {
      const docBlock = buildDocumentsBlock(attachments)
      if (docBlock) {
        extraSystem = (extraSystem ? extraSystem + '\n\n' : '') + docBlock
      }
    } catch {
      /* ignore */
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
        // Show capability routing reason immediately (before first token)
        setPhase('generating', {
          target: 'local',
          model: (liveSettings.localModel || '').trim() || 'local',
          reason: ar.reason || '',
          at: Date.now()
        })
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
            try {
              setError(null)
            } catch {
              /* ignore */
            }
            const current = useChatStore
              .getState()
              .conversations.find((c) => c.id === convId)
              ?.messages.find((m) => m.id === assistantId)
            const prev = current?.content ?? ''
            const next = mergeStreamToken(prev, String(token || ''))
            if (!next || next === prev) return
            updateMessage(convId!, assistantId, {
              content: stripWhileStreaming(next),
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
                  (routeMeta.reason
                    ? `Auto [${routeMeta.task || 'chat'}]: ${routeMeta.reason}`
                    : routeMeta.task
                      ? `Tarea ${routeMeta.task}`
                      : '') +
                  (info.reason
                    ? (routeMeta.reason ? ' · ' : '') + info.reason
                    : ''),
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
            if (phase === 'searching') setPhase('searching', routeSnapshot.current)
            if (phase === 'summarizing') setPhase('summarizing', routeSnapshot.current)
            if (phase === 'failover') setPhase('failover', routeSnapshot.current)
          },
          onSummary: ({ summary, coveredCount, source }) => {
            setRollingSummary(convId!, summary, coveredCount, source)
          },
          onDone: (meta) => {
            // B0: always visible — proves onDone ran (DevTools + terminal)
            console.warn('[kawaii-memory] onDone', {
              contentLen: String(meta?.content || '').length,
              model: meta?.model,
              provider: meta?.provider
            })
            // Display finalize + assistant memory (modular)
            try {
              finalizeCompletedAssistantReply({
                convId: convId!,
                assistantId,
                userText: trimmed,
                orchestratorContent: meta?.content,
                finishReason: meta?.finishReason,
                limited: meta?.limited
              })
            } catch (e) {
              console.warn('[kawaii-memory] finalize failed', e)
            }
            // Success: clear sticky local-error banners from prior throws
            try {
              setError(null)
              setLiveStatus(null)
            } catch {
              /* ignore */
            }
            try {
              useRecoveryStore.getState().markClean()
            } catch {
              /* ignore */
            }
            if (routeSnapshot.current?.failover) {
              markRemedyWorked('PROVIDER_MODEL_NOT_FOUND', routeSnapshot.current.target)
            }

            // App agent: host harness (extracted module)
            void runPostReplyHarness({
              convId: convId!,
              assistantId,
              trimmed,
              meta: {
                model: meta.model,
                provider: meta.provider,
                latencyMs: meta.latencyMs,
                route: meta.route
              },
              addMessage,
              updateMessage,
              deleteMessage,
              notifyChatReply,
              setPhase: setPhase as never,
              annotateEmojisForModel,
              apiKey: apiKey || undefined,
              providerKeys
            })


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
                summarySource: meta.route.summarySource,
                useWebSearch: Boolean(meta.route.useWebSearch),
                webHitCount:
                  typeof meta.route.webHitCount === 'number'
                    ? meta.route.webHitCount
                    : meta.route.useWebSearch ||
                        /web/i.test(meta.route.reason || '') ||
                        /web/i.test(String(meta.route.target || ''))
                      ? 0
                      : undefined,
                webSources: meta.route.webSources,
                webSearchAttempted: Boolean(
                  meta.route.useWebSearch ||
                    typeof meta.route.webHitCount === 'number' ||
                    /\bweb\b/i.test(meta.route.reason || '')
                )
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
                !/Creando imagen|Preparando motor|Buscando carpetas|Un momento, estoy revisando/i.test(
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
            const hasReply =
              existing.trim().length > 24 &&
              !/^⚠/.test(existing.trim()) &&
              !/El modelo local no respondió/i.test(existing)
            setError(hasReply ? null : friendly)
            updateMessage(convId!, assistantId, {
              isStreaming: false,
              content: hasReply ? existing : ('⚠️ ' + friendly),
              meta: {
                isError: !hasReply,
                errorCode: hasReply
                  ? undefined
                  : err instanceof AppError
                    ? err.code
                    : 'UNKNOWN'
              }
            })

            if (!hasReply && settings.autoDiagnoseOnError && window.kawaii) {
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
                  // Only surface network hints when probe is NOT healthy and no reply
                  if (!hasReply && probe && probe.level !== 'online') {
                    setError((prev) => `${prev ?? ''} · ${hint}`.trim())
                  }
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
                // Skip image-only failures on local chat errors (Cloudflare FLUX noise)
                const failed = report.checks.filter((c) => {
                  if (c.status !== 'fail') return false
                  const lab = String(c.label || '')
                  if (/cloudflare|flux|pollinations|forge|imagen/i.test(lab)) return false
                  return true
                })
                if (!hasReply && failed.length > 0) {
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
        let base = friendlyProviderMessage(appErr.code, appErr.message, appErr.provider)
        // Light hint only — never run full harness (Forge/FaceID) on chat errors (freezes UI)
        try {
          if (
            appErr.code === 'PROVIDER_MODEL_NOT_FOUND' ||
            appErr.code === 'PROVIDER_TIMEOUT'
          ) {
            const p = String(appErr.provider || '')
            if (/local-openai|openai/i.test(p)) {
              base +=
                '\n\n_LM Studio: carga el modelo en la app (o JIT) y deja Developer → Server en marcha. El primer mensaje puede tardar 1–3 min._'
            } else if (/ollama/i.test(p)) {
              base +=
                '\n\n_Ollama: `ollama list` debe mostrar el tag exacto; si no, `ollama pull <tag>`._'
            }
          }
        } catch {
          /* optional */
        }
        const dlJobs = Object.values(useDownloadStore.getState().jobs || {})
        const pulling = dlJobs.filter((j) => j.state === 'running')
        const dlTip =
          pulling.length > 0
            ? ` Hay una descarga en curso (${pulling.map((j) => j.model).join(', ')}); la red o Ollama pueden ir justos.`
            : ''
        const text = [base, tip, dlTip].filter(Boolean).join(' · ')
        setLiveStatus(null)
        const existing =
          useChatStore
            .getState()
            .conversations.find((c) => c.id === convId)
            ?.messages.find((m) => m.id === assistantId)?.content || ''
        const keep =
          existing.trim().length > 24 &&
          !/El modelo local no respondió/i.test(existing) &&
          !/^⚠/.test(existing.trim())
        if (keep) {
          setError(null)
          updateMessage(convId, assistantId, {
            content: existing,
            isStreaming: false,
            meta: {
              model: routeSnapshot.current?.model,
              route: routeSnapshot.current?.target,
              reason: routeSnapshot.current?.reason,
              switchedAt: routeSnapshot.current?.at,
              failover: routeSnapshot.current?.failover,
              isError: false
            }
          })
        } else {
          setError(text)
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
      }
    } finally {
      clearLoading()
      abortRef.current = null
      triedRef.current = []
    }

}
