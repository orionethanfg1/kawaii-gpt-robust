import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  Conversation,
  Message,
  createConversationId,
  createMessageId,
  smartConversationTitle
} from '@core/conversation'

const MAX_PERSISTED_IMAGE_CHARS = 120_000
const MAX_PERSISTED_IMAGE_CHARS_PER_ITEM = 80_000
/** Full books in textContent blow localStorage (~5MB); keep pointer + short preview */
const MAX_PERSISTED_DOC_TEXT_CHARS = 4_000
const MAX_PERSISTED_MESSAGES_PER_CONV = 120
const MAX_PERSISTED_CONVERSATIONS = 30
/** Hard cap for a single localStorage write (~4.5MB safe under typical 5MB quota) */
const MAX_LS_JSON_CHARS = 4_200_000

export function thinPersistedConversations(conversations: Conversation[]): Conversation[] {
  const sorted = [...conversations].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  )
  return sorted.slice(0, MAX_PERSISTED_CONVERSATIONS).map((conversation) => {
    const msgs = conversation.messages || []
    const trimmed =
      msgs.length > MAX_PERSISTED_MESSAGES_PER_CONV
        ? msgs.slice(msgs.length - MAX_PERSISTED_MESSAGES_PER_CONV)
        : msgs
    return {
      ...conversation,
      messages: trimmed.map((message) => ({
        ...message,
        isStreaming: false,
        content:
          typeof message.content === 'string' && message.content.length > 80_000
            ? message.content.slice(0, 80_000) + '\n…[truncado al guardar]'
            : message.content,
        attachments: message.attachments?.map((attachment) => {
          const text = attachment.textContent || ''
          const hasPath = Boolean(attachment.filePath && String(attachment.filePath).length > 4)
          // P1: always prefer disk when filePath exists (avoid QuotaExceeded)
          if (hasPath) {
            const keep = Math.min(400, text.length)
            return {
              ...attachment,
              textContent:
                keep > 0
                  ? text.slice(0, keep) +
                    (text.length > keep
                      ? `\n…[completo en disco]`
                      : '')
                  : undefined
            }
          }
          if (text.length > MAX_PERSISTED_DOC_TEXT_CHARS) {
            return {
              ...attachment,
              textContent:
                text.slice(0, MAX_PERSISTED_DOC_TEXT_CHARS) +
                `\n…[truncado al guardar: +${text.length - MAX_PERSISTED_DOC_TEXT_CHARS} caracteres]`
            }
          }
          return attachment
        })
      }))
    }
  })
}

export function capPersistedConversationImages(conversations: Conversation[]): Conversation[] {
  const candidates = conversations.flatMap((conversation) =>
    conversation.messages.flatMap((message) =>
      (message.attachments || [])
        .filter(
          (attachment) =>
            attachment.mimeType.startsWith('image/') &&
            Boolean(attachment.dataUrl) &&
            !attachment.filePath &&
            attachment.dataUrl!.length <= MAX_PERSISTED_IMAGE_CHARS_PER_ITEM
        )
        .map((attachment) => ({
          id: attachment.id,
          createdAt: message.createdAt,
          length: attachment.dataUrl!.length
        }))
    )
  )
  candidates.sort((a, b) => b.createdAt - a.createdAt)

  const retained = new Set<string>()
  let remaining = MAX_PERSISTED_IMAGE_CHARS
  for (const candidate of candidates) {
    if (candidate.length > remaining) continue
    retained.add(candidate.id)
    remaining -= candidate.length
  }

  return conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      isStreaming: false,
      attachments: message.attachments?.map((attachment) => {
        if (!attachment.mimeType.startsWith('image/') || !attachment.dataUrl) return attachment
        const filePath = attachment.filePath ||
          (message.meta?.imageFilePath ? String(message.meta.imageFilePath) : undefined)
        if (filePath) return { ...attachment, filePath, dataUrl: undefined }
        if (!retained.has(attachment.id)) return { ...attachment, dataUrl: undefined }
        return attachment
      })
    }))
  }))
}

interface ChatState {
  conversations: Conversation[]
  activeId: string | null
  create: (title?: string) => string
  remove: (id: string) => void
  setActive: (id: string | null) => void
  rename: (id: string, title: string) => void
  setPrivate: (id: string, isPrivate: boolean) => void
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

      setActive: (id) => {
        void import('@core/routing/intimate-sticky')
          .then((m) => m.onConversationChanged(id))
          .catch(() => {
            /* optional */
          })
        set({ activeId: id })
      },

