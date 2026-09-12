import { useEffect, useRef } from 'react'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { useActivityStore } from '@shared/lib/stores/activityStore'
import {
  buildInitiativeLlmMessages,
  detectInitiativeTone,
  generateInitiativeWithLocalLlm,
  initiativeMinutesForTone,
  pickInitiativeNudge
} from '@core/conversation/initiative'

/**
 * Soft proactive messages while the app stays open and the user is idle.
 * Prefers a short local-LLM line in character; templates only as fallback.
 */
export function useConversationInitiative(enabledGate: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastNudgeRef = useRef(0)
  const recentNudgesRef = useRef<string[]>([])
  const generatingRef = useRef(false)

  useEffect(() => {
    if (!enabledGate) return
    // While a mini-game window is active, don't compete with that scene
    if (useActivityStore.getState().mode !== 'none') return

    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const resolveDelayMs = (): number | null => {
      const s = useSettingsStore.getState().settings
      if (!s.conversationInitiativeEnabled) return null
      const snoozeUntil = s.conversationInitiativeSnoozeUntil || 0
      if (snoozeUntil > Date.now()) return Math.min(60_000, snoozeUntil - Date.now() + 500)
      const tone = detectInitiativeTone({
        personality: s.character?.personality,
        style: s.character?.style,
        relationshipRole: s.character?.relationshipRole,
        traits: s.character?.traits,
        tagline: s.character?.tagline
      })
      const minutes =
        s.conversationInitiativeMode === 'fixed'
          ? Math.max(1, Math.min(120, s.conversationInitiativeMinutes || 4))
          : initiativeMinutesForTone(tone)
      return minutes * 60_000
    }

    const schedule = () => {
      clear()
      const delay = resolveDelayMs()
      if (delay == null) return
      timerRef.current = setTimeout(() => {
        void tick()
      }, delay)
    }

    const tick = async () => {
      // Re-check every fire: activity window owns the model
      if (useActivityStore.getState().mode !== 'none') {
        schedule()
        return
      }
      const s = useSettingsStore.getState().settings
      if (!s.conversationInitiativeEnabled) return
      if ((s.conversationInitiativeSnoozeUntil || 0) > Date.now()) {
        schedule()
        return
      }
      const tone = detectInitiativeTone({
        personality: s.character?.personality,
        style: s.character?.style,
        relationshipRole: s.character?.relationshipRole,
        traits: s.character?.traits,
        tagline: s.character?.tagline
      })
      const minGap =
        (s.conversationInitiativeMode === 'fixed'
          ? Math.max(1, s.conversationInitiativeMinutes || 4)
          : initiativeMinutesForTone(tone)) *
        60_000 *
        0.85
      if (Date.now() - lastNudgeRef.current < minGap) {
        schedule()
        return
      }
      const store = useChatStore.getState()
      const convId = store.activeId
      if (!convId) {
        schedule()
        return
      }
      const conv = store.conversations.find((c) => c.id === convId)
      if (!conv || conv.messages.length < 2) {
        schedule()
        return
      }
      const last = conv.messages[conv.messages.length - 1]
      if (!last || last.role !== 'assistant' || last.isStreaming) {
        schedule()
        return
      }
      if (
        last.meta?.model === 'harness-host' ||
        /Un momento, estoy revisando/i.test(last.content || '') ||
        (last.role === 'user' &&
          /\b(estado|modelos|lista|forge|diagn)\b/i.test(last.content || ''))
      ) {
        schedule()
        return
      }
      if (
        last.meta?.model === 'initiative' ||
        /initiative/i.test(String(last.meta?.model || ''))
      ) {
        schedule()
        return
      }
      if (generatingRef.current) {
        schedule()
        return
      }

      generatingRef.current = true
      try {
        const userName = s.userMemory?.preferredName || undefined
        const charName = s.character?.name || 'Kawaii'
        const recentLines = conv.messages.slice(-8).map((m) => {
          const who = m.role === 'user' ? userName || 'Usuario' : charName
          return `${who}: ${(m.content || '').slice(0, 180)}`
        })
        const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user')
        const hoursSince = lastUser?.createdAt
          ? (Date.now() - lastUser.createdAt) / 3_600_000
          : undefined

        let text: string | null = null
        const base = (s.localBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
        // Prefer settings preferred model, else probe tags for a chat-sized model
        let model =
          (s.localModel || '').trim() ||
          (s as { preferredLocalModel?: string }).preferredLocalModel ||
          (s as { localChatModel?: string }).localChatModel ||
          ''
        if (!model) {
          try {
            const tags = await fetch(`${base}/api/tags`, {
              signal: AbortSignal.timeout(4000)
            })
            if (tags.ok) {
              const data = (await tags.json()) as { models?: Array<{ name?: string }> }
              const names = (data.models || []).map((m) => m.name || '').filter(Boolean)
              model =
                names.find((n) => /qwen2\.5:14b|qwen2\.5:7b|llama3\.1:8b|mistral|gemma2/i.test(n)) ||
                names.find((n) => !/embed|vision|llava|moondream|code/i.test(n)) ||
                names[0] ||
                ''
            }
          } catch {
            /* ignore */
          }
        }

        if (model) {
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
            hoursSinceLastUser: hoursSince
          })
          text = await generateInitiativeWithLocalLlm({
            baseUrl: base,
            model,
            messages: msgs,
            timeoutMs: 50_000
          })
          // Reject if model echoed a recent nudge
          if (text && recentNudgesRef.current.some((r) => r && text!.includes(r.slice(0, 40)))) {
            text = null
          }
        }

        if (!text) {
          text = pickInitiativeNudge({
            tone,
            name: charName,
            userName,
            recentTexts: recentNudgesRef.current
          })
        }

        recentNudgesRef.current = [text, ...recentNudgesRef.current].slice(0, 8)
        store.addMessage(convId, {
          role: 'assistant',
          content: text,
          meta: {
            model: model ? `${model.split(':')[0]}·initiative` : 'initiative',
            provider: model ? 'ollama' : 'app',
            route: 'local',
            reason: model ? `Iniciativa LLM (${tone})` : `Iniciativa plantilla (${tone})`
          }
        })
        lastNudgeRef.current = Date.now()
      } finally {
        generatingRef.current = false
        schedule()
      }
    }

    const onActivity = () => schedule()
    schedule()
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)
    const unsub = useSettingsStore.subscribe(() => schedule())
    return () => {
      clear()
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
      unsub()
    }
  }, [enabledGate])
}
