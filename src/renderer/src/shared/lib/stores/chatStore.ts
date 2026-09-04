import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  Conversation,
  Message,
  createConversationId,
  createMessageId,
  titleFromContent,
  smartConversationTitle
} from '@core/conversation'

interface ChatState {
  conversations: Conversation[]
  activeId: string | null
  create: (title?: string) => string
  remove: (id: string) => void
  setActive: (id: string | null) => void
  rename: (id: string, title: string) => void
  clearMessages: (id: string) => void
  addMessage: (convId: string, msg: Omit<Message, 'id' | 'createdAt'> & { id?: string }) => string
  updateMessage: (
    convId: string,
    msgId: string,
    patch: Partial<Pick<Message, 'content' | 'isStreaming' | 'meta' | 'attachments'>>
  ) => void
  deleteMessage: (convId: string, msgId: string) => void
  /** Delete message and all after it (for resend from a point) */
  deleteMessagesFrom: (convId: string, msgId: string) => void
  getActive: () => Conversation | undefined
  setRollingSummary: (
    id: string,
    summary: string,
    coveredCount: number,
    source: 'model' | 'heuristic'
  ) => void
  /** Merge imported conversations; regenerate ids that collide */
  importConversations: (incoming: Conversation[], mode?: 'merge' | 'replace') => number
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,

      create: (title) => {
        const id = createConversationId()
        const now = Date.now()
        const conv: Conversation = {
          id,
          title: title ?? 'Nueva conversación',
          createdAt: now,
          updatedAt: now,
          messages: []
        }
        set((s) => ({
          conversations: [conv, ...s.conversations],
          activeId: id
        }))
        return id
      },

      remove: (id) =>
        set((s) => {
          const next = s.conversations.filter((c) => c.id !== id)
          const activeId =
            s.activeId === id ? (next[0]?.id ?? null) : s.activeId
          return { conversations: next, activeId }
        }),

      setActive: (id) => set({ activeId: id }),

      rename: (id, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: Date.now() } : c
          )
        })),

      clearMessages: (id) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, messages: [], updatedAt: Date.now() } : c
          )
        })),

      addMessage: (convId, msg) => {
        const id = msg.id ?? createMessageId()
        const full: Message = {
          ...msg,
          id,
          createdAt: Date.now()
        }
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c
            const messages = [...c.messages, full]
            let title = c.title
            const nextMessages = messages
            if (msg.role === 'user') {
              const userTurns = nextMessages.filter((m) => m.role === 'user')
              const isDefault =
                !c.title ||
                c.title === 'Nueva conversación' ||
                /^(hola|hi|hello)([\s,!.…]|$)/i.test(c.title)
              if (userTurns.length === 1 || (userTurns.length <= 3 && isDefault)) {
                title = smartConversationTitle(
                  userTurns.map((m) => ({ role: m.role, content: m.content }))
                )
              }
            }
            return { ...c, messages, title, updatedAt: Date.now() }
          })
        }))
        return id
      },

      updateMessage: (convId, msgId, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c
            return {
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, ...patch } : m
              )
            }
          })
        })),

      deleteMessage: (convId, msgId) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c
            return {
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.filter((m) => m.id !== msgId)
            }
          })
        })),

      deleteMessagesFrom: (convId, msgId) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c
            const idx = c.messages.findIndex((m) => m.id === msgId)
            if (idx < 0) return c
            return {
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.slice(0, idx)
            }
          })
        })),

      getActive: () => {
        const { conversations, activeId } = get()
        return conversations.find((c) => c.id === activeId)
      },

      setRollingSummary: (id, summary, coveredCount, source) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id
              ? {
                  ...c,
                  rollingSummary: summary,
                  summaryCoveredCount: coveredCount,
                  summarySource: source,
                  summaryUpdatedAt: Date.now(),
                  updatedAt: Date.now()
                }
              : c
          )
        })),

      importConversations: (incoming, mode = 'merge') => {
        if (!incoming.length) return 0
        const withFreshIds = incoming.map((c) => {
          const existing = get().conversations.some((x) => x.id === c.id)
          if (!existing && mode === 'merge') return c
          if (mode === 'replace') return c
          return {
            ...c,
            id: createConversationId(),
            messages: c.messages.map((m) => ({
              ...m,
              id: createMessageId()
            }))
          }
        })
        if (mode === 'replace') {
          set({
            conversations: withFreshIds,
            activeId: withFreshIds[0]?.id ?? null
          })
          return withFreshIds.length
        }
        set((s) => {
          const ids = new Set(s.conversations.map((c) => c.id))
          const toAdd = withFreshIds.map((c) => {
            if (!ids.has(c.id)) return c
            return {
              ...c,
              id: createConversationId(),
              messages: c.messages.map((m) => ({ ...m, id: createMessageId() }))
            }
          })
          return {
            conversations: [...toAdd, ...s.conversations],
            activeId: toAdd[0]?.id ?? s.activeId
          }
        })
        return withFreshIds.length
      }
    }),
    {
      name: 'kawaii-chats-v1',
      partialize: (s) => ({
        conversations: s.conversations.map((c) => ({
          ...c,
          // never persist streaming ghosts; cap image dataUrls to limit quota errors
          messages: c.messages
            .filter((m) => !(m.isStreaming && !m.content))
            .map((m) => {
              const MAX_DATA_URL = 1_500_000 // ~1.5MB chars
              const attachments = m.attachments?.map((a) => {
                if (a.dataUrl && a.dataUrl.length > MAX_DATA_URL) {
                  return { ...a, dataUrl: undefined }
                }
                return a
              })
              return { ...m, isStreaming: false, attachments }
            })
        })),
        activeId: s.activeId
      })
    }
  )
)
