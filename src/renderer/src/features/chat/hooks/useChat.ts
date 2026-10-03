import { notifyUser } from '@shared/lib/notify'
import { isMusicCapabilityQuestion } from '@core/generative/intent'
import {
  parseInitiativeSnooze,
  annotateEmojisForModel,
  buildTimeAwarenessBlock
} from '@core/conversation/initiative'
import { safePlanGenerativeTurn } from '@core/generative'
import { detectGenerativeIntent } from '@core/generative/intent'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { sendChatMessage, type RouteInfo } from '../services/chatOrchestrator'
import { AppError, friendlyProviderMessage } from '@core/errors'
import { buildDocumentsBlock } from '@core/chat/document-attach'
import {
  learnFromError,
  markRemedyWorked,
  softTipFromLearning
} from '@core/diagnostics/mini-brain'
import {
  looksLikeFeedbackReportRequest,
  looksLikeFeedbackExplainRequest,
  feedbackStatsIncludingArchives,
  buildFeedbackDiagnosticBundle,
  classifyClearDataIntent,
  clearFeedbackArchivesOnly,
  clearFeedbackReports,
  archiveActiveAfterExport
} from '@core/feedback'
import {
  extractExplicitNickname,
  looksLikeNicknameAccept,
  looksLikeNicknameReject
} from '@core/conversation/user-memory'
import { APP_VERSION } from '../../../../../shared/version'
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
  extractModelTagsFromObservations,
  formatHostModelListReply,
  formatHostStatusAndModelsReply,
  isHallucinatedModelList
} from '../services/appAgent'
import { tryHandleHostOwnedChat } from '../services/hostChatPaths'
import { runPostReplyHarness } from '../services/postReplyHarness'
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
  isNonImageOperationalCommand,
  looksLikeIdentityReject
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

  // Plugins panel → execute host tools
  useEffect(() => {
    const h = async (ev: Event) => {
      const detail = (ev as CustomEvent<{ tools?: string[]; phrase?: string }>).detail
      const tools = detail?.tools || []
      if (!tools.length) return
      const convId = useChatStore.getState().activeId || useChatStore.getState().create()
      const phrase = detail?.phrase || tools.join(', ')
      addMessage(convId, { role: 'user', content: phrase })
      const assistantId = addMessage(convId, {
        role: 'assistant',
        content: 'Ejecutando: ' + tools.join(' → ') + '…',
        isStreaming: true,
        meta: { kind: 'harness-activity', route: 'local' }
      })
      try {
        const { executeAppTool } = await import('../services/appAgent')
        const lines: string[] = []
        const observations: string[] = []
        for (const tool of tools.slice(0, 6)) {
          const name = String(tool)
          const args: Record<string, unknown> = {}
          if (/web_search|search/i.test(name)) {
            args.query =
              phrase && !/ejecutar|plugin/i.test(phrase) ? phrase : 'estado actual'
            args.max_results = 5
          }
          const toolId = name === 'web_search' ? 'web_search' : name
          const r = await executeAppTool({
            tool: toolId as import('@core/agent').AppToolName,
            args
          })
          lines.push((r.ok ? '✓ ' : '✗ ') + toolId + ': ' + (r.summary || '').slice(0, 400))
          observations.push(
            JSON.stringify({
              tool: toolId,
              ok: r.ok,
              summary: (r.summary || '').slice(0, 500)
            })
          )
        }
        let body = lines.join(String.fromCharCode(10))
        try {
          const mod = await import('@core/agent/humanize-host-reply')
          const humanize = (mod as { humanizeHostObservations?: (o: string[]) => string })
            .humanizeHostObservations
          if (typeof humanize === 'function' && observations.length) {
            const human = humanize(observations)
            if (human && String(human).trim().length > 20) {
              body = String(human).trim() + String.fromCharCode(10, 10) + '---' + String.fromCharCode(10) + body
            }
          }
        } catch {
          /* keep ticks */
        }
        updateMessage(convId, assistantId, {
          content: body || 'Listo.',
          isStreaming: false,
          meta: {
            route: 'local',
            kind: 'harness-activity',
            model: 'harness-host',
            tools: tools.slice(0, 6),
            source: 'plugins-panel'
          }
        })
      } catch (e) {
        updateMessage(convId, assistantId, {
          content: 'Error: ' + (e instanceof Error ? e.message : String(e)),
          isStreaming: false,
          meta: { isError: true }
        })
      }
    }
    window.addEventListener('kawaii:run-host-tools', h)
    return () => window.removeEventListener('kawaii:run-host-tools', h)
  }, [addMessage, updateMessage])

  const sendMessage = useCallback(
    async (content: string, attachments?: import('@core/conversation').Attachment[]) => {
      const trimmed = content.trim()
      const hasAtt = !!(attachments && attachments.length)
      if ((!trimmed && !hasAtt) || inFlightRef.current) return



      // Limpieza diferenciada: exports en disco vs archivos vs activos (tests)
      {
        const clearIntent = classifyClearDataIntent(trimmed)
        if (clearIntent !== 'none') {
          let convId = activeId
          if (!convId) convId = create()
          addMessage(convId, { role: 'user', content: trimmed })
          const assistantId = addMessage(convId, {
            role: 'assistant',
            content: 'Limpiando…',
            isStreaming: true
          })
          try {
            const parts: string[] = []
            if (clearIntent === 'exports_only' || clearIntent === 'feedback_all') {
              const r = await window.kawaii?.diagnosticsClearExports?.()
              parts.push(
                `Archivos exportados en disco: **${r?.removed ?? 0}** eliminados` +
                  (r?.dir ? ` (\`${r.dir}\`)` : '')
              )
            }
            if (clearIntent === 'feedback_archives' || clearIntent === 'feedback_all') {
              const n = clearFeedbackArchivesOnly()
              parts.push(`Archivos de feedback (localStorage): **${n}** lote(s) borrados`)
            }
            if (clearIntent === 'feedback_active' || clearIntent === 'feedback_all') {
              clearFeedbackReports()
              parts.push('Likes/dislikes **activos** del chat: vaciados')
            }
            const hint =
              clearIntent === 'exports_only'
                ? '\n\n_Solo toqué informes en disco. Los 👍/👎 del chat siguen activos._'
                : clearIntent === 'feedback_archives'
                  ? '\n\n_Solo archivos. Los likes activos del chat se mantienen (los tests ya no verán lotes viejos)._'
                  : clearIntent === 'feedback_active'
                    ? '\n\n_Solo activos. Archivos e informes en disco no se tocaron._'
                    : '\n\n_Limpieza completa: disco + archivos + activos._'
            updateMessage(convId, assistantId, {
              content: parts.join('\n') + hint,
              isStreaming: false,
              meta: { route: 'diagnostics', reason: `clear:${clearIntent}` }
            })
          } catch (e) {
            updateMessage(convId, assistantId, {
              content: `No pude limpiar: ${e instanceof Error ? e.message : String(e)}`,
              isStreaming: false,
              meta: { isError: true }
            })
          }
          return
        }
      }



      // Apodos / nombre preferido (memoria)
      try {
        const nick = extractExplicitNickname(trimmed)
        if (nick) {
          const mem = useSettingsStore.getState().settings.userMemory || { facts: [] }
          const nicks = Array.isArray(mem.nicknames) ? [...mem.nicknames] : []
          if (!nicks.map((x) => x.toLowerCase()).includes(nick.toLowerCase())) nicks.push(nick)
          useSettingsStore.getState().update({
            userMemory: {
              ...mem,
              preferredName: mem.preferredName || nick,
              nicknames: nicks.slice(0, 12),
              pendingNickname: undefined,
              updatedAt: Date.now()
            }
          })
        } else if (looksLikeNicknameAccept(trimmed)) {
          const mem = useSettingsStore.getState().settings.userMemory || { facts: [] }
          const pend = mem.pendingNickname
          if (pend) {
            const nicks = Array.isArray(mem.nicknames) ? [...mem.nicknames] : []
            if (!nicks.map((x) => x.toLowerCase()).includes(pend.toLowerCase())) nicks.push(pend)
            useSettingsStore.getState().update({
              userMemory: {
                ...mem,
                preferredName: mem.preferredName || pend,
                nicknames: nicks.slice(0, 12),
                pendingNickname: undefined,
                updatedAt: Date.now()
              }
            })
          }
        } else if (looksLikeNicknameReject(trimmed)) {
          const mem = useSettingsStore.getState().settings.userMemory || { facts: [] }
          if (mem.pendingNickname) {
            useSettingsStore.getState().update({
              userMemory: { ...mem, pendingNickname: undefined, updatedAt: Date.now() }
            })
          }
        }
      } catch {
        /* */
      }

      // Qué son los likes (host, sin LLM)
      if (trimmed && looksLikeFeedbackExplainRequest(trimmed)) {
        let convId = activeId
        if (!convId) convId = create()
        addMessage(convId, { role: 'user', content: trimmed })
        const stats = feedbackStatsIncludingArchives()
        const content =
          'Los **likes (👍)** y **dislikes (👎)** de esta app no son «comentarios del chat»: son valoraciones sobre mis respuestas o imágenes.\n\n' +
          '- 👍 = te gustó (texto o foto); las fotos con like se guardan como referencia de identidad.\n' +
          '- 👎 = no te convenció; ayuda a ajustar estilo o a regenerar.\n' +
          '- Puedes pedir un **resumen / informe** de likes y dislikes cuando quieras.\n\n' +
          `Ahora mismo: **${stats.likes}** likes · **${stats.dislikes}** dislikes` +
          (stats.imageDislikes ? ` (imágenes 👎: ${stats.imageDislikes})` : '') +
          '.'
        addMessage(convId, {
          role: 'assistant',
          content,
          isStreaming: false,
          meta: { route: 'diagnostics', reason: 'feedback-explain' }
        })
        return
      }

      // Informe de likes/dislikes + rutas de logs
      if (trimmed && looksLikeFeedbackReportRequest(trimmed)) {
        let convId = activeId
        if (!convId) convId = create()
        addMessage(convId, { role: 'user', content: trimmed })
        const assistantId = addMessage(convId, {
          role: 'assistant',
          content: 'Preparando informe de comentarios…',
          isStreaming: true
        })
        try {
          let paths: Array<{ id: string; label: string; path: string }> = []
          try {
            const r = await window.kawaii?.diagnosticsListPaths?.()
            if (r?.ok && Array.isArray(r.paths)) paths = r.paths
          } catch {
            /* */
          }
          const content = buildFeedbackDiagnosticBundle({
            limit: 120,
            appVersion: APP_VERSION,
            userDataPaths: paths
          })
          let saved = ''
          try {
            const w = await window.kawaii?.diagnosticsWriteTextFile?.({
              fileName: `informe-feedback-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`,
              content,
              subdir: 'diagnostics'
            })
            if (w?.ok && w.filePath) {
              saved = w.filePath
              try {
                await window.kawaii?.filesOpenPath?.(w.dir || w.filePath)
              } catch {
                /* */
              }
              // Mover activos a archivo: el informe ya está en disco; tests no mezclan sesión vieja
              try {
                archiveActiveAfterExport('export-informe-chat')
              } catch {
                /* */
              }
            }
          } catch {
            /* */
          }
          const pathBlock =
            paths.length > 0
              ? '\n\n**Rutas de datos / logs:**\n' +
                paths.map((p) => `- **${p.label}:** \`${p.path}\``).join('\n')
              : ''
          updateMessage(convId, assistantId, {
            content:
              `Listo. Informe de 👍/👎 generado.` +
              (saved ? `\n\n**Archivo:** \`${saved}\`` : '') +
              pathBlock +
              '\n\n_También puedes copiar el contenido desde localStorage `kawaii-gpt-feedback-v1`._' +
              '\n\n---\n\n' +
              content.slice(0, 6000) +
              (content.length > 6000 ? '\n\n…(truncado en chat; el archivo tiene el completo)' : ''),
            isStreaming: false,
            meta: { route: 'diagnostics', reason: 'feedback-report' }
          })
        } catch (e) {
          updateMessage(convId, assistantId, {
            content: `No pude generar el informe: ${e instanceof Error ? e.message : String(e)}`,
            isStreaming: false,
            meta: { isError: true }
          })
        }
        return
      }

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

      // Host-owned paths (status / tools) — no cloud LLM
      if (
        await tryHandleHostOwnedChat(trimmed, hasAtt, {
          activeId,
          create,
          addMessage,
          updateMessage,
          setIsLoading,
          setError,
          setLiveStatus,
          inFlightRef,
          notifyChatReply: (preview) => notifyChatReply(preview)
        })
      ) {
        return
      }


      // Nueva interacción: no arrastrar banner de recuperación de turnos previos
      try {
        useRecoveryStore.getState().markClean()
      } catch {
        /* */
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

      // Never treat rename/status/logs as image generation
      if (isNonImageOperationalCommand(trimmed)) {
        mediaRequests = []
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
            const { runChatImageFlow } = await import('../services/chatImageFlow')
            await runChatImageFlow({
              trimmed,
              req,
              hasAtt,
              attachments,
              activeId,
              create,
              addMessage,
              updateMessage,
              armLoading,
              clearLoading,
              setError,
              setLiveStatus,
              getTried: () => triedRef.current
            })
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