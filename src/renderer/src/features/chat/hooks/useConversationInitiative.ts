import { shouldProposeNickname, pickNicknameProposal, buildNicknameProposalText, markProposalSent } from '@core/conversation/relationship-confidence'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useEffect, useRef } from 'react'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useActivityStore } from '@shared/lib/stores/activityStore'
import { notifyUser } from '@shared/lib/notify'
import {
  buildInitiativeLlmMessages,
  buildInitiativeDecisionMessages,
  parseInitiativeDecision,
  detectInitiativeTone,
  generateInitiativeWithLocalLlm,
  initiativeMinutesForTone,
  pickInitiativeNudge,
  shouldSendInitiative
} from '@core/conversation/initiative'
import { isChatBusy } from '../services/chatBusy'

/**
 * Soft proactive messages while the app stays open and the user is idle.
 * E-INIT: timer is driven by last *user* message time, not by pointer or every settings write.
 */
export function useConversationInitiative(enabledGate: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastNudgeRef = useRef(0)
  const recentNudgesRef = useRef<string[]>([])
  const generatingRef = useRef(false)
  const lastWardrobeProposeRef = useRef(0)
  const lastWardrobeWishRef = useRef(0)
  const lastIntimacyProposeRef = useRef(0)
  const ignoredCountRef = useRef(0)
  const sentTodayRef = useRef({ day: '', count: 0 })

  useEffect(() => {
    if (!enabledGate) return

    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
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
      const lastUserAt =
        [...(conv?.messages || [])].reverse().find((m) => m.role === 'user')?.createdAt || 0
      const anchor = Math.max(lastUserAt, lastNudgeRef.current)
      const dueAt = anchor + intervalMs
      const wait = dueAt - Date.now()
      // Never wait more than interval; never negative → fire soon
      if (wait <= 0) return 1500
      return Math.min(wait, intervalMs)
    }

    const schedule = (reason?: string) => {
      clear()
      if (useActivityStore.getState().mode !== 'none') return
      const delay = resolveDelayMs()
      if (delay == null) return
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[initiative] schedule', Math.round(delay / 1000) + 's', reason || '')
      }
      timerRef.current = setTimeout(() => {
        void tick()
      }, delay)
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
        clear()
        timerRef.current = setTimeout(() => void tick(), 8000)
        return
      }
      const anyStreaming = (conv.messages || []).some((m) => m.isStreaming)
      if (anyStreaming) {
        clear()
        timerRef.current = setTimeout(() => void tick(), 5000)
        return
      }
      try {
        const chain = Number(sessionStorage.getItem('kawaii-doc-auto-chain:' + convId) || '0') || 0
        if (chain > 0) {
          clear()
          timerRef.current = setTimeout(() => void tick(), 12_000)
          return
        }
      } catch {
        /* */
      }
      const lastRaw = conv.messages[conv.messages.length - 1]
      if (lastRaw?.isStreaming) {
        clear()
        timerRef.current = setTimeout(() => void tick(), 4000)
        return
      }
      if (generatingRef.current) {
        clear()
        timerRef.current = setTimeout(() => void tick(), 3000)
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
      // Do not stack initiative on initiative
      if (
        lastRaw?.meta?.model &&
        /initiative/i.test(String(lastRaw.meta.model))
      ) {
        schedule('already-initiative')
        return
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
          ? Math.max(10_000, Math.floor(fixedMin * 60_000 * 0.4))
          : 90_000
      if (lastRaw && isHarnessNoise(lastRaw)) {
        minUserIdleMs = Math.min(minUserIdleMs, fixedMin != null ? 15_000 : 45_000)
      }

      const dayKey = new Date().toISOString().slice(0, 10)
      if (sentTodayRef.current.day !== dayKey) {
        sentTodayRef.current = { day: dayKey, count: 0 }
      }

      const lastUserAt = [...conv.messages].reverse().find((m) => m.role === 'user')?.createdAt

      // Fixed mode: skip quiet hours so tests and daytime toggles work predictably
      const gate = shouldSendInitiative({
        enabled: true,
        snoozeUntil: s.conversationInitiativeSnoozeUntil,
        lastInitiativeAt: lastNudgeRef.current || undefined,
        lastUserAt,
        tone,
        ignoredCount: ignoredCountRef.current,
        sentToday: sentTodayRef.current.count,
        // Fixed tests: allow up to 12; adaptive: stage-based (maxPerDayForStage)
        maxPerDay: fixedMin != null ? 12 : undefined,
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
        const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user')
        const hoursSince = lastUser?.createdAt
          ? (Date.now() - lastUser.createdAt) / 3_600_000
          : undefined

        let text: string | null = null
        let initiativeWebHitsForMeta = 0
        const isVisionModel = (id: string) =>
          /moondream|mmproj|vision|llava|clip|minicpm-v|bakllava|\.projector/i.test(id)
        let modelRaw =
          (s.localModel || '').trim() ||
          (s as { preferredLocalModel?: string }).preferredLocalModel ||
          ''
        if (modelRaw && isVisionModel(modelRaw)) {
          // Never use vision-only models for text initiative
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
          // Same model as chat only — never pick a second resident model for initiative
          const { isLocalModelDisabled } = await import('@core/models/disabled-local-models')
          const disabled = s.disabledLocalModels || []
          const candidates = [
            (s as { preferredLocalModel?: string }).preferredLocalModel,
            (s as { lastEffectiveLocalModel?: string }).lastEffectiveLocalModel
          ]
          for (const c of candidates) {
            const id = String(c || '').trim()
            if (id && !isVisionModel(id) && !isLocalModelDisabled(id, disabled)) {
              modelRaw = id
              break
            }
          }
        }
        const looksOllama = Boolean(modelRaw && !modelRaw.includes('/'))
        // Prefer LM OpenAI port if model id looks like LM Studio path
        let base = (s.localBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
        if (modelRaw.includes('/') && !/11434/.test(base)) {
          /* keep configured base */
        } else if (modelRaw.includes('/')) {
          base = (s as { lmStudioBaseUrl?: string }).lmStudioBaseUrl?.replace(/\/$/, '') ||
            'http://127.0.0.1:1234'
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
              unansweredInitiatives: ignoredCountRef.current,
              recentLines,
              relationshipStage: s.relationshipState?.stage
            })
            const decRaw = await generateInitiativeWithLocalLlm({
              baseUrl: base,
              model: modelRaw,
              messages: decMsgs,
              timeoutMs: 18_000
            })
            const decision = parseInitiativeDecision(decRaw || '')
            if (!decision.speak) {
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
          } catch (e) {
            if (typeof console !== 'undefined' && console.debug) {
              console.debug('[initiative] N1 decision skip', e)
            }
          }

          const mem = s.userMemory
          const aMem = s.assistantMemory
          const memoryBlock = [
            mem?.preferredName ? 'usuario se llama ' + mem.preferredName : '',
            mem?.currentFocus ? 'enfoque del usuario: ' + mem.currentFocus : '',
            mem?.likes?.[0] ? 'le gusta al usuario: ' + mem.likes[0] : '',
            mem?.goals?.[0] ? 'meta: ' + mem.goals[0] : '',
            mem?.people?.[0]?.name ? 'persona cercana: ' + mem.people[0].name : '',
            aMem?.favorites?.[0] ? 'tu favorito: ' + aMem.favorites[0] : '',
            aMem?.likes?.[0] ? 'a TI te gusta: ' + aMem.likes[0] : '',
            aMem?.likes?.[1] ? 'también te gusta: ' + aMem.likes[1] : '',
            aMem?.relational?.[0] ? 'vínculo: ' + aMem.relational[0] : ''
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
                focus: mem?.currentFocus,
                likes: mem?.likes,
                favorites: aMem?.favorites || aMem?.likes
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
            memoryBlock: memoryBlock || undefined,
            focus: mem?.currentFocus,
            webContext,
            unansweredInitiatives: ignoredCountRef.current
          })
          text = await generateInitiativeWithLocalLlm({
            baseUrl: base,
            model: modelRaw,
            messages: msgs,
            timeoutMs: 28_000
          })
          initiativeWebHitsForMeta = initiativeWebHits
          if (!text) {
            const alt =
              base.includes('11434')
                ? 'http://127.0.0.1:1234'
                : 'http://127.0.0.1:11434'
            if (alt !== base) {
              text = await generateInitiativeWithLocalLlm({
                baseUrl: alt,
                model: modelRaw,
                messages: msgs,
                timeoutMs: 18_000
              })
            }
          }
          // No alternate-model retry: loading a second LLM for initiative wastes VRAM/RAM
          if (text && recentNudgesRef.current.some((r) => r && text!.includes(r.slice(0, 40)))) {
            text = null
          }
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
              const mem = s.userMemory || { facts: [] }
              useSettingsStore.getState().update({
                userMemory: { ...mem, pendingNickname: nick, updatedAt: Date.now() },
                relationshipState: markProposalSent(s.relationshipState, nick)
              })
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
            const weather = weatherHintFromSettings(
              s as {
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
              wardrobeProposeMeta = {
                itemId: cand.item.id,
                dataUrl: cand.item.dataUrl,
                title: cand.item.title,
                reason: cand.reason,
                whyKind: cand.whyKind,
                mode: cand.mode
              }
              const nowTs = Date.now()
              lastWardrobeProposeRef.current = nowTs
              try {
                useSettingsStore.getState().update({ lastWardrobeProposeAt: nowTs })
              } catch {
                /* optional persist */
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
            const gateW = shouldProposeWardrobeWish({
              conversationInitiativeEnabled: s.conversationInitiativeEnabled,
              galleryCount: galN,
              lastWishAt: lastWardrobeWishRef.current || undefined,
              relationshipStage: stage,
              hasOtherInitiativeText: Boolean(text && String(text).trim())
            })
            if (gateW.ok && Math.random() < 0.12) {
              const wish = pickWardrobeWishIdea(recentNudgesRef.current)
              text = buildVisualWishMessage({
                characterName: s.character?.name,
                dayPart: resolveDayPart(),
                wish
              })
              lastWardrobeWishRef.current = Date.now()
              // Remember wish in user memory (no gen)
              try {
                const mem = s.userMemory || { facts: [] }
                const line = 'WARDROBE_WISH: ' + wish
                const facts = [...(mem.facts || []).filter((f: string) => !String(f).startsWith('WARDROBE_WISH:')), line].slice(-20)
                useSettingsStore.getState().update({
                  userMemory: { ...mem, facts, updatedAt: Date.now() }
                })
              } catch {
                /* */
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
                recentTexts: rt
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
              Math.random() < 0.09
            ) {
              text = buildIntimacyProposeMessage({
                kind: gateI.kind,
                userName: s.userMemory?.preferredName,
                characterName: s.character?.name,
                recentTexts
              })
              intimacyProposeMeta = { kind: gateI.kind }
              lastIntimacyProposeRef.current = Date.now()
              try {
                const rel = s.relationshipState || {}
                useSettingsStore.getState().update({
                  relationshipState: {
                    ...rel,
                    lastIntimacyProposalAt: Date.now(),
                    updatedAt: Date.now()
                  }
                })
              } catch {
                /* */
              }
            }
            } // !recentPropose
          } // !wardrobeProposeMeta && !text
        } catch {
          /* intimacy propose optional */
        }

        let usedTemplate = false
        // N1: no generic template when a local model is available
        if (!text && !modelRaw) {
          usedTemplate = true
          text = pickInitiativeNudge({
            tone,
            name: charName,
            userName,
            recentTexts: recentNudgesRef.current,
            focus: s.userMemory?.currentFocus,
            memoryHint:
              s.assistantMemory?.likes?.[0] ||
              s.userMemory?.likes?.[0] ||
              s.userMemory?.people?.[0]?.name ||
              s.userMemory?.goals?.[0]
          })
        }
        if (!text) {
          if (typeof console !== 'undefined' && console.debug) {
            console.debug('[initiative] N1 no text after MENSAJE — skip send')
          }
          schedule('n1-empty')
          return
        }

        recentNudgesRef.current = [text, ...recentNudgesRef.current].slice(0, 12)
        sentTodayRef.current.count += 1
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
              : usedTemplate
                ? 'Iniciativa · respaldo (' + tone + ')'
                : !usedTemplate && initiativeWebHitsForMeta > 0
                  ? 'Iniciativa · modelo + web (' + initiativeWebHitsForMeta + ' hits · ' + tone + ')'
                  : 'Iniciativa · modelo (' + tone + ')',
            // Never claim web on template fallbacks
            useWebSearch: !usedTemplate && initiativeWebHitsForMeta > 0,
            webHitCount:
              !usedTemplate && initiativeWebHitsForMeta > 0 ? initiativeWebHitsForMeta : undefined,
            webSearchAttempted:
              !usedTemplate && initiativeWebHitsForMeta > 0 ? true : undefined,
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
        lastNudgeRef.current = Date.now()
        ignoredCountRef.current = Math.min(8, ignoredCountRef.current + 1)
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[initiative] sent', text?.slice(0, 60))
        }
      } finally {
        generatingRef.current = false
        schedule('after-send')
      }
    }

    schedule('mount')

    // Only re-schedule when initiative-related settings change (not every store write)
    let prevInit = {
      en: useSettingsStore.getState().settings.conversationInitiativeEnabled,
      mode: useSettingsStore.getState().settings.conversationInitiativeMode,
      min: useSettingsStore.getState().settings.conversationInitiativeMinutes,
      snooze: useSettingsStore.getState().settings.conversationInitiativeSnoozeUntil
    }
    const unsub = useSettingsStore.subscribe(() => {
      const s = useSettingsStore.getState().settings
      const next = {
        en: s.conversationInitiativeEnabled,
        mode: s.conversationInitiativeMode,
        min: s.conversationInitiativeMinutes,
        snooze: s.conversationInitiativeSnoozeUntil
      }
      if (
        next.en !== prevInit.en ||
        next.mode !== prevInit.mode ||
        next.min !== prevInit.min ||
        next.snooze !== prevInit.snooze
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
        schedule(isH ? 'post-harness' : 'assistant-done')
      }
    })

    const unsubActivity = useActivityStore.subscribe((st, prev) => {
      if (prev.mode !== 'none' && st.mode === 'none') schedule('activity-end')
    })

    return () => {
      clear()
      unsub()
      unsubChat()
      unsubActivity()
    }
  }, [enabledGate])
}

