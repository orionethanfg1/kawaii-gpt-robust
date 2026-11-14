import { shouldProposeNickname, pickNicknameProposal, buildNicknameProposalText, markProposalSent } from '@core/conversation/relationship-confidence'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useEffect, useRef } from 'react'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useActivityStore } from '@shared/lib/stores/activityStore'
import { notifyUser } from '@shared/lib/notify'
import {
  buildInitiativeLlmMessages,
  buildInitiativeDecisionMessages,
  buildInitiativeCompositionMessages,
  parseInitiativeDecision,
  detectInitiativeTone,
  generateInitiativeWithLocalLlm,
  initiativeMinutesForTone,
  shouldSendInitiative
} from '@core/conversation/initiative'
import {
  getAssistantStreamDoneAt
} from '../services/turn-initiative-hooks'
import { isChatBusy } from '../services/chatBusy'

/**
 * Soft proactive messages while the app stays open and the user is idle.
 * E-INIT: timer is driven by last *user* message time, not by pointer or every settings write.
 */
export function useConversationInitiative(enabledGate: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Solo se actualiza al enviar una iniciativa real (cooldown). */
  const lastInitiativeSentRef = useRef(0)
  /** Ancla de reprogramación tras actividad del chat (no cuenta como iniciativa). */
  const scheduleAnchorRef = useRef(0)
  const recentNudgesRef = useRef<string[]>([])
  const generatingRef = useRef(false)
  const lastWardrobeProposeRef = useRef(0)
  const lastWardrobeWishRef = useRef(0)
  const lastIntimacyProposeRef = useRef(0)
  const ignoredCountRef = useRef(0)
  const sentTodayRef = useRef({ day: '', count: 0 })

  useEffect(() => {
    if (!enabledGate) return

    let disposed = false
    let runTick: (() => void) | undefined
    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    const retry = (delayMs: number) => {
      if (disposed) return
      clear()
      timerRef.current = setTimeout(() => runTick?.(), delayMs)
    }

    const isHarnessNoise = (m: {
      role?: string
      content?: string
      isStreaming?: boolean
      meta?: { model?: string; provider?: string }
    }) => {
      if (!m) return true
      if (m.isStreaming) return true
      const model = String(m.meta?.model || '')
      if (model === 'harness-host' || /harness/i.test(model)) return true
      if (/Un momento, estoy revisando/i.test(m.content || '')) return true
      if (m.meta?.provider === 'app' && /plan\[host\]/i.test(m.content || '')) return true
      return false
    }

    const fixedMinutes = (): number | undefined => {
      const s = useSettingsStore.getState().settings
      if (s.conversationInitiativeMode !== 'fixed') return undefined
      return Math.max(1, Math.min(120, Number(s.conversationInitiativeMinutes) || 4))
    }

    /** Delay until we should try a nudge (absolute, based on last user msg). */
    const resolveDelayMs = (): number | null => {
      const s = useSettingsStore.getState().settings
      if (!s.conversationInitiativeEnabled) return null
      const snoozeUntil = s.conversationInitiativeSnoozeUntil || 0
      if (snoozeUntil > 0 && snoozeUntil <= Date.now()) {
        // clear expired snooze so daily use does not stay blocked
        try {
          useSettingsStore.getState().update({ conversationInitiativeSnoozeUntil: 0 })
        } catch {
          /* */
        }
      } else if (snoozeUntil > Date.now()) {
        return Math.min(60_000, Math.max(1000, snoozeUntil - Date.now() + 200))
      }

      const tone = detectInitiativeTone({
        personality: s.character?.personality,
        style: s.character?.style,
        relationshipRole: s.character?.relationshipRole,
        traits: s.character?.traits,
        tagline: s.character?.tagline
      })
      const intervalMin =
        fixedMinutes() ??
        initiativeMinutesForTone(tone, {
          ignoredCount: ignoredCountRef.current,
          relationshipStage: s.relationshipState?.stage
        })
      const intervalMs = intervalMin * 60_000

      const store = useChatStore.getState()
      const conv = store.conversations.find((c) => c.id === store.activeId)
      // Anchor = when the *assistant finished* the last reply (not the user send),
      // so we do not fire an initiative while/just as the model is finishing.
      const msgs = conv?.messages || []
      const lastAssistantMsgAt =
        [...msgs]
          .reverse()
          .find((m) => m.role === 'assistant' && !m.isStreaming && String(m.content || '').trim())
          ?.createdAt || 0
      // X7: prefer explicit stream-done timestamp (set in onDone) over message createdAt
      const streamDoneAt = getAssistantStreamDoneAt(String(store.activeId || ''))
      const lastAssistantDone = Math.max(streamDoneAt, lastAssistantMsgAt)
      const lastUserAt =
        [...msgs].reverse().find((m) => m.role === 'user')?.createdAt || 0
      // Prefer assistant completion; if none, fall back to user
      const activityAt = Math.max(lastAssistantDone, lastUserAt)
      // No mezclar "última iniciativa enviada" con "última actividad del chat"
      const anchor = Math.max(activityAt, scheduleAnchorRef.current, lastInitiativeSentRef.current)
      const dueAt = anchor + intervalMs
      const wait = dueAt - Date.now()
      // Never wait more than interval; never negative → fire soon
      if (wait <= 0) return 1200
      return Math.min(wait, intervalMs)
    }

    const schedule = (reason?: string) => {
      clear()
      if (disposed) return
      if (useActivityStore.getState().mode !== 'none') return
      const delay = resolveDelayMs()
      if (delay == null) return
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[initiative] schedule', Math.round(delay / 1000) + 's', reason || '')
      }
      timerRef.current = setTimeout(() => runTick?.(), delay)
    }

    const tick = async () => {
      if (useActivityStore.getState().mode !== 'none') {
        schedule('activity')
        return
      }
      const s = useSettingsStore.getState().settings
      if (!s.conversationInitiativeEnabled) return
      if ((s.conversationInitiativeSnoozeUntil || 0) > Date.now()) {
        schedule('snooze')
        return
      }

      const store = useChatStore.getState()
      const convId = store.activeId
      if (!convId) {
        schedule('no-conv')
        return
      }
      const conv = store.conversations.find((c) => c.id === convId)
      if (!conv || conv.messages.length < 1) {
        schedule('empty')
        return
      }

      // Never interrupt main chat, progressive doc read, or any streaming bubble
      if (isChatBusy()) {
        retry(8000)
        return
      }
      const anyStreaming = (conv.messages || []).some((m) => m.isStreaming)
      if (anyStreaming) {
        retry(5000)
        return
      }
      try {
        const chain = Number(sessionStorage.getItem('kawaii-doc-auto-chain:' + convId) || '0') || 0
        const chainAt = Number(sessionStorage.getItem('kawaii-doc-auto-chain-at:' + convId) || '0') || 0
        if (chain > 0 && chainAt > 0 && Date.now() - chainAt > 3 * 60_000) {
          try {
            sessionStorage.removeItem('kawaii-doc-auto-chain:' + convId)
            sessionStorage.removeItem('kawaii-doc-auto-chain-at:' + convId)
          } catch {
            /* */
          }
        } else if (chain > 0) {
          retry(12_000)
          return
        }
      } catch {
        /* */
      }
      const lastRaw = conv.messages[conv.messages.length - 1]
      if (lastRaw?.isStreaming) {
        retry(4000)
        return
      }
      if (generatingRef.current) {
        retry(3000)
        return
      }
      // Skip initiative right after app-doc-continue chips
      if (
        lastRaw?.meta?.kind === 'app-doc-continue' ||
        lastRaw?.meta?.kind === 'app-continue' ||
        (lastRaw?.role === 'assistant' && /\[APP\].*lectura del documento/i.test(String(lastRaw.content || '')))
      ) {
        schedule('doc-read-active')
        return
      }

      // Last real conversational turn (skip harness). If only harness after user, still OK to nudge.
      const lastReal =
        [...conv.messages]
          .reverse()
          .find((m) => !isHarnessNoise(m) && (m.role === 'assistant' || m.role === 'user')) ||
        lastRaw

      // User just spoke and nothing settled yet
      if (lastReal?.role === 'user' && !lastRaw?.role) {
        schedule('wait-reply')
        return
      }
      // If the very last message is still the user typing turn without assistant yet — wait
      if (lastRaw?.role === 'user') {
        schedule('user-last')
        return
      }
      // Do not stack initiative on initiative — unless the last one is old (>45 min)
      if (
        lastRaw?.meta?.model &&
        /initiative/i.test(String(lastRaw.meta.model))
      ) {
        const age = Date.now() - (Number(lastRaw.createdAt) || 0)
        if (age < 45 * 60_000) {
          schedule('already-initiative')
          return
        }
      }

      // CV1: harness last-bubble handled via reduced minUserIdleMs below

      const tone = detectInitiativeTone({
        personality: s.character?.personality,
        style: s.character?.style,
        relationshipRole: s.character?.relationshipRole,
        traits: s.character?.traits,
        tagline: s.character?.tagline
      })
      const fixedMin = fixedMinutes()
      // CV1: after harness/tool bubbles, don't force the full idle window again
      let minUserIdleMs =
        fixedMin != null
          ? Math.max(10_000, Math.floor(fixedMin * 60_000 * 0.35))
          : 45_000
      if (lastRaw && isHarnessNoise(lastRaw)) {
        minUserIdleMs = Math.min(minUserIdleMs, fixedMin != null ? 15_000 : 45_000)
      }

      const dayKey = new Date().toISOString().slice(0, 10)
      if (sentTodayRef.current.day !== dayKey) {
        sentTodayRef.current = { day: dayKey, count: 0 }
      }

      const lastUserAt = [...conv.messages].reverse().find((m) => m.role === 'user')?.createdAt

      // Fixed mode: skip quiet hours so tests and daytime toggles work predictably
      // If createdAt missing on messages, fall back to stream-done / now-wait so silence still works
      const streamDoneFallback = getAssistantStreamDoneAt(String(convId || ''))
      const effectiveLastUser =
        lastUserAt && lastUserAt > 0
          ? lastUserAt
          : streamDoneFallback > 0
            ? streamDoneFallback
            : Date.now() - Math.max(minUserIdleMs, (fixedMin || 12) * 60_000)
      const gate = shouldSendInitiative({
        quietHoursStart: s.initiativeQuietHoursStart,
        quietHoursEnd: s.initiativeQuietHoursEnd,
        // Fixed mode: do not block on quiet hours inside shouldSend (hook also skips later)
        respectQuietHours:
          s.conversationInitiativeMode === 'fixed'
            ? false
            : s.initiativeRespectQuietHours !== false,
        enabled: true,
        snoozeUntil: s.conversationInitiativeSnoozeUntil,
        lastInitiativeAt: lastInitiativeSentRef.current || undefined,
        lastUserAt: effectiveLastUser,
        tone,
        ignoredCount: ignoredCountRef.current,
        sentToday: sentTodayRef.current.count,
        maxPerDay:
          s.initiativeMaxPerDay && s.initiativeMaxPerDay > 0
            ? s.initiativeMaxPerDay
            : fixedMin != null
              ? 12
              : undefined,
        waitMinOverride: fixedMin,
        minUserIdleMs,
        now: Date.now(),
        relationshipStage: s.relationshipState?.stage
      })

      // Adaptive quiet hours only when not fixed
      if (!gate.ok) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[initiative] gate block', gate.reason)
        }
        schedule('gate:' + gate.reason)
        return
      }

      // Quiet hours: only in personality/adaptive mode
      if (s.conversationInitiativeMode !== 'fixed') {
        const { isQuietHours } = await import('@core/conversation/initiative')
        if (isQuietHours()) {
          schedule('quiet')
          return
        }
      }

      generatingRef.current = true
      try {
        const rawName = s.userMemory?.preferredName || s.userMemory?.userName || undefined
        const userName =
          rawName &&
          !/^(cu[aá]l|qu[eé]|c[oó]mo|qui[eé]n|mejor|ambas)/i.test(String(rawName).trim())
            ? rawName
            : undefined
        const charName = s.character?.name || 'Kawaii'
        const recentLines = conv.messages
          .filter((m) => !isHarnessNoise(m))
          .slice(-8)
          .map((m) => {
            const who = m.role === 'user' ? userName || 'Usuario' : charName
            return who + ': ' + (m.content || '').slice(0, 180)
          })
        const recentUserLines = conv.messages
          .filter((m) => m.role === 'user' && !isHarnessNoise(m))
          .slice(-6)
          .map((m) => String(m.content || '').slice(0, 240))
        const activeGoals = (s.userMemory?.goals || [])
          .map((goal) => String(goal || '').trim())
          .filter(Boolean)
          .slice(0, 4)
        const currentFocus = String(s.userMemory?.currentFocus || '').trim()
        const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user')
        const lastAsstMsg = [...conv.messages]
          .reverse()
          .find((m) => m.role === 'assistant' && !m.isStreaming && !isHarnessNoise(m))
        const streamDoneAt = getAssistantStreamDoneAt(String(convId || ''))
        let hoursSince: number | undefined
        let hoursSinceAssistantDone: number | undefined
        try {
          const { resolveThreadTimeAnchors } = await import('@core/conversation/local-time-context')
          const anchors = resolveThreadTimeAnchors({
            lastUserAt: lastUser?.createdAt,
            lastAssistantDoneAt: streamDoneAt,
            lastAssistantMsgAt: lastAsstMsg?.createdAt
          })
          hoursSince =
            anchors.sinceUserMs > 0 ? anchors.sinceUserMs / 3_600_000 : undefined
          hoursSinceAssistantDone =
            anchors.silenceSinceAssistantMs > 0
              ? anchors.silenceSinceAssistantMs / 3_600_000
              : undefined
        } catch {
          hoursSince = lastUser?.createdAt
            ? (Date.now() - lastUser.createdAt) / 3_600_000
            : undefined
        }

        let text: string | null = null
        let templateDraft: string | null = null
        let onTemplateSent: (() => void) | null = null
        let initiativeWebHitsForMeta = 0
        const isVisionModel = (id: string) =>
          /moondream|mmproj|vision|llava|clip|minicpm-v|bakllava|\.projector/i.test(id)
        let modelRaw =
          (s.localModel || '').trim() ||
          (s as { preferredLocalModel?: string }).preferredLocalModel ||
          (s as { lastEffectiveLocalModel?: string }).lastEffectiveLocalModel ||
          ''
        // Prefer the model that last replied in this chat (same resident as conversation)
        if (!modelRaw) {
          try {
            const lastAsst = [...(conv.messages || [])]
              .reverse()
              .find((m) => m.role === 'assistant' && m.meta?.model && !/initiative|harness/i.test(String(m.meta.model)))
            const mid = String(lastAsst?.meta?.model || '').replace(/·initiative$/i, '').trim()
            if (mid && !isVisionModel(mid)) modelRaw = mid
          } catch {
            /* */
          }
        }
        if (modelRaw && isVisionModel(modelRaw)) {
          modelRaw = ''
        }
        if (modelRaw) {
          try {
            const { isLocalModelDisabled } = await import('@core/models/disabled-local-models')
            if (isLocalModelDisabled(modelRaw, s.disabledLocalModels || [])) modelRaw = ''
          } catch {
            /* */
          }
        }
        if (!modelRaw) {
          const { isLocalModelDisabled } = await import('@core/models/disabled-local-models')
          const disabled = s.disabledLocalModels || []
          for (const c of [
            (s as { preferredLocalModel?: string }).preferredLocalModel,
            (s as { lastEffectiveLocalModel?: string }).lastEffectiveLocalModel,
            s.localModel
          ]) {
            const id = String(c || '').trim()
            if (id && !isVisionModel(id) && !isLocalModelDisabled(id, disabled)) {
              modelRaw = id
              break
            }
          }
        }
        const looksOllama = Boolean(modelRaw && !modelRaw.includes('/'))
        let base = (s.localBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
        // LM Studio / path-style ids always use OpenAI-compatible port
        if (modelRaw.includes('/')) {
          base =
            (s as { lmStudioBaseUrl?: string }).lmStudioBaseUrl?.replace(/\/$/, '') ||
            (/1234|1235|4891/.test(base) ? base : 'http://127.0.0.1:1234')
        }

        // S6 + thread gap (pivot = assistant stream done)
        let timeLine = ''
        try {
          const {
            buildLocalTimeOneLiner,
            buildThreadTimeGapOneLiner,
            resolveThreadTimeAnchors
          } = await import('@core/conversation/local-time-context')
          const clock = buildLocalTimeOneLiner()
          const anchors = resolveThreadTimeAnchors({
            lastUserAt: lastUser?.createdAt,
            lastAssistantDoneAt: streamDoneAt,
            lastAssistantMsgAt: lastAsstMsg?.createdAt
          })
          const gap = buildThreadTimeGapOneLiner(anchors)
          timeLine = [clock, gap].filter(Boolean).join(' · ')
        } catch {
          /* */
        }

        // LMS: stick to single resident — never initiative-load a second model
        if (modelRaw && !looksOllama) {
          try {
            const { preferLmStudioResidentId, ensureLmStudioSingleResident } = await import(
              '@core/providers/lmstudio-lifecycle'
            )
            const resident = await preferLmStudioResidentId(base)
            if (resident) {
              try {
                const { isLocalModelDisabled } = await import('@core/models/disabled-local-models')
                if (!isLocalModelDisabled(resident, s.disabledLocalModels || [])) {
                  modelRaw = resident
                }
              } catch {
                modelRaw = resident
              }
            }
            await ensureLmStudioSingleResident(modelRaw, base)
          } catch {
            /* best-effort */
          }
        }

        if (modelRaw) {
          // N1 — ask model whether to speak (transparent; no user bubble)
          try {
            const decMsgs = buildInitiativeDecisionMessages({
              characterName: charName,
              personality: s.character?.personality,
              style: s.character?.style,
              relationshipRole: s.character?.relationshipRole,
              tagline: s.character?.tagline,
              tone,
              userName,
              hoursSinceLastUser: hoursSince,
              hoursSinceAssistantDone,
              unansweredInitiatives: ignoredCountRef.current,
              recentLines,
              activeGoals,
              currentFocus,
              relationshipStage: s.relationshipState?.stage,
              timeHint: timeLine || undefined
            })
            const decRaw = await generateInitiativeWithLocalLlm({
              baseUrl: base,
              model: modelRaw,
              messages: decMsgs,
              timeoutMs: 18_000
            })
            const decision = parseInitiativeDecision(decRaw || '')
            if (decision.speak && decision.text) {
              text = decision.text
              if (typeof console !== 'undefined' && console.debug) {
                console.debug('[initiative] N1 approved contextual follow-up')
              }
            } else if (!decision.speak) {
              const explicitSilence = /^\s*SILENCIO\b/i.test(decRaw || '')
              // Empty / failed format: do NOT skip — generate a real message below
              if (explicitSilence) {
                if (typeof console !== 'undefined' && console.debug) {
                  console.debug('[initiative] N1 SILENCIO', {
                    unanswered: ignoredCountRef.current,
                    raw: (decRaw || '').slice(0, 40)
                  })
                }
                ignoredCountRef.current = Math.min(8, ignoredCountRef.current + 1)
                schedule('n1-silence')
                return
              }
              if (typeof console !== 'undefined' && console.debug) {
                console.debug('[initiative] N1 ambiguous — continue to message', (decRaw || '').slice(0, 40))
              }
            }
          } catch (e) {
            if (typeof console !== 'undefined' && console.debug) {
              console.debug('[initiative] N1 decision skip — will still try message', e)
            }
          }

          // One LMS job when decision already wrote the message (avoids 2× token streams)
          if (!text) {
          const mem = s.userMemory
          const memoryBlock = [
            mem?.preferredName ? 'usuario se llama ' + mem.preferredName : '',
            ...activeGoals.map((goal) => 'objetivo activo: ' + goal),
            currentFocus ? 'enfoque del usuario: ' + currentFocus : ''
          ]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 420)
          // Proactive web: only when enabled + topic looks worth a lookup
          let webContext: string | undefined
          let initiativeWebHits = 0
          try {
            if (
              s.webSearchEnabled !== false &&
              typeof window !== 'undefined' &&
              window.kawaii?.webSearch
            ) {
              const { suggestInitiativeSearchQuery } = await import(
                '@core/tools/web-search-intent'
              )
              const q = suggestInitiativeSearchQuery({
                recentLines,
                focus: currentFocus
              })
              if (q) {
                const max = Math.min(4, Number(s.webSearchMaxResults) || 4)
                const hits = await window.kawaii.webSearch(q, max, {
                  searxngBaseUrl: (s as { searxngBaseUrl?: string }).searxngBaseUrl || ''
                })
                if (hits?.length) {
                  initiativeWebHits = hits.length
                  webContext = hits
                    .slice(0, 4)
                    .map(
                      (h, i) =>
                        `[${i + 1}] ${h.title}\n${(h.snippet || '').slice(0, 220)}${
                          h.url ? '\n' + h.url : ''
                        }`
                    )
                    .join('\n\n')
                } else {
                  webContext =
                    '(0 hits en esta consulta: ' +
                    q.slice(0, 80) +
                    ') — no inventes hallazgos.'
                }
              }
            }
          } catch {
            /* web optional for initiative */
          }

          const msgs = buildInitiativeLlmMessages({
            characterName: charName,
            personality: s.character?.personality,
            style: s.character?.style,
            relationshipRole: s.character?.relationshipRole,
            relationshipReaction: s.character?.relationshipReaction,
            traits: s.character?.traits,
            tagline: s.character?.tagline,
            visualDescription: s.character?.visualDescription,
            userName,
            recentLines,
            tone,
            hoursSinceLastUser: hoursSince,
            hoursSinceAssistantDone,
            memoryBlock: memoryBlock || undefined,
            focus: mem?.currentFocus,
            webContext,
            unansweredInitiatives: ignoredCountRef.current,
            activeGoals,
            currentFocus,
            timeHint: timeLine || undefined
          })
          const generated = await generateInitiativeWithLocalLlm({
            baseUrl: base,
            model: modelRaw,
            messages: msgs,
            timeoutMs: 28_000
          })
          const generatedDecision = parseInitiativeDecision(generated || '')
          text = generatedDecision.speak ? generatedDecision.text || null : null
          initiativeWebHitsForMeta = initiativeWebHits
          if (!text) {
            const alt =
              base.includes('11434')
                ? 'http://127.0.0.1:1234'
                : 'http://127.0.0.1:11434'
            if (alt !== base) {
              const alternate = await generateInitiativeWithLocalLlm({
                baseUrl: alt,
                model: modelRaw,
                messages: msgs,
                timeoutMs: 18_000
              })
              const alternateDecision = parseInitiativeDecision(alternate || '')
              text = alternateDecision.speak ? alternateDecision.text || null : null
            }
          }
          // No alternate-model retry: loading a second LLM for initiative wastes VRAM/RAM
          if (text && recentNudgesRef.current.some((r) => r && text!.includes(r.slice(0, 40)))) {
            text = null
          }
          } // end if (!text) message LLM

        }

        // M4 nickname proposal
        try {
          if (
            !text &&
            shouldProposeNickname({
              relationship: s.relationshipState,
              userMemory: s.userMemory,
              onboarding: s.memoryOnboarding,
              memoryGatePending: s.memoryGatePending,
              personalityBlob: [
                s.character?.personality,
                s.character?.style,
                s.character?.relationshipRole,
                s.character?.tagline,
                ...(Array.isArray(s.character?.traits) ? s.character.traits : [])
              ]
                .filter(Boolean)
                .join(' ')
            })
          ) {
            const blob = [
              s.character?.personality,
              s.character?.style,
              s.character?.relationshipRole,
              s.character?.tagline,
              ...(Array.isArray(s.character?.traits) ? s.character.traits : [])
            ]
              .filter(Boolean)
              .join(' ')
            const nick = pickNicknameProposal(s.relationshipState, s.userMemory, blob)
            if (nick) {
              text = buildNicknameProposalText(nick, s.character?.name)
              templateDraft = text
              onTemplateSent = () => {
                const mem = s.userMemory || { facts: [] }
                useSettingsStore.getState().update({
                  userMemory: { ...mem, pendingNickname: nick, updatedAt: Date.now() },
                  relationshipState: markProposalSent(s.relationshipState, nick)
                })
              }
            }
          }
        } catch {
          /* */
        }

        // C4: contextual wardrobe primary proposal (confirm in UI; never auto-change)
        let wardrobeProposeMeta: {
          itemId: string
          dataUrl: string
          title: string
          reason: string
          whyKind?: string
          mode?: string
        } | null = null
        let intimacyProposeMeta: { kind: 'emotional' | 'adult' } | null = null
        try {
          const {
            shouldProposeVisualChange,
            pickVisualProposeCandidate,
            buildVisualProposeMessage,
            weatherHintFromSettings
          } = await import('@core/image/visual-initiative')
          const galN = (s.character?.visualGallery || []).filter(
            (g: { dataUrl?: string; filePath?: string }) => g.dataUrl || g.filePath
          ).length
          const stage =
            (s.relationshipState as { stage?: string } | undefined)?.stage ||
            ''
          const persistedLast = Number(
            (s as { lastWardrobeProposeAt?: number }).lastWardrobeProposeAt || 0
          )
          const lastReject = Number(
            (s as { lastWardrobeRejectAt?: number }).lastWardrobeRejectAt || 0
          )
          const lastAt = Math.max(lastWardrobeProposeRef.current || 0, persistedLast || 0)
          let msgCount = 0
          let chatBlob = ''
          let scenePhase: string | null = null
          try {
            const { useChatStore } = await import('@shared/lib/stores/chatStore')
            const active = useChatStore.getState().getActive?.()
            msgCount = active?.messages?.length || 0
            const msgs = active?.messages || []
            chatBlob = msgs
              .slice(-8)
              .map((m: { content?: string }) => String(m.content || '').slice(0, 200))
              .join(' ')
            scenePhase =
              (active as { scenePhase?: string } | undefined)?.scenePhase ||
              (s as { intimacyScenePhase?: string }).intimacyScenePhase ||
              null
          } catch {
            msgCount = 0
          }
          const gateV = shouldProposeVisualChange({
            conversationInitiativeEnabled: s.conversationInitiativeEnabled,
            galleryCount: galN + (s.character?.visualImageUrl ? 1 : 0),
            lastProposeAt: lastAt || undefined,
            lastRejectAt: lastReject || undefined,
            relationshipStage: stage,
            relationshipRole: s.character?.relationshipRole,
            hasOtherInitiativeText: Boolean(text && String(text).trim()),
            messageCount: msgCount,
            scenePhase
          })
          if (gateV.ok) {
            try {
              const { ensureWeatherFresh } = await import('../services/ensureWeatherFresh')
              await ensureWeatherFresh()
            } catch {
              /* weather optional */
            }
            const sWeather = useSettingsStore.getState().settings
            const weather = weatherHintFromSettings(
              sWeather as {
                weatherSummary?: string
                weatherTempC?: number
                weatherCondition?: string
              }
            )
            const cand = pickVisualProposeCandidate({
              character: s.character,
              relationshipStage: stage,
              chatBlob,
              weather
            })
            if (cand) {
              text = buildVisualProposeMessage({
                characterName: s.character?.name,
                candidate: cand
              })
              templateDraft = text
              wardrobeProposeMeta = {
                itemId: cand.item.id,
                dataUrl: cand.item.dataUrl,
                title: cand.item.title,
                reason: cand.reason,
                whyKind: cand.whyKind,
                mode: cand.mode
              }
              const nowTs = Date.now()
              onTemplateSent = () => {
                lastWardrobeProposeRef.current = nowTs
                useSettingsStore.getState().update({ lastWardrobeProposeAt: nowTs })
              }
            }
          }
        } catch {
          /* visual initiative optional */
        }

        // Text-only wardrobe wish (no image generation) — rarer, C4-aligned
        try {
          if (!wardrobeProposeMeta && !text) {
            const {
              shouldProposeWardrobeWish,
              pickWardrobeWishIdea,
              buildVisualWishMessage,
              resolveDayPart
            } = await import('@core/image/visual-initiative')
            const galN = (s.character?.visualGallery || []).filter(
              (g: { dataUrl?: string; filePath?: string }) => g.dataUrl || g.filePath
            ).length
            const stage =
              (s.relationshipState as { stage?: string } | undefined)?.stage || ''
            const persistedWish = Number(
              (s as { lastWardrobeWishAt?: number }).lastWardrobeWishAt || 0
            )
            const lastWish = Math.max(lastWardrobeWishRef.current || 0, persistedWish || 0)
            const gateW = shouldProposeWardrobeWish({
              conversationInitiativeEnabled: s.conversationInitiativeEnabled,
              galleryCount: galN,
              lastWishAt: lastWish || undefined,
              relationshipStage: stage,
              hasOtherInitiativeText: Boolean(text && String(text).trim())
            })
            // Rare: N1/other initiatives first; wish is fallback only (~4%)
            if (gateW.ok && Math.random() < 0.04) {
              const wish = pickWardrobeWishIdea(recentNudgesRef.current)
              text = buildVisualWishMessage({
                characterName: s.character?.name,
                dayPart: resolveDayPart(),
                wish
              })
              templateDraft = text
              const nowW = Date.now()
              onTemplateSent = () => {
                lastWardrobeWishRef.current = nowW
                const mem = s.userMemory || { facts: [] }
                const line = 'WARDROBE_WISH: ' + wish
                const facts = [
                  ...(mem.facts || []).filter((f: string) => !String(f).startsWith('WARDROBE_WISH:')),
                  line
                ].slice(-20)
                useSettingsStore.getState().update({
                  userMemory: { ...mem, facts, updatedAt: Date.now() },
                  lastWardrobeWishAt: nowW
                } as never)
              }
            }
          }
        } catch {
          /* wish optional */
        }

        
        // Birthday (once per year) — natural, not spammy
        try {
          if (!text) {
            const { isBirthdayToday, birthdayCelebratedThisYear, buildBirthdayWish } = await import(
              '@core/conversation/birthday'
            )
            const birth = String(s.userBirthDate || '')
            if (
              isBirthdayToday(birth) &&
              !birthdayCelebratedThisYear(
                (s.relationshipState as { lastBirthdayWishAt?: number } | undefined)
                  ?.lastBirthdayWishAt
              )
            ) {
              text = buildBirthdayWish({
                userName:
                  (s.userMemory as { userName?: string } | undefined)?.userName ||
                  s.userMemory?.preferredName,
                characterName: s.character?.name
              })
              templateDraft = text
              onTemplateSent = () => {
                useSettingsStore.getState().update({
                  relationshipState: {
                    ...(s.relationshipState || {
                      stage: 'stranger',
                      acceptedNicknames: [],
                      rejectedNicknames: [],
                      turnsTogether: 0
                    }),
                    lastBirthdayWishAt: Date.now(),
                    updatedAt: Date.now()
                  }
                })
              }
            }
          }
        } catch {
          /* */
        }

// R1: intimacy proposal (emotional or adult if opt-in) — user accepts in UI
        try {
          if (!wardrobeProposeMeta && !text) {
            const {
              shouldProposeIntimacy,
              buildIntimacyProposeMessage,
              hasIntimacySoftNo
            } = await import('@core/conversation/intimacy-stage')
            const stage =
              (s.relationshipState as { stage?: string } | undefined)?.stage || ''
            const lastAt =
              (s.relationshipState as { lastIntimacyProposalAt?: number } | undefined)
                ?.lastIntimacyProposalAt || lastIntimacyProposeRef.current || undefined
            const intimacyOpen = Boolean(
              (s.relationshipState as { intimacyOpen?: boolean } | undefined)?.intimacyOpen
            )
            let recentTexts: string[] = []
            try {
              const { useChatStore } = await import('@shared/lib/stores/chatStore')
              const active = useChatStore.getState().getActive?.()
              recentTexts = (active?.messages || [])
                .slice(-10)
                .map((m: { content?: string }) => String(m.content || ''))
            } catch {
              recentTexts = []
            }
            let scenePhase = String(
              (s.relationshipState as { scenePhase?: string } | undefined)?.scenePhase || ''
            )
            try {
              const { resolveLiveIntimatePhase } = await import('@core/conversation/intimacy-memory')
              let rt: string[] = []
              try {
                const { useChatStore } = await import('@shared/lib/stores/chatStore')
                rt = (useChatStore.getState().getActive?.()?.messages || [])
                  .slice(-10)
                  .map((m: { content?: string }) => String(m.content || ''))
              } catch {
                rt = []
              }
              scenePhase = resolveLiveIntimatePhase({
                relationship: s.relationshipState,
                facts: s.userMemory?.facts,
                recentTexts: rt,
                userText: recentUserLines[recentUserLines.length - 1]
              })
            } catch {
              /* */
            }
            const preferAdult =
              Boolean(s.adultIntimacyOptIn) &&
              stage === 'intimate' &&
              !intimacyOpen &&
              Math.random() < 0.28
            // Skip if we already proposed intimacy in last ~12 assistant turns
            let recentPropose = false
            try {
              const { useChatStore } = await import('@shared/lib/stores/chatStore')
              const msgs = useChatStore.getState().getActive?.()?.messages || []
              recentPropose = msgs.slice(-16).some(
                (m: { role?: string; meta?: { kind?: string }; content?: string }) =>
                  m.role === 'assistant' &&
                  (m.meta?.kind === 'intimacy-propose' ||
                    /Solo si tú quieres|acercarme un poco más|plano más físico/i.test(
                      String(m.content || '')
                    ))
              )
            } catch {
              recentPropose = false
            }
            if (!recentPropose) {
            const gateI = shouldProposeIntimacy({
              conversationInitiativeEnabled: s.conversationInitiativeEnabled,
              adultOptIn: Boolean(s.adultIntimacyOptIn),
              stage,
              lastProposalAt: lastAt,
              boundarySoftNo: hasIntimacySoftNo(s.userMemory?.facts),
              preferAdult,
              intimacyOpen,
              recentTexts
            })
            // Formal consent ask only when gate says so — never mid-scene / already open
            if (
              scenePhase !== 'scene_active' &&
              scenePhase !== 'aftercare' &&
              gateI.ok &&
              gateI.kind &&
              Math.random() < (s.adultIntimacyOptIn ? 0.22 : 0.09)
            ) {
              text = buildIntimacyProposeMessage({
                kind: gateI.kind,
                userName: s.userMemory?.preferredName,
                characterName: s.character?.name,
                recentTexts
              })
              templateDraft = text
              intimacyProposeMeta = { kind: gateI.kind }
              onTemplateSent = () => {
                lastIntimacyProposeRef.current = Date.now()
                const rel = s.relationshipState || {}
                useSettingsStore.getState().update({
                  relationshipState: {
                    ...rel,
                    lastIntimacyProposalAt: Date.now(),
                    updatedAt: Date.now()
                  }
                })
              }
            }
            } // !recentPropose
          } // !wardrobeProposeMeta && !text
        } catch {
          /* intimacy propose optional */
        }

        // App-owned proposals may select a safe intent, but only the LLM writes the sent text.
        if (templateDraft && modelRaw) {
          const compositionMessages = buildInitiativeCompositionMessages({
            characterName: charName,
            personality: s.character?.personality,
            style: s.character?.style,
            relationshipRole: s.character?.relationshipRole,
            tone,
            draft: templateDraft,
            recentLines
          })
          const composed = await generateInitiativeWithLocalLlm({
            baseUrl: base,
            model: modelRaw,
            messages: compositionMessages,
            timeoutMs: 18_000
          })
          const compositionDecision = parseInitiativeDecision(composed || '')
          text = compositionDecision.speak ? compositionDecision.text || null : null
        }
        if (!text) {
          if (typeof console !== 'undefined' && console.debug) {
            console.debug('[initiative] no LLM message; nothing sent', {
              model: modelRaw || null,
              hadTemplateDraft: Boolean(templateDraft)
            })
          }
          schedule(modelRaw ? 'llm-empty' : 'no-model')
          return
        }
        try {
          onTemplateSent?.()
        } catch (error) {
          console.warn('[initiative] proposal state persistence failed', error)
        }

        recentNudgesRef.current = [text, ...recentNudgesRef.current].slice(0, 12)
        sentTodayRef.current.count += 1
        lastInitiativeSentRef.current = Date.now()
        scheduleAnchorRef.current = Date.now()
        store.addMessage(convId, {
          role: 'assistant',
          content: text,
          meta: {
            model: modelRaw
              ? (looksOllama ? modelRaw.split(':')[0] : modelRaw.split('/').pop()) + '·initiative'
              : 'initiative',
            provider: looksOllama ? 'ollama' : modelRaw ? 'openai-compatible' : 'app',
            route: 'local',
            reason: wardrobeProposeMeta
              ? 'Iniciativa visual · guardarropa'
              : !templateDraft && initiativeWebHitsForMeta > 0
                  ? 'Iniciativa · modelo + web (' + initiativeWebHitsForMeta + ' hits · ' + tone + ')'
                  : 'Iniciativa · modelo (' + tone + ')',
            useWebSearch: !templateDraft && initiativeWebHitsForMeta > 0,
            webHitCount:
              !templateDraft && initiativeWebHitsForMeta > 0 ? initiativeWebHitsForMeta : undefined,
            webSearchAttempted:
              !templateDraft && initiativeWebHitsForMeta > 0 ? true : undefined,
            ...(wardrobeProposeMeta
              ? {
                  kind: 'wardrobe-propose',
                  wardrobeItemId: wardrobeProposeMeta.itemId,
                  wardrobeDataUrl: wardrobeProposeMeta.dataUrl,
                  wardrobeTitle: wardrobeProposeMeta.title,
                  wardrobeReason: wardrobeProposeMeta.reason
                }
              : intimacyProposeMeta
                ? {
                    kind: 'intimacy-propose',
                    intimacyKind: intimacyProposeMeta.kind
                  }
                : {})
          }
        })
        {
          const preview = (text || '').replace(/\s+/g, ' ').trim().slice(0, 120)
          void notifyUser((charName || 'Asistente') + ' te escribió', preview || 'Nuevo mensaje de iniciativa', {
            kind: 'info',
            sticky: true,
            os: true,
            silent: false
          })
        }
        lastInitiativeSentRef.current = Date.now()
        scheduleAnchorRef.current = Date.now()
        ignoredCountRef.current = Math.min(8, ignoredCountRef.current + 1)
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[initiative] sent', text?.slice(0, 60))
        }
      } finally {
        generatingRef.current = false
        schedule('after-send')
      }
    }

    runTick = () => {
      void tick().catch((error) => {
        generatingRef.current = false
        console.error('[initiative] tick failed; rescheduling', error)
        try {
          retry(30_000)
        } catch (scheduleError) {
          console.error('[initiative] reschedule failed', scheduleError)
        }
      })
    }

    schedule('mount')
    const onStreamDone = (ev: Event) => {
      try {
        const d = (ev as CustomEvent).detail as { convId?: string }
        if (d?.convId && d.convId === useChatStore.getState().activeId) {
          schedule('assistant-stream-done')
        }
      } catch {
        /* */
      }
    }
    try {
      window.addEventListener('kawaii:assistant-stream-done', onStreamDone)
    } catch {
      /* */
    }


    // Only re-schedule when initiative-related settings change (not every store write)
    let prevInit = {
      en: useSettingsStore.getState().settings.conversationInitiativeEnabled,
      mode: useSettingsStore.getState().settings.conversationInitiativeMode,
      min: useSettingsStore.getState().settings.conversationInitiativeMinutes,
      snooze: useSettingsStore.getState().settings.conversationInitiativeSnoozeUntil,
      model: useSettingsStore.getState().settings.localModel,
      ollama: useSettingsStore.getState().settings.localBaseUrl,
      openAI: useSettingsStore.getState().settings.localOpenAIBaseUrl,
      lmStudio: (useSettingsStore.getState().settings as { lmStudioBaseUrl?: string }).lmStudioBaseUrl,
      runtime: useSettingsStore.getState().settings.localRuntimePreference,
      disabledModels: (useSettingsStore.getState().settings.disabledLocalModels || []).join('\0')
    }
    const unsub = useSettingsStore.subscribe(() => {
      const s = useSettingsStore.getState().settings
      const next = {
        en: s.conversationInitiativeEnabled,
        mode: s.conversationInitiativeMode,
        min: s.conversationInitiativeMinutes,
        snooze: s.conversationInitiativeSnoozeUntil,
        model: s.localModel,
        ollama: s.localBaseUrl,
        openAI: s.localOpenAIBaseUrl,
        lmStudio: (s as { lmStudioBaseUrl?: string }).lmStudioBaseUrl,
        runtime: s.localRuntimePreference,
        disabledModels: (s.disabledLocalModels || []).join('\0')
      }
      if (
        next.en !== prevInit.en ||
        next.mode !== prevInit.mode ||
        next.min !== prevInit.min ||
        next.snooze !== prevInit.snooze ||
        next.model !== prevInit.model ||
        next.ollama !== prevInit.ollama ||
        next.openAI !== prevInit.openAI ||
        next.lmStudio !== prevInit.lmStudio ||
        next.runtime !== prevInit.runtime ||
        next.disabledModels !== prevInit.disabledModels
      ) {
        prevInit = next
        schedule('settings-initiative')
      }
    })

    const unsubChat = useChatStore.subscribe((st, prev) => {
      const id = st.activeId
      if (!id) return
      if (st.activeId !== prev.activeId) {
        schedule('switch-conv')
        return
      }
      const conv = st.conversations.find((c) => c.id === id)
      const prevConv = prev.conversations.find((c) => c.id === id)
      if (!conv || !prevConv) return
      if (conv.messages.length <= prevConv.messages.length) return
      const last = conv.messages[conv.messages.length - 1]
      if (last?.role === 'user') {
        ignoredCountRef.current = 0
        schedule('user-msg')
        return
      }
      // Assistant finished (incl. harness): recompute remaining time, do not pile delays forever
      if (last?.role === 'assistant' && !last.isStreaming) {
        const isH =
          last.meta?.model === 'harness-host' ||
          /harness/i.test(String(last.meta?.model || ''))
        // Timer starts from assistant completion, not from user send
        scheduleAnchorRef.current = Math.max(scheduleAnchorRef.current, Date.now())
        schedule(isH ? 'post-harness' : 'assistant-done')
      }
      // Streaming ended on existing last message
      const prevLast = prevConv.messages[prevConv.messages.length - 1]
      if (
        prevLast?.role === 'assistant' &&
        prevLast.isStreaming &&
        last?.role === 'assistant' &&
        !last.isStreaming &&
        last.id === prevLast.id
      ) {
        scheduleAnchorRef.current = Math.max(scheduleAnchorRef.current, Date.now())
        schedule('assistant-stream-end')
      }
    })

    const unsubActivity = useActivityStore.subscribe((st, prev) => {
      if (prev.mode !== 'none' && st.mode === 'none') schedule('activity-end')
    })

    return () => {
      disposed = true
      clear()
      unsub()
      unsubChat()
      unsubActivity()
      try {
        window.removeEventListener('kawaii:assistant-stream-done', onStreamDone)
      } catch {
        /* */
      }
    }
  }, [enabledGate])
}
