import { notifyChatReply } from '../services/chatNotify'
import { tryChatLocalShortcuts } from '../services/chatLocalShortcuts'
import { planMediaRequestsForTurn } from '../services/chatMediaPlan'
import { musicCapabilityReply, imageCapabilityReply } from '../services/chatCapabilityReplies'
import { runChatMusicFlow } from '../services/chatMusicFlow'
import { isMusicCapabilityQuestion } from '@core/generative/intent'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { type RouteInfo } from '../services/chatOrchestrator'
import { applyNicknameFromUserMessage, applyUserMemoryFromTurn } from '../services/chatSendPhases'
import { runChatOrchestrationTurn } from '../services/runChatOrchestrationTurn'
import { bumpTurns } from '@core/conversation/relationship-confidence'
import { useRecoveryStore } from '@shared/lib/stores/recoveryStore'
import {
  labelForPhase,
  type LivePhase,
  type LiveStatus
} from '../components/RouteLiveIndicator'
import { tryHandleHostOwnedChat } from '../services/hostChatPaths'
import { setBackgroundSummaryBusy } from '../services/backgroundSummary'
import { isNonImageOperationalCommand } from '@core/generative/image-revision'

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

  const armLoading = useCallback((watchdogMs?: number) => {
    inFlightRef.current = true
    setIsLoading(true)
    if (loadWatchdogRef.current) clearTimeout(loadWatchdogRef.current)
    // Default 4 min; image/I2 FaceID can pass up to ~10 min
    const ms = Math.min(900_000, Math.max(60_000, watchdogMs ?? 240_000))
    loadWatchdogRef.current = setTimeout(() => {
      if (inFlightRef.current) {
        console.warn('[useChat] loading watchdog fired — unlocking input', ms)
        abortRef.current?.abort()
        abortRef.current = null
        clearLoading()
        setLiveStatus(null)
        setError((e) => e || 'La operación tardó demasiado y se liberó el chat.')
      }
    }, ms)
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



      
      // Phase 1: local shortcuts (no LLM)
      if (
        await tryChatLocalShortcuts(trimmed, hasAtt, attachments, {
          activeId,
          create,
          addMessage,
          updateMessage
        })
      ) {
        return
      }

      // Phase 2: nicknames / preferred name
      applyNicknameFromUserMessage(trimmed)

      // Phase 3: host-owned paths (status / tools) — no cloud LLM
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


      // Phase 4: clear recovery banner from prior turns
      try {
        useRecoveryStore.getState().markClean()
      } catch {
        /* */
      }

      // Multi-layer generative (fail-soft) — plan in chatMediaPlan (E-USECHAT-2)
      const planned = planMediaRequestsForTurn(trimmed, settings, activeId)
      let mediaRequests = planned.mediaRequests
      let imageOn = planned.imageOn
      let imageMode = planned.imageMode
      let imageContextForText = planned.imageContextForText

      // Music capability question (no generation job)
      if (
        mediaRequests.length === 0 &&
        isMusicCapabilityQuestion(trimmed)
      ) {
        let convId = activeId
        if (!convId) convId = create()
        addMessage(convId, { role: 'user', content: trimmed || '📷', attachments: hasAtt ? attachments : undefined })
      try {
        const rel = useSettingsStore.getState().settings.relationshipState
        useSettingsStore.getState().update({
          relationshipState: bumpTurns(rel, 1)
        })
      } catch { /* */ }
        const liveM = useSettingsStore.getState().settings
        const reply = musicCapabilityReply(liveM.musicGenEnabled === true)
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

      const lowerQ = trimmed.toLowerCase()
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
        const reply = imageCapabilityReply(
          settings.imageGenEnabled !== false,
          settings.imageProviderMode || 'off'
        )
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
          await runChatMusicFlow({
            trimmed,
            hasAtt,
            attachments,
            activeId,
            create,
            addMessage,
            updateMessage,
            armLoading,
            clearLoading,
            setError,
            setPhase: (phase) => setPhase(phase as never, null),
            musicGenEnabled: settings.musicGenEnabled === true,
            req: {
              prompt: req.prompt,
              stylePrompt: req.stylePrompt,
              lyrics: (req as { lyrics?: string }).lyrics
            }
          })
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
      // Phase 5: user memory + onboarding + relationship
      applyUserMemoryFromTurn(trimmed)
      const assistantId = addMessage(convId, {
        role: 'assistant',
        content: '',
        isStreaming: true
      })

      // Phase 6: LLM orchestration (stream, memory finalize, errors)
      await runChatOrchestrationTurn({
        convId: convId!,
        assistantId,
        trimmed,
        hasAtt,
        attachments,
        hasMediaJob: Boolean(hasMediaJob),
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
      })
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