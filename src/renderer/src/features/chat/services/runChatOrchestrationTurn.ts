/**
 * P1 residual — chat LLM turn (history, stream, onDone, errors).
 * Extracted from useChat.sendMessage so the hook only sequences phases.
 */
import type { MutableRefObject } from 'react'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { sendChatMessage, type RouteInfo } from './chatOrchestrator'
import { AppError, friendlyProviderMessage } from '@core/errors'
import { buildDocumentsWithState, collectDocAttachmentsFromMessages, hydrateAttachmentTextsFromDisk } from '@core/chat/document-attach'
import { findLatestDocText, isDocReadingComplete, essentialsFromDocState } from '@core/chat/document-reading-state'
import {
  stripThinkingLeak,
  looksLikeStructuredReasoningDump
} from '@core/chat/strip-thinking'
import {
  getDocReadingStatesForConv,
  upsertDocReadingStates
} from './documentReadingStore'
import { markDocReadingActive, setChatBusy } from './chatBusy'
import { scheduleRefineDocRollingSummary } from './refineDocRollingSummary'
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
import { labelForPhase } from '../components/RouteLiveIndicator'
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

/** Per-turn stream paint batching (module scope — this is not a React hook). */
const streamAccRef: { current: Record<string, string> } = { current: {} }
const streamPaintAtRef: { current: Record<string, number> } = { current: {} }
const streamPaintTimerRef: {
  current: Record<string, ReturnType<typeof setTimeout> | undefined>
} = { current: {} }

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
  // Reset paint state for this assistant bubble
  {
    const k = `${convId}:${assistantId}`
    streamAccRef.current[k] = ''
    streamPaintAtRef.current[k] = 0
    if (streamPaintTimerRef.current[k]) {
      clearTimeout(streamPaintTimerRef.current[k])
      streamPaintTimerRef.current[k] = undefined
    }
  }

  try {
    globalCircuitBreaker.recordSuccess('local-openai')
    globalCircuitBreaker.recordSuccess('ollama')
  } catch {
    /* */
  }
    // Docs + local 14B/27B need long wall time; idle re-armed on each token
    let docHeavy = false
    try {
      docHeavy = Boolean(
        attachments?.some((a) => a.textContent && String(a.textContent).trim().length > 800)
      )
      if (!docHeavy) {
        const { getDocReadingStatesForConv } = await import('./documentReadingStore')
        docHeavy = getDocReadingStatesForConv(convId).length > 0
      }
      if (!docHeavy && /\b(lee|lectura|libro|cap[ií]tulo|documento|pdf|sigue)\b/i.test(trimmed)) {
        docHeavy = true
      }
    } catch {
      /* */
    }
    armLoading(docHeavy ? 720_000 : 300_000)
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
      // C0–C3: classify + gift intent (heuristic; VLM refine optional later)
      try {
        const {
          classifyWardrobeHeuristic,
          detectWardrobeGiftIntent,
          buildWardrobeGiftSystemNudge,
          validateWardrobeUpload,
          WARDROBE_UPLOAD
        } = await import('@core/image/wardrobe-classify')
        const imgs = attachments!.filter((a) => a.dataUrl && a.mimeType?.startsWith('image/'))
        const limited = imgs.slice(0, WARDROBE_UPLOAD.maxImagesPerMessage)
        const gift = detectWardrobeGiftIntent(trimmed)
        for (const a of limited) {
          const v = validateWardrobeUpload({
            mimeType: a.mimeType,
            byteLength: a.dataUrl ? Math.floor((a.dataUrl.length * 3) / 4) : undefined,
            fileName: a.name
          })
          if (!v.ok) {
            extraSystem =
              (extraSystem ? extraSystem + '\n\n' : '') +
              `[GUARDARROPA] Adjunto «${a.name || 'imagen'}»: ${v.reason}`
            continue
          }
          const cls = classifyWardrobeHeuristic({
            userText: trimmed,
            fileName: a.name
          })
          // Stash on attachment meta if shape allows
          try {
            ;(a as { wardrobeClass?: unknown }).wardrobeClass = cls
          } catch {
            /* */
          }
          if (gift.isGift && cls.safeForWardrobe) {
            const char = useSettingsStore.getState().settings.character
            extraSystem =
              (extraSystem ? extraSystem + '\n\n' : '') +
              buildWardrobeGiftSystemNudge({
                classification: cls,
                characterName: char?.name,
                userHint: trimmed
              })
          } else if (cls.kind !== 'unknown') {
            extraSystem =
              (extraSystem ? extraSystem + '\n\n' : '') +
              `[GUARDARROPA] Imagen clasificada como «${cls.kind}» (conf. ${cls.confidence.toFixed(2)}). ` +
              (cls.safeForPrimary
                ? 'Puede ser look/foto de chat si el usuario lo pide.'
                : 'No usar como foto principal sin try-on / confirmación.')
          }
        }
      } catch {
        /* classify optional */
      }
    }

    // Chat history gap → soft tip for companion (self-repair suggestion)
    try {
      const { detectChatHistoryGap } = await import('./chatRecovery')
      const gap = await detectChatHistoryGap()
      if (gap.gap) {
        extraSystem =
          (extraSystem ? extraSystem + '\n\n' : '') +
          '[SISTEMA — integridad de historial] ' +
          gap.summary +
          '. Si el usuario dice que faltan mensajes recientes, sugiere con naturalidad usar el botón «Recuperar chats» de la barra lateral (o Ajustes → autodiagnóstico). No inventes el contenido perdido.'
      }
    } catch {
      /* */
    }

    // Library awareness — LLM knows what files exist on disk / in chats
    try {
      const { buildLibraryAwarenessBlock, mergeLibraryCatalog } = await import(
        '@core/chat/library-awareness'
      )
      const diskItems: Array<{
        name: string
        path?: string
        kind: string
        size?: number
        isImage?: boolean
      }> = []
      try {
        const lib = await window.kawaii?.filesListLibrary?.()
        if (lib?.ok && lib.items?.length) {
          for (const it of lib.items.slice(0, 40)) {
            diskItems.push({
              name: it.name,
              path: it.path,
              kind: it.kind,
              size: it.size,
              isImage: it.isImage
            })
          }
        }
      } catch {
        /* */
      }
      const fromChats: typeof diskItems = []
      try {
        const { useChatStore } = await import('@shared/lib/stores/chatStore')
        for (const c of useChatStore.getState().conversations || []) {
          for (const m of c.messages || []) {
            for (const a of m.attachments || []) {
              if (a?.name)
                fromChats.push({
                  name: a.name,
                  path: a.filePath,
                  kind: a.filePath && /app-context/i.test(a.filePath) ? 'context' : 'user',
                  isImage: Boolean(a.mimeType?.startsWith('image/'))
                })
            }
          }
        }
      } catch {
        /* */
      }
      const merged = mergeLibraryCatalog(diskItems, fromChats)
      const block = buildLibraryAwarenessBlock(merged, { maxItems: 20 })
      if (block) {
        extraSystem = (extraSystem ? extraSystem + '\n\n' : '') + block
      }
    } catch {
      /* optional */
    }

    // Align progressive slice size with live model context (checkpoint unchanged)
    try {
      const mid = String(settings.localModel || '').trim()
      if (mid) {
        const { resolveDynamicLocalBudget, progressiveSliceCharsForBudget, setLiveDocSliceChars } =
          await import('@core/conversation/dynamic-context-budget')
        let baseUrl = String((settings as { localBaseUrl?: string }).localBaseUrl || '').trim()
        if (!baseUrl) {
          try {
            const { discoverLmStudioServer } = await import('@core/providers/lmstudio-ports')
            const probe = await discoverLmStudioServer({ timeoutMs: 1_200 })
            if (probe.ok && probe.baseUrl) baseUrl = probe.baseUrl
          } catch {
            baseUrl = 'http://127.0.0.1:1234'
          }
        }
        const dyn = await resolveDynamicLocalBudget(mid, { baseUrl, kind: 'local' })
        setLiveDocSliceChars(progressiveSliceCharsForBudget(dyn.budget))
      }
    } catch {
      /* keep default slice */
    }

    // Text / code documents for local/cloud models (progressive + rolling summary)
    try {
      const priorStates = getDocReadingStatesForConv(convId)
      // D1: rehydrate — attachments of this turn OR docs from history (continuar lectura)
      let docAtts = attachments
      try {
        const hist = collectDocAttachmentsFromMessages(getActive()?.messages)
        const merged = [...(attachments || []), ...hist]
        // de-dupe by filePath/name
        const seen = new Set<string>()
        const uniq = []
        for (const a of merged) {
          const k = (a.filePath || a.name || a.id || '').toLowerCase()
          if (!k || seen.has(k)) continue
          seen.add(k)
          uniq.push(a)
        }
        docAtts = await hydrateAttachmentTextsFromDisk(uniq)
        // Force full re-extract from original office when extract looks truncated
        try {
          const ensure = (window as unknown as {
            kawaii?: {
              filesEnsureDocExtract?: (p: {
                sourcePath?: string
                extractPath?: string
                name?: string
              }) => Promise<{
                ok?: boolean
                text?: string
                extractPath?: string
                totalChars?: number
                repaired?: boolean
              }>
            }
          }).kawaii?.filesEnsureDocExtract
          if (typeof ensure === 'function' && docAtts?.length) {
            const next = []
            for (const a of docAtts) {
              const textLen = String(a.textContent || '').length
              const src = String((a as { sourceFilePath?: string }).sourceFilePath || a.filePath || '')
              if (textLen > 800_000 && !/\.extract\.txt$/i.test(String(a.filePath || ''))) {
                next.push(a)
                continue
              }
              try {
                const er = await ensure({
                  sourcePath: src,
                  extractPath: /\.extract\.txt$/i.test(String(a.filePath || ''))
                    ? String(a.filePath)
                    : undefined,
                  name: a.name
                })
                if (er?.ok && er.text && er.text.length > textLen) {
                  next.push({
                    ...a,
                    textContent: er.text,
                    filePath: er.extractPath || a.filePath,
                    sourceFilePath:
                      (a as { sourceFilePath?: string }).sourceFilePath ||
                      (/\.(docx|pdf)$/i.test(src) ? src : undefined)
                  })
                  if (er.repaired) {
                    try {
                      const { notifyUser } = await import('@shared/lib/notify')
                      void notifyUser(
                        'Extracto del libro ampliado',
                        `Ahora ${er.totalChars || er.text.length} caracteres en app-context (antes incompleto).`,
                        { kind: 'success', sticky: false, os: false }
                      )
                    } catch {
                      /* */
                    }
                  }
                } else next.push(a)
              } catch {
                next.push(a)
              }
            }
            docAtts = next
          }
        } catch {
          /* */
        }
      } catch {
        try {
          const { hydrateAttachmentTextsFromDisk: hyd } = await import('@core/chat/document-attach')
          docAtts = await hyd(attachments)
        } catch {
          docAtts = attachments
        }
      }
      const recovered: Array<{ name: string; text: string }> = []
      const hasFreshDoc = Boolean(
        docAtts?.some((a) => a.textContent && String(a.textContent).trim().length > 80)
      )
      if (!hasFreshDoc) {
        const fromHist = findLatestDocText(getActive()?.messages)
        if (fromHist) recovered.push(fromHist)
        // Last resort: any hydrated text still short — keep recovered
        for (const a of docAtts || []) {
          const tx = String(a.textContent || '').trim()
          if (tx.length > 80) recovered.push({ name: a.name || 'documento', text: tx })
        }
      }
      const wantsAdvance =
        /\b(sigue|continua|contin\u00faa|siguiente (capitulo|cap\u00edtulo|parte)|next chapter|capitulo|cap\u00edtulo)\b/i.test(
          trimmed
        )
      // Soft: user points at already-attached book without re-uploading
      const refersToExistingDoc =
        priorStates.length > 0 &&
        /\b(m[ií]ralo|miralo|v[eé]alo|velo|puedes verlo|verlo t[uú]|eso puedes ver|puedes verlo t[uú] misma|rev[ií]salo|ves el|el (libro|documento|archivo|pdf|docx)|adjunto|lo que (te )?(sub[ií]|adjunt[eé]?|envi[eé]))\b/i.test(
          trimmed
        )
      // Bare "sigue" / APP doc-continue with open reading state → always document path
      const bareSigue =
        /^(sigue|contin[uú]a|continuar)(\s+por\s+favor)?[.!…]?$/i.test(trimmed.trim()) ||
        /\[APP\].*continuar la lectura del documento/i.test(trimmed)
      const forceDocContinue =
        priorStates.length > 0 && (wantsAdvance || refersToExistingDoc || bareSigue)

      if (
        hasFreshDoc ||
        recovered.length ||
        (wantsAdvance && priorStates.length) ||
        refersToExistingDoc ||
        forceDocContinue
      ) {
        const { block, states } = buildDocumentsWithState(docAtts, {
          userMessage: trimmed,
          convId,
          priorStates,
          recoveredDocs: recovered.length ? recovered : undefined
        })
        if (block) {
          extraSystem = (extraSystem ? extraSystem + '\n\n' : '') + block
          if (forceDocContinue || bareSigue || /\[APP\].*lectura del documento/i.test(trimmed)) {
            extraSystem +=
              '\n\n[LECTURA DE DOCUMENTO — prioridad]\n' +
              'El usuario quiere que CONTINÚES LEYENDO el archivo adjunto (siguiente tramo/capítulo).\n' +
              'Responde sobre el texto del documento: resumen, opinión, reacciones al contenido.\n' +
              'PROHIBIDO interpretar «sigue» como continuar una escena íntima o romántica salvo que el documento lo diga.\n' +
              'No inventes que el usuario escribió solo la palabra sigue; actúa como lectora atenta del libro/archivo.'
          }
        }
        if (states.length) {
          upsertDocReadingStates(states)
          try {
            if (hasFreshDoc) {
              sessionStorage.setItem('kawaii-doc-auto-chain:' + convId, '0')
              sessionStorage.setItem('kawaii-doc-auto-paused:' + convId, '0')
            }
          } catch {
            /* */
          }
          // LLM refine of rolling summary (async, non-blocking)
          scheduleRefineDocRollingSummary(states)
          // Auto-continue chain + transparent DOC_READ memory
          try {
            const incomplete = states.filter((s) => !isDocReadingComplete(s))
            const complete = states.filter((s) => isDocReadingComplete(s))
            // Persist essentials into userMemory.facts (transparent, not a full book dump)
            if (states.length) {
              const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
              const s = useSettingsStore.getState().settings
              const facts = [...(s.userMemory?.facts || [])]
              for (const st of states) {
                const line = essentialsFromDocState(st)
                const key = `DOC_READ «${st.fileName || 'documento'}»`
                const idx = facts.findIndex((f) => String(f).startsWith(key) || String(f).includes(key.slice(0, 40)))
                if (idx >= 0) facts[idx] = line
                else facts.push(line)
              }
              useSettingsStore.getState().update({
                userMemory: {
                  ...(s.userMemory || { facts: [] }),
                  facts: facts.slice(-40),
                  updatedAt: Date.now()
                }
              })
            }
            // Stash for onDone auto-continue (same turn)
            ;(globalThis as unknown as { __kawaiiDocAuto?: { convId: string; incomplete: boolean; fileName?: string } }).__kawaiiDocAuto =
              {
                convId,
                incomplete: incomplete.length > 0,
                fileName: incomplete[0]?.fileName || complete[0]?.fileName
              }
          } catch {
            /* memory optional */
          }
        }
      }
    } catch {
      /* ignore */
    }

    // Standing instructions + lectura progresiva (preguntas de capítulo)
    try {
      const live = useSettingsStore.getState().settings
      const stands = live.userMemory?.standingInstructions || []
      if (stands.length) {
        extraSystem =
          (extraSystem ? extraSystem + '\n\n' : '') +
          '[INSTRUCCIONES_FIJAS_DEL_USUARIO] Cumple estas reglas en cada respuesta (no las listes a menos que pregunten):\n- ' +
          stands.slice(0, 8).join('\n- ')
      }
      const askProgress =
        /\b(cap[ií]tulo|capítulos|cu[aá]ntos? cap|en qu[eé] cap|d[oó]nde (te )?quedaste|hasta d[oó]nde|progreso (de )?lectura|has le[ií]do)\b/i.test(
          trimmed
        )
      if (askProgress) {
        const states = getDocReadingStatesForConv(convId)
        if (states.length) {
          const lines = states.map(
            (st) =>
              `«${st.fileName}»: tramo/índice ${st.chapterIndex + 1} de ${st.chapterCount}` +
              (st.readTitles?.length
                ? `; ya revisados: ${st.readTitles.slice(-6).join(' · ')}`
                : '') +
              (st.rollingSummary
                ? `. Resumen compacto: ${st.rollingSummary.slice(0, 280)}`
                : '')
          )
          extraSystem =
            (extraSystem ? extraSystem + '\n\n' : '') +
            '[PROGRESO_LECTURA_GUARDADO] Usa estos datos exactos al responder (no inventes otros capítulos):\n' +
            lines.join('\n')
        }
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
      let routeMeta: {
        task?: string
        reason?: string
        switched?: boolean
        lifecycle?: string
        from?: string
        to?: string
      } = {}
      try {
        const isDocTurn =
          /\[APP\].*lectura del documento/i.test(trimmed) ||
          /continuar la lectura del documento/i.test(trimmed) ||
          Boolean(
            (typeof sessionStorage !== 'undefined' &&
              Number(sessionStorage.getItem('kawaii-doc-auto-chain:' + convId) || '0') > 0)
          )
        // Progressive reading must stay on the same loaded model (no second load)
        if (isDocTurn) {
          routeMeta = { task: 'chat', reason: 'lectura documento · mismo modelo', switched: false }
          try {
            markDocReadingActive(180_000)
          } catch {
            /* */
          }
          liveSettings = useSettingsStore.getState().settings
          setPhase('generating', {
            target: 'local',
            model: (liveSettings.localModel || '').trim() || 'local',
            reason: 'Lectura de documento (sin cambiar modelo)',
            at: Date.now()
          })
        } else {
          const ar = await applyAutoModelRouting(trimmed, {
            hasImageAttachment: Boolean(hasAtt)
          })
          routeMeta = {
            task: ar.task,
            reason: ar.reason,
            switched: ar.applied,
            lifecycle: ar.lifecycle,
            from: ar.from,
            to: ar.to
          }
          liveSettings = useSettingsStore.getState().settings
          setPhase('generating', {
            target: 'local',
            model: (liveSettings.localModel || '').trim() || 'local',
            reason: ar.reason || '',
            at: Date.now()
          })
        }
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
              // Keep watchdog alive while tokens arrive (local models stream slowly)
              armLoading(docHeavy ? 720_000 : 300_000)
            } catch {
              /* ignore */
            }
            // Batch UI paints: LMS often finishes generation while the IPC buffer
            // still drains; updating React on every token makes the bubble lag
            // behind as if the model were still writing.
            const accKey = `${convId}:${assistantId}`
            const prevAcc = (streamAccRef.current[accKey] as string) || ''
            const current = useChatStore
              .getState()
              .conversations.find((c) => c.id === convId)
              ?.messages.find((m) => m.id === assistantId)
            const base = prevAcc || current?.content || ''
            const next = mergeStreamToken(base, String(token || ''))
            if (!next || next === base) return
            streamAccRef.current[accKey] = next
            // Perf: one React update per animation frame (not per token)
            const flush = () => {
              streamPaintTimerRef.current[accKey] = undefined
              const text = streamAccRef.current[accKey]
              if (text == null) return
              streamPaintAtRef.current[accKey] = Date.now()
              updateMessage(convId!, assistantId, {
                content: stripWhileStreaming(text),
                isStreaming: true
              })
            }
            if (!streamPaintTimerRef.current[accKey]) {
              const raf =
                typeof requestAnimationFrame === 'function'
                  ? requestAnimationFrame
                  : (cb: FrameRequestCallback) =>
                      setTimeout(cb, 32) as unknown as number
              streamPaintTimerRef.current[accKey] = raf(() => flush()) as unknown as ReturnType<
                typeof setTimeout
              >
            }
          },
          onThinking: (chunk) => {
            const accThink = `${convId}:${assistantId}:think`
            const prev = (streamAccRef.current[accThink] as string) || ''
            streamAccRef.current[accThink] = prev + String(chunk || '')
            if (streamPaintTimerRef.current[accThink]) return
            const raf =
              typeof requestAnimationFrame === 'function'
                ? requestAnimationFrame
                : (cb: FrameRequestCallback) => setTimeout(cb, 48) as unknown as number
            streamPaintTimerRef.current[accThink] = raf(() => {
              streamPaintTimerRef.current[accThink] = undefined
              const thinkText = streamAccRef.current[accThink] || ''
              const current = useChatStore
                .getState()
                .conversations.find((c) => c.id === convId)
                ?.messages.find((m) => m.id === assistantId)
              const prevMeta = (current?.meta || {}) as Record<string, unknown>
              updateMessage(convId!, assistantId, {
                isStreaming: true,
                meta: {
                  ...prevMeta,
                  thinking: thinkText,
                  hasThinking: true
                }
              })
            }) as unknown as ReturnType<typeof setTimeout>
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
                  (routeMeta.task
                    ? `Auto [${routeMeta.task}]` +
                      (routeMeta.from || routeMeta.to
                        ? ` ${routeMeta.from || '?'}→${routeMeta.to || '?'}`
                        : '') +
                      (routeMeta.reason ? `: ${routeMeta.reason}` : '')
                    : routeMeta.reason || '') +
                  (routeMeta.lifecycle ? ` · ${routeMeta.lifecycle}` : '') +
                  (info.reason
                    ? (routeMeta.reason || routeMeta.lifecycle ? ' · ' : '') + info.reason
                    : ''),
                switchedAt: info.at,
                failover: info.failover,
                contextPacked: info.contextPacked,
                summarySource: info.summarySource,
                autoRouteTask: routeMeta.task,
                autoRouteSwitched: routeMeta.switched,
                autoRouteFrom: routeMeta.from,
                autoRouteTo: routeMeta.to,
                lifecycle: routeMeta.lifecycle
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
            // A4: detect echo of previous assistant (broken thinking / stuck model)
            try {
              const msgs =
                useChatStore.getState().conversations.find((c) => c.id === convId)?.messages ||
                []
              const idx = msgs.findIndex((m) => m.id === assistantId)
              let prevAsst = ''
              for (let i = idx - 1; i >= 0; i--) {
                if (msgs[i].role === 'assistant' && String(msgs[i].content || '').trim()) {
                  prevAsst = String(msgs[i].content)
                  break
                }
              }
              const body = String(meta?.content || msgs[idx]?.content || '')
              void import('@core/chat/echo-detect').then(({ isNearEchoOfPrevious }) => {
                if (!isNearEchoOfPrevious(prevAsst, body)) return
                console.warn('[auto-route] echo detected — mark + preferThinkingOff next')
                try {
                  ;(globalThis as { __kawaiiForceThinkingOffUntil?: number }).__kawaiiForceThinkingOffUntil =
                    Date.now() + 5 * 60 * 1000
                } catch {
                  /* */
                }
                const current = useChatStore
                  .getState()
                  .conversations.find((c) => c.id === convId)
                  ?.messages.find((m) => m.id === assistantId)
                const prevMeta = (current?.meta || {}) as Record<string, unknown>
                updateMessage(convId!, assistantId, {
                  meta: {
                    ...prevMeta,
                    echoDetected: true,
                    reason:
                      String(prevMeta.reason || '') +
                      (String(prevMeta.reason || '').includes('eco')
                        ? ''
                        : ' · posible eco del turno anterior — reintenta o cambia modelo')
                  }
                })
              })
            } catch {
              /* */
            }
            // Display finalize + assistant memory (modular)
            try {
              // Flush pending RAF/timer so the last tokens are not lost
              const paintKey = `${convId}:${assistantId}`
              const pending = streamPaintTimerRef.current[paintKey]
              if (pending != null) {
                try {
                  if (typeof cancelAnimationFrame === 'function') {
                    cancelAnimationFrame(pending as unknown as number)
                  }
                } catch {
                  /* */
                }
                try {
                  clearTimeout(pending as ReturnType<typeof setTimeout>)
                } catch {
                  /* */
                }
                streamPaintTimerRef.current[paintKey] = undefined
              }
              const acc = streamAccRef.current[paintKey] || ''
              const metaContent = String(meta?.content || '')
              let uiContent = ''
              try {
                uiContent =
                  useChatStore
                    .getState()
                    .conversations.find((c) => c.id === convId)
                    ?.messages.find((m) => m.id === assistantId)?.content || ''
              } catch {
                uiContent = ''
              }
              // Prefer the longest complete source (never drop LMS tokens already buffered)
              const best = [metaContent, acc, uiContent].reduce(
                (a, b) => (String(b || '').length > String(a || '').length ? String(b || '') : a),
                ''
              )
              if (best.length > 0) {
                let visible = stripWhileStreaming(best)
                let thinkingExtra = ''
                try {
                  if (looksLikeStructuredReasoningDump(best) || looksLikeStructuredReasoningDump(visible)) {
                    thinkingExtra = best
                    visible = stripThinkingLeak(best).trim()
                    try {
                      const { preserveMdBreaks } = require('@core/chat/normalize-markdown') as typeof import('@core/chat/normalize-markdown')
                      visible = preserveMdBreaks(visible)
                    } catch {
                      /* */
                    }
                  } else {
                    const cleaned = stripThinkingLeak(visible)
                    // Any substantial strip → keep removed text as thinking (show in panel)
                    if (cleaned.length < visible.length && visible.length > 40) {
                      const approxRemoved = visible
                        .split(/\n\n+/)
                        .filter((para) => {
                          const c = stripThinkingLeak(para)
                          return c.length < para.length * 0.85
                        })
                        .join('\n\n')
                        .trim()
                      if (approxRemoved.length > 20) thinkingExtra = approxRemoved
                      else if (cleaned.length < visible.length * 0.85) thinkingExtra = visible.slice(0, 8000)
                      visible = cleaned || visible
                    } else {
                      visible = cleaned || visible
                    }
                    try {
                      const { preserveMdBreaks } = require('@core/chat/normalize-markdown') as typeof import('@core/chat/normalize-markdown')
                      visible = preserveMdBreaks(visible)
                    } catch {
                      /* */
                    }
                  }
                } catch {
                  /* */
                }
                // Flush thinking RAF so last CoT chunks are in the accumulator
                const thinkKey = `${paintKey}:think`
                const thinkPending = streamPaintTimerRef.current[thinkKey]
                if (thinkPending != null) {
                  try {
                    if (typeof cancelAnimationFrame === 'function') {
                      cancelAnimationFrame(thinkPending as unknown as number)
                    }
                  } catch {
                    /* */
                  }
                  try {
                    clearTimeout(thinkPending as ReturnType<typeof setTimeout>)
                  } catch {
                    /* */
                  }
                  streamPaintTimerRef.current[thinkKey] = undefined
                }
                const streamThink = String(streamAccRef.current[thinkKey] || '').trim()
                const prevMeta = (useChatStore
                  .getState()
                  .conversations.find((c) => c.id === convId)
                  ?.messages.find((m) => m.id === assistantId)?.meta || {}) as Record<string, unknown>
                const prevThink = String(prevMeta.thinking || meta?.thinking || streamThink || '')
                const mergedThink = [prevThink, streamThink, thinkingExtra]
                  .map((x) => String(x || '').trim())
                  .filter(Boolean)
                  .filter((x, i, arr) => arr.indexOf(x) === i)
                  .join('\n\n')
                  .trim()
                  .slice(0, 12000)
                if (!visible.trim() && mergedThink) {
                  visible =
                    /documento|lectura|capítulo|tramo/i.test(mergedThink + String(trimmed || ''))
                      ? 'Sigo con el documento… dame un momento y te cuento el siguiente tramo con calma.'
                      : 'Estoy ordenando la idea… un segundo y te respondo en personaje.'
                }
                updateMessage(convId!, assistantId, {
                  content: visible,
                  isStreaming: false,
                  meta: {
                    ...prevMeta,
                    ...(mergedThink
                      ? {
                          thinking: mergedThink,
                          hasThinking: true
                        }
                      : {
                          // Explicit: no thinking channel → do not leave stale hasThinking
                          hasThinking: false
                        })
                  }
                })
              }
              delete streamAccRef.current[paintKey]
              delete streamPaintAtRef.current[paintKey]
              delete streamAccRef.current[`${paintKey}:think`]
              delete streamPaintTimerRef.current[`${paintKey}:think`]
              // Hide all open «Continuando…» chips in this conversation once reply is done
              try {
                const st = useChatStore.getState()
                const conv = st.conversations.find((c) => c.id === convId)
                const msgs = conv?.messages || []
                for (const m of msgs) {
                  if (m.role !== 'user') continue
                  const meta = (m.meta || {}) as { kind?: string; continueResolved?: boolean }
                  if (meta.continueResolved) continue
                  const k = String(meta.kind || '')
                  if (
                    k === 'app-continue' ||
                    k === 'app-doc-continue' ||
                    k === 'app-agent' ||
                    /^\[APP\]/i.test(String(m.content || '').trim())
                  ) {
                    st.updateMessage(convId!, m.id, {
                      meta: {
                        ...meta,
                        kind: k || 'app-doc-continue',
                        continueResolved: true
                      }
                    })
                  }
                }
              } catch {
                /* */
              }


              if (meta?.thinking) {
                const current = useChatStore
                  .getState()
                  .conversations.find((c) => c.id === convId)
                  ?.messages.find((m) => m.id === assistantId)
                const prevMeta = (current?.meta || {}) as Record<string, unknown>
                updateMessage(convId!, assistantId, {
                  meta: {
                    ...prevMeta,
                    thinking: String(meta.thinking),
                    hasThinking: true
                  }
                })
              }
              finalizeCompletedAssistantReply({
                convId: convId!,
                assistantId,
                userText: trimmed,
                orchestratorContent: best || metaContent || acc,
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

            // Auto-continue: 3 tramos extra (4 lecturas en total contando la primera), luego manual
            try {
              const DOC_AUTO_MAX = 3
              const flag = (globalThis as unknown as { __kawaiiDocAuto?: { convId: string; incomplete: boolean; fileName?: string } }).__kawaiiDocAuto
              const chainKey = 'kawaii-doc-auto-chain:' + convId
              const pauseKey = 'kawaii-doc-auto-paused:' + convId
              if (flag && flag.convId === convId && flag.incomplete) {
                const paused = sessionStorage.getItem(pauseKey) === '1'
                const n = Number(sessionStorage.getItem(chainKey) || '0') || 0
                if (!paused && n < DOC_AUTO_MAX) {
                  sessionStorage.setItem(chainKey, String(n + 1))
                  const fileHint = flag.fileName ? ` «${flag.fileName}»` : ''
                  try {
                    markDocReadingActive(120_000)
                  } catch {
                    /* */
                  }
                  // Longer gap so inFlight/clearLoading finish before the next send
                  window.setTimeout(() => {
                    try {
                      window.dispatchEvent(
                        new CustomEvent('kawaii:auto-doc-continue', {
                          detail: {
                            convId,
                            fileName: flag.fileName,
                            uiLabel: `Continuando la lectura${fileHint}… (${n + 1}/${DOC_AUTO_MAX})`
                          }
                        })
                      )
                    } catch {
                      /* */
                    }
                  }, 2200)
                } else if (!paused && n >= DOC_AUTO_MAX) {
                  // Switch to manual: user presses «Continuar lectura»
                  sessionStorage.setItem(chainKey, '0')
                  sessionStorage.setItem(pauseKey, '1')
                  try {
                    window.dispatchEvent(
                      new CustomEvent('kawaii:doc-auto-paused', {
                        detail: {
                          convId,
                          fileName: flag.fileName,
                          reason: 'max-auto'
                        }
                      })
                    )
                  } catch {
                    /* */
                  }
                }
              } else if (flag && flag.convId === convId && !flag.incomplete) {
                sessionStorage.setItem(chainKey, '0')
                sessionStorage.setItem(pauseKey, '0')
              }
              ;(globalThis as unknown as { __kawaiiDocAuto?: unknown }).__kawaiiDocAuto = undefined
            } catch {
              /* */
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
                limited: Boolean(meta.limited),
                finishReason: meta.finishReason || undefined,
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
            try {
              setLiveStatus({
                phase: 'done',
                route: meta.route,
                label: labelForPhase('done', meta.route),
                tried: [...triedRef.current]
              })
            } catch {
              try {
                setLiveStatus({
                  phase: 'done',
                  route: meta.route,
                  label: 'Listo',
                  tried: [...triedRef.current]
                })
              } catch {
                /* ignore */
              }
            }
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
