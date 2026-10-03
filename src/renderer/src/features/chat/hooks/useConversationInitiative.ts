import { useEffect, useRef } from 'react'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useActivityStore } from '@shared/lib/stores/activityStore'
import { notifyUser } from '@shared/lib/notify'
import {
  buildInitiativeLlmMessages,
  detectInitiativeTone,
  generateInitiativeWithLocalLlm,
  initiativeMinutesForTone,
  pickInitiativeNudge,
  shouldSendInitiative
} from '@core/conversation/initiative'

/**
 * Soft proactive messages while the app stays open and the user is idle.
 * E-INIT: timer is driven by last *user* message time, not by pointer or every settings write.
 */
export function useConversationInitiative(enabledGate: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastNudgeRef = useRef(0)
  const recentNudgesRef = useRef<string[]>([])
  const generatingRef = useRef(false)
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
      if (snoozeUntil > Date.now()) return Math.min(60_000, Math.max(1000, snoozeUntil - Date.now() + 200))

      const tone = detectInitiativeTone({
        personality: s.character?.personality,
        style: s.character?.style,
        relationshipRole: s.character?.relationshipRole,
        traits: s.character?.traits,
        tagline: s.character?.tagline
      })
      const intervalMin =
        fixedMinutes() ?? initiativeMinutesForTone(tone, { ignoredCount: ignoredCountRef.current })
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

      const lastRaw = conv.messages[conv.messages.length - 1]
      if (lastRaw?.isStreaming) {
        // Short retry — do not restart full interval
        clear()
        timerRef.current = setTimeout(() => void tick(), 4000)
        return
      }
      if (generatingRef.current) {
        clear()
        timerRef.current = setTimeout(() => void tick(), 3000)
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

      const tone = detectInitiativeTone({
        personality: s.character?.personality,
        style: s.character?.style,
        relationshipRole: s.character?.relationshipRole,
        traits: s.character?.traits,
        tagline: s.character?.tagline
      })
      const fixedMin = fixedMinutes()
      const minUserIdleMs =
        fixedMin != null
          ? Math.max(10_000, Math.floor(fixedMin * 60_000 * 0.4))
          : 90_000

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
        maxPerDay: 12,
        waitMinOverride: fixedMin,
        minUserIdleMs,
        // pass quietHours bypass via high idle only — see initiative patch
        now: Date.now()
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
        const userName = s.userMemory?.preferredName || undefined
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
        // Prefer template-first when model id looks like LM Studio (slash) — Ollama /api/chat will fail
        const modelRaw =
          (s.localModel || '').trim() ||
          (s as { preferredLocalModel?: string }).preferredLocalModel ||
          ''
        const looksOllama = modelRaw && !modelRaw.includes('/')
        const base = (s.localBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')

        if (looksOllama && modelRaw) {
          const mem = s.userMemory
          const memoryBlock = [
            mem?.preferredName ? 'nombre: ' + mem.preferredName : '',
            mem?.currentFocus ? 'enfoque: ' + mem.currentFocus : ''
          ]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 220)
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
            focus: mem?.currentFocus
          })
          text = await generateInitiativeWithLocalLlm({
            baseUrl: base,
            model: modelRaw,
            messages: msgs,
            timeoutMs: 12_000
          })
          if (text && recentNudgesRef.current.some((r) => r && text!.includes(r.slice(0, 40)))) {
            text = null
          }
        }

        if (!text) {
          text = pickInitiativeNudge({
            tone,
            name: charName,
            userName,
            recentTexts: recentNudgesRef.current,
            focus: s.userMemory?.currentFocus,
            memoryHint:
              s.userMemory?.likes?.[0] ||
              s.userMemory?.people?.[0]?.name ||
              s.userMemory?.goals?.[0]
          })
        }

        recentNudgesRef.current = [text, ...recentNudgesRef.current].slice(0, 12)
        sentTodayRef.current.count += 1
        store.addMessage(convId, {
          role: 'assistant',
          content: text,
          meta: {
            model: looksOllama && modelRaw ? modelRaw.split(':')[0] + '·initiative' : 'initiative',
            provider: looksOllama && modelRaw ? 'ollama' : 'app',
            route: 'local',
            reason: looksOllama && modelRaw ? 'Iniciativa LLM (' + tone + ')' : 'Iniciativa plantilla (' + tone + ')'
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
        schedule('assistant-done')
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