      rename: (id, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: Date.now() } : c
          )
        })),
      setPrivate: (id, isPrivate) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, isPrivate, updatedAt: Date.now() } : c
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
              // Old titles were often a raw truncation of the first message
              const looksRawFirst =
                userTurns[0] &&
                c.title.length >= 20 &&
                userTurns[0].content.replace(/\s+/g, ' ').trim().startsWith(
                  c.title.replace(/…$/, '').trim().slice(0, 18)
                )
              if (
                userTurns.length === 1 ||
                (userTurns.length <= 4 && (isDefault || looksRawFirst))
              ) {
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
                m.id === msgId ? { ...m, ...patch, meta: { ...(m.meta || {}), ...((patch as { meta?: object }).meta || {}) } } : m
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
      partialize: (s) => {
        const cleaned = s.conversations.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.filter(
            (message) => !(message.isStreaming && !message.content)
          )
        }))
        // Note full bodies for disk spill — never spill the thinned LS copy
        try {
          void import('@features/chat/services/chatDiskSpill').then((m) => {
            m.noteFullConversationsForSpill(cleaned)
            m.scheduleSpillConversations(cleaned)
          })
        } catch {
          /* */
        }
        // Keep up to MAX messages in LS (no hard cut to 40 — that caused history loss)
        return {
          conversations: capPersistedConversationImages(thinPersistedConversations(cleaned)),
          activeId: s.activeId
        }
      },
      storage: createJSONStorage(() => {
        let pending: { name: string; value: string } | null = null
        let timer: ReturnType<typeof setTimeout> | null = null
        let lastFailLog = 0
        let lastOkSpill = 0

        const spill = () => {
          const now = Date.now()
          if (now - lastOkSpill < 4_000) return
          lastOkSpill = now
          try {
            void import('@features/chat/services/chatDiskSpill').then((m) => {
              m.scheduleSpillLatestFull()
            })
          } catch {
            /* */
          }
        }

        const tryWrite = (json: string): boolean => {
          try {
            if (json.length > MAX_LS_JSON_CHARS) return false
            localStorage.setItem('kawaii-chats-v1', json)
            return true
          } catch {
            return false
          }
        }

        const freeSpace = () => {
          try {
            const keys: string[] = []
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i)
              if (k) keys.push(k)
            }
            const sized = keys
              .map((k) => {
                try {
                  return { k, n: (localStorage.getItem(k) || '').length }
                } catch {
                  return { k, n: 0 }
                }
              })
              .sort((a, b) => b.n - a.n)
            for (const { k, n } of sized) {
              if (k === 'kawaii-chats-v1') continue
              if (
                n > 50_000 &&
                (k.includes('chat') ||
                  k.includes('zustand') ||
                  (k.startsWith('kawaii-') &&
                    k !== 'kawaii-settings-v2' &&
                    k !== 'kawaii-character-v1'))
              ) {
                try {
                  localStorage.removeItem(k)
                } catch {
                  /* */
                }
              }
            }
            try {
              const sk = 'kawaii-settings-v2'
              const raw = localStorage.getItem(sk)
              if (raw && raw.length > 1_500_000) {
                localStorage.removeItem(sk)
                console.warn('[chatStore] liberó kawaii-settings-v2 (LS overflow)')
              }
            } catch {
              /* */
            }
          } catch {
            /* */
          }
        }

        const flushWrite = (name: string, value: string) => {
          if (/"isStreaming"\s*:\s*true/.test(value)) {
            spill()
            return
          }
          if (tryWrite(value)) {
            spill()
            return
          }
          spill()
          freeSpace()
          try {
            const parsed = JSON.parse(value) as {
              state?: { conversations?: Conversation[]; activeId?: string | null }
              version?: number
            }
            const activeId = parsed?.state?.activeId ?? null
            const cons = parsed?.state?.conversations || []
            const stripHeavy = (list: Conversation[], msgTail: number, contentCap: number) =>
              list.map((c) => ({
                ...c,
                messages: (c.messages || []).slice(-msgTail).map((m) => ({
                  ...m,
                  isStreaming: false,
                  content:
                    typeof m.content === 'string' && m.content.length > contentCap
                      ? m.content.slice(0, contentCap) + '…[cuota]'
                      : m.content,
                  attachments: m.attachments?.map((a) => ({
                    name: a.name,
                    mimeType: a.mimeType,
                    id: a.id,
                    filePath: a.filePath,
                    dataUrl: undefined,
                    textContent:
                      a.textContent && a.textContent.length > 120
                        ? a.textContent.slice(0, 120) + '…'
                        : a.textContent
                  }))
                }))
              }))
            const pack = (list: Conversation[]) =>
              JSON.stringify({
                state: { conversations: list, activeId },
                version: parsed?.version ?? 0
              })
            try {
              localStorage.removeItem(name)
            } catch {
              /* */
            }
            const tiers: Array<[Conversation[], number, number, string]> = [
              [cons.slice(0, 8), 25, 8_000, 't1'],
              [cons.slice(0, 3), 15, 4_000, 't2'],
              [cons.filter((c) => c.id === activeId).slice(0, 1), 12, 3_000, 't3'],
              [cons.filter((c) => c.id === activeId).slice(0, 1), 6, 1_500, 't4']
            ]
            for (const [list, tail, cap, label] of tiers) {
              if (tryWrite(pack(stripHeavy(list, tail, cap)))) {
                console.warn('[chatStore] cuota recuperada:', label)
                return
              }
            }
            const mini = pack([
              {
                id: activeId || 'recovery',
                title: 'Recuperar con botón lateral',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                messages: []
              } as Conversation
            ])
            if (tryWrite(mini)) {
              console.warn('[chatStore] cuota: marcador — usa Recuperar chats')
              return
            }
            const now = Date.now()
            if (now - lastFailLog > 20_000) {
              lastFailLog = now
              console.error(
                '[chatStore] LS lleno. Memoria+disco OK. Application→Local Storage: borra claves grandes o «Recuperar chats».'
              )
            }
          } catch (e2) {
            const now = Date.now()
            if (now - lastFailLog > 20_000) {
              lastFailLog = now
              console.error('[chatStore] no se pudo persistir chats', e2)
            }
          }
        }

        return {
          getItem: (name: string) => {
            try {
              return localStorage.getItem(name)
            } catch {
              return null
            }
          },
          setItem: (name: string, value: string) => {
            pending = { name, value }
            if (/"isStreaming"\s*:\s*true/.test(value)) {
              spill()
              return
            }
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
              timer = null
              if (!pending) return
              const p = pending
              pending = null
              flushWrite(p.name, p.value)
            }, 900)
          },
          removeItem: (name: string) => {
            try {
              localStorage.removeItem(name)
            } catch {
              /* */
            }
          }
        }
      })
    }
  )
)
