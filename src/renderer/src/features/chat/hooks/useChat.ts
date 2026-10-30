import { setChatBusy, markDocReadingActive } from '../services/chatBusy'
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
  const continueWritingRef = useRef<((id: string) => Promise<void>) | null>(null)
  const loadWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)


  const clearStuckStreaming = useCallback(() => {
    try {
      const st = useChatStore.getState()
      for (const c of st.conversations || []) {
        for (const m of c.messages || []) {
          if (m.isStreaming) {
            st.updateMessage(c.id, m.id, {
              isStreaming: false,
              meta: {
                ...((m.meta || {}) as object),
                streamStale: true
              }
            })
          }
        }
      }
    } catch {
      /* */
    }
  }, [])

  const clearLoading = useCallback(() => {
    inFlightRef.current = false
    setIsLoading(false)
    setBackgroundSummaryBusy(false)
    try {
      setChatBusy(false)
    } catch {
      /* */
    }
    // Stop Forge/SD if a chat image job was left running (cancel from UI)
    try {
      void window.kawaii?.imageCancel?.()
      void window.kawaii?.imageForceUnlock?.()
    } catch {
      /* */
    }
    if (loadWatchdogRef.current) {
      clearTimeout(loadWatchdogRef.current)
      loadWatchdogRef.current = null
    }
    // Clear stale "Generando…" on finished bubbles
    try {
      const st = useChatStore.getState()
      for (const c of st.conversations || []) {
        for (const m of c.messages || []) {
          if (m.isStreaming) {
            st.updateMessage(c.id, m.id, { isStreaming: false })
          }
        }
      }
    } catch {
      /* */
    }
    try {
      setLiveStatus(null)
    } catch {
      /* */
    }
  }, [])

  const armLoading = useCallback((watchdogMs?: number) => {
    inFlightRef.current = true
    setIsLoading(true)
    try {
      setChatBusy(true)
    } catch {
      /* */
    }
    // Only the newest assistant bubble may stay streaming; clear orphans
    try {
      const st = useChatStore.getState()
      const active = st.getActive?.() || st.conversations.find((c) => c.id === st.activeId)
      if (active) {
        const msgs = active.messages || []
        // Keep last assistant streaming if any; clear the rest
        let kept = false
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m.isStreaming) {
            if (!kept && m.role === 'assistant') {
              kept = true
              continue
            }
            st.updateMessage(active.id, m.id, { isStreaming: false })
          }
        }
      }
    } catch {
      /* */
    }
    if (loadWatchdogRef.current) clearTimeout(loadWatchdogRef.current)
    // Local 26B can need 10–15+ min (prefill + long companion reply). Do not abort LMS early.
    const settingsNow = useSettingsStore.getState().settings
    // Gemma 26B long RP: do not unlock mid-generation (was causing "restart" + orphan LMS jobs)
    const localDefault = Math.max(
      Number(settingsNow.localTimeoutMs) || 1_200_000,
      1_200_000
    )
    const ms = Math.min(
      1_800_000, // 30 min hard cap
      Math.max(300_000, watchdogMs ?? localDefault)
    )
    loadWatchdogRef.current = setTimeout(() => {
      if (inFlightRef.current) {
        // Unlock INPUT only — never abort LMS stream or wipe isStreaming while tokens may still arrive.
        console.warn('[useChat] loading watchdog fired — unlock input (stream continues)', ms)
        setIsLoading(false)
        try {
          setChatBusy(false)
        } catch {
          /* */
        }
        setError(
          (e) =>
            e ||
            'La generación sigue en curso (modelo grande). Puedes esperar o pulsar Detener. Si quedó a medias, usa Continuar escribiendo.'
        )
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
    clearStuckStreaming()
    setLiveStatus(null)
    triedRef.current = []
    // Pause auto document reading (user interrupted)
    try {
      const id = useChatStore.getState().activeId
      if (id) {
        sessionStorage.setItem('kawaii-doc-auto-chain:' + id, '0')
        sessionStorage.setItem('kawaii-doc-auto-paused:' + id, '1')
      }
    } catch {
      /* */
    }
  }, [clearLoading, clearStuckStreaming])


  // Recover UI after OS sleep / long inactivity with stuck isStreaming
  useEffect(() => {
    const recover = () => {
      try {
        const st = useChatStore.getState()
        const any = (st.conversations || []).some((c) =>
          (c.messages || []).some((m) => m.isStreaming)
        )
        if (any && !inFlightRef.current) {
          clearStuckStreaming()
        }
      } catch {
        /* */
      }
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') recover()
    }
    window.addEventListener('focus', recover)
    document.addEventListener('visibilitychange', onVis)
    const t = window.setInterval(recover, 120_000)
    return () => {
      window.removeEventListener('focus', recover)
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(t)
    }
  }, [clearStuckStreaming])

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
    async (
      content: string,
      attachments?: import('@core/conversation').Attachment[],
      opts?: { meta?: Record<string, unknown> }
    ) => {
      const trimmed = content.trim()
      const hasAtt = !!(attachments && attachments.length)
      const userMeta = opts?.meta
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
        // Strict: avoid false positives in RP/chat
        // e.g. «Busco dónde sentarme… ver lo que…» used to match dónde+ver.
        const wantsOpenFolder =
          /\b(abre|abrir|open)\b/i.test(trimmed) &&
          /\b(carpeta|folder|directorio)\b/i.test(trimmed) &&
          /\b(m[uú]sica|music|ace|imagen|im[aá]genes|foto|fotos|archivo|archivos|descarga|upload|backup|respaldo|forge|sd|app|kawaii|datos)\b/i.test(
            trimmed
          )
        const wantsWhereFiles =
          (/\b(d[oó]nde|donde)\s+(est[aá]n|est[aá]|quedo|quedan|guardo|guard[eé]|guardo|guarda|pongo|dejo)\b/i.test(
            trimmed
          ) &&
            /\b(archivo|archivos|m[uú]sica|cancion|canción|pista|pistas|imagen|im[aá]genes|foto|fotos|carpeta|folder|descarga|descargas|generad[oa]s?|adjunto|adjuntos|backup|respaldo)\b/i.test(
              trimmed
            )) ||
          /\b(m[uú]sica generada|ver la m[uú]sica|d[oó]nde\s+(est[aá]n?|quedo)\s+.*(m[uú]sica|archivo|imagen|foto|carpeta))\b/i.test(
            trimmed
          ) ||
          (/\b(muestra|lista|ense[nñ]a)\b/i.test(trimmed) &&
            /\b(carpetas?\s+de\s+la\s+app|carpetas?\s+de\s+kawaii|dirs?\s+conocid)\b/i.test(trimmed))
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

      addMessage(convId, {
        role: 'user',
        content: trimmed || '📷',
        attachments: hasAtt ? attachments : undefined,
        ...(userMeta ? { meta: userMeta } : {})
      })
      // Phase 5: user memory + onboarding + relationship (skip synthetic app instructions)
      if (!(userMeta && (userMeta.kind === 'app-continue' || userMeta.kind === 'app-doc-continue' || userMeta.kind === 'app-agent'))) {
        applyUserMemoryFromTurn(trimmed, { conversationId: convId! })
        try {
          const { extractAssistantNamesFromUserOnly, mergeAssistantMemory } = await import(
            '@core/conversation/assistant-memory'
          )
          const names = extractAssistantNamesFromUserOnly(trimmed)
          if (names.length) {
            const prev = useSettingsStore.getState().settings.assistantMemory
            const next = mergeAssistantMemory(prev, { preferredNames: names })
            const { appendEpisode } = await import('@core/conversation/memory-episodes')
            const { applyGrowthMilestone } = await import('@core/conversation/memory-growth')
            const grown = applyGrowthMilestone(next, {
              type: 'nickname_harvested',
              names
            })
            const ep = appendEpisode(
              (useSettingsStore.getState().settings as { memoryEpisodes?: unknown })
                .memoryEpisodes as never,
              {
                summary: `El usuario te llama de forma especial: ${names.slice(0, 3).join(', ')}.`,
                tags: ['nickname', 'apodo', ...names.slice(0, 2).map((n) => n.toLowerCase())],
                conversationId: convId || undefined
              }
            )
            useSettingsStore.getState().update({
              assistantMemory: grown,
              memoryEpisodes: ep
            } as never)
          }
        } catch {
          /* optional */
        }
      }
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
      // P0: one silent auto-continue if the model hit length / abrupt cutoff
      try {
        const done = getActive()?.messages.find((m) => m.id === assistantId)
        const meta = (done?.meta || {}) as Record<string, unknown>
        if (
          done &&
          done.role === 'assistant' &&
          meta.limited === true &&
          meta.autoContinuedOnce !== true &&
          String(done.content || '').length > 80
        ) {
          updateMessage(convId!, assistantId, {
            meta: { ...meta, autoContinuedOnce: true }
          })
          window.setTimeout(() => {
            void continueWritingRef.current?.(assistantId)
          }, 450)
        }
      } catch {
        /* optional */
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



  // Auto progressive document reading (no fake user «sigue» bubble)
  useEffect(() => {
    const h = (ev: Event) => {
      const d = (ev as CustomEvent).detail as {
        convId?: string
        fileName?: string
        uiLabel?: string
      }
      if (!d?.convId) return
      if (activeId && d.convId !== activeId) return
      const label =
        d.uiLabel ||
        (d.fileName
          ? `Continuando la lectura de «${d.fileName}»…`
          : 'Continuando la lectura del documento…')
      const payload =
        '[APP] Continuación automática de lectura del documento adjunto. ' +
        'Avanza al siguiente tramo AMPLIO del texto (no solo unas líneas), ' +
        'resume y opina con naturalidad sobre lo nuevo, sin repetir lo ya dicho. ' +
        'Usa el resumen de tramos anteriores. Si el documento ya terminó, dilo. ' +
        'Esto NO es escena íntima: es lectura de archivo.'
      const fire = () => {
        if (inFlightRef.current) {
          window.setTimeout(fire, 1500)
          return
        }
        void sendMessage(payload, undefined, {
          meta: { kind: 'app-doc-continue', uiLabel: label }
        })
      }
      fire()
    }
    window.addEventListener('kawaii:auto-doc-continue', h as EventListener)
    return () => window.removeEventListener('kawaii:auto-doc-continue', h as EventListener)
  }, [activeId, sendMessage])

  const continueWriting = useCallback(
    async (assistantMsgId: string) => {
      if (inFlightRef.current) return
      const conv = getActive()
      if (!conv) return
      const prev = conv.messages.find((m) => m.id === assistantMsgId)
      if (!prev || prev.role !== 'assistant') return
      const tail = String(prev.content || '')
        .trim()
        .slice(-320)
      const instruction =
        '[APP] El usuario pidió continuar la respuesta anterior porque se cortó (límite de tokens). ' +
        'Continúa el mismo hilo desde donde te quedaste, sin repetir lo ya escrito, sin decir que eres un sistema. ' +
        'Cierra ideas a medias y sigue con la misma voz, tono y escena. ' +
        'No digas que esperas ni que te quedas en silencio: escribe el siguiente fragmento narrativo.\n\n' +
        'Final visible previo:\n«…' +
        tail +
        '»'
      const convId = conv.id
      addMessage(convId, {
        role: 'user',
        content: instruction,
        meta: { kind: 'app-continue', uiLabel: 'Continuando la respuesta…' }
      })
      const assistantId = addMessage(convId, {
        role: 'assistant',
        content: '',
        isStreaming: true
      })
      armLoading()
      try {
        const stickyModel =
          (prev.meta as { model?: string } | undefined)?.model ||
          (prev as { model?: string }).model ||
          settings.localModel
        // Re-attach last user images so wardrobe offer survives Continuar
        let contAtt: import('@core/conversation').Message['attachments'] | undefined
        try {
          const msgs = getActive()?.messages || []
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i]
            if (m.role !== 'user') continue
            if (m.attachments?.length) {
              contAtt = m.attachments
              break
            }
            break
          }
        } catch {
          /* */
        }
        await runChatOrchestrationTurn({
          convId,
          assistantId,
          trimmed: instruction,
          hasAtt: Boolean(contAtt?.length),
          attachments: contAtt,
          hasMediaJob: false,
          imageContextForText: undefined,
          settings: {
            ...settings,
            localModel: stickyModel || settings.localModel,
            providerMode: 'local' as const
          },
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
      } finally {
        clearLoading()
      }
    },
    [
      getActive,
      addMessage,
      updateMessage,
      settings.localModel,
      armLoading,
      clearLoading,
      setError,
      setLiveStatus,
      setLastRoute,
      setPhase,
      setRollingSummary,
      deleteMessage
    ]
  )
  continueWritingRef.current = continueWriting

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
      // Preceding user turn (text and/or attachments)
      let userContent = ''
      let userAttachments: import('@core/conversation').Message['attachments'] | undefined
      let userMeta: Record<string, unknown> | undefined
      let cutFromId: string | null = null
      for (let i = idx - 1; i >= 0; i--) {
        const m = conv.messages[i]
        if (m.role !== 'user') continue
        const kind = String((m.meta as { kind?: string } | undefined)?.kind || '')
        const isAppInstr =
          kind === 'app-doc-continue' ||
          kind === 'app-continue' ||
          kind === 'app-agent' ||
          /^\[APP\]/i.test(String(m.content || '').trim())
        userContent = m.content || ''
        userAttachments = m.attachments
        userMeta = m.meta ? { ...(m.meta as Record<string, unknown>) } : undefined
        cutFromId = m.id
        // If this was a transparent app instruction, keep meta so it never paints as a user bubble
        if (isAppInstr) {
          if (!userMeta) userMeta = {}
          if (!userMeta.kind) {
            userMeta.kind = /^\[APP\].*lectura del documento/i.test(userContent)
              ? 'app-doc-continue'
              : kind || 'app-doc-continue'
          }
          if (!userMeta.uiLabel) {
            userMeta.uiLabel =
              userMeta.kind === 'app-continue'
                ? 'Continuando la respuesta…'
                : 'Continuando la lectura del documento…'
          }
        }
        break
      }
      if (cutFromId) {
        deleteMessagesFrom(conv.id, cutFromId)
      } else {
        // No user turn found: only drop the broken assistant and retry doc continue if reading
        deleteMessage(conv.id, assistantMsgId)
        try {
          const { getDocReadingStatesForConv } = await import('../services/documentReadingStore')
          const states = getDocReadingStatesForConv(conv.id)
          const incomplete = states.some(
            (s) => (s.chapterIndex ?? 0) < Math.max(1, s.chapterCount || 1)
          )
          if (incomplete) {
            await sendMessage(
              '[APP] Continuación de lectura del documento adjunto (reintento). ' +
                'Lee el siguiente tramo, resume y opina. No es escena íntima.',
              undefined,
              {
                meta: {
                  kind: 'app-doc-continue',
                  uiLabel: 'Reintentando la lectura del documento…'
                }
              }
            )
            return
          }
        } catch {
          /* */
        }
        return
      }
      if (!userContent.trim() && !(userAttachments && userAttachments.length)) return
      await sendMessage(userContent || ' ', userAttachments, userMeta ? { meta: userMeta } : undefined)
    },
    deleteMessage: (msgId: string) => {
      const conv = getActive()
      if (!conv) return
      const idx = conv.messages.findIndex((m) => m.id === msgId)
      if (idx > 0) {
        // Mark transparent «Continuando…» chips above as resolved so they disappear
        for (let i = idx - 1; i >= 0; i--) {
          const m = conv.messages[i]
          if (m.role !== 'user') break
          const k = String((m.meta as { kind?: string } | undefined)?.kind || '')
          if (
            k === 'app-continue' ||
            k === 'app-doc-continue' ||
            k === 'app-agent' ||
            /^\[APP\]/i.test(String(m.content || '').trim())
          ) {
            try {
              useChatStore.getState().updateMessage(conv.id, m.id, {
                meta: {
                  ...((m.meta || {}) as object),
                  kind: k || 'app-continue',
                  continueResolved: true
                }
              })
            } catch {
              /* */
            }
          } else {
            break
          }
        }
      }
      deleteMessage(conv.id, msgId)
    },
    continueWriting,
    sendMessage,
    stopStreaming
  }
}