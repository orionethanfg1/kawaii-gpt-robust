/**
 * A2+ — Push agenda snapshot to main; on due → notify + soft chat message.
 */
import { useEffect, useRef } from 'react'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { notifyUser } from '@shared/lib/notify'
import type { AgendaItem } from '@core/agenda'
import { buildAgendaDueChatMessage } from '@core/agenda'

export function useAgendaDue(): void {
  const items = useSettingsStore((s) => (s.settings as { agendaItems?: AgendaItem[] }).agendaItems)
  const prefs = useSettingsStore((s) => (s.settings as { agendaPrefs?: unknown }).agendaPrefs)
  const pushed = useRef<string>('')
  const postedIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const key = JSON.stringify({ n: items?.length, ids: (items || []).map((x) => x.id + x.status) })
    if (key === pushed.current) return
    pushed.current = key
    void window.kawaii?.agendaSetSnapshot?.({
      items: items || [],
      prefs: prefs || undefined
    })
  }, [items, prefs])

  useEffect(() => {
    const unDue = window.kawaii?.onAgendaDue?.((payload: unknown) => {
      const p = payload as { item?: AgendaItem; title?: string; body?: string }
      if (!p?.item) return

      void notifyUser(p.title || 'Agenda', p.body || p.item.title, {
        kind: 'info',
        sticky: true,
        os: false
      })

      const cur = useSettingsStore.getState().settings as {
        agendaItems?: AgendaItem[]
        character?: { name?: string }
        userMemory?: { preferredName?: string }
      }
      const list = [...(cur.agendaItems || [])]
      const idx = list.findIndex((x) => x.id === p.item!.id)
      if (idx >= 0) list[idx] = p.item!
      else list.unshift(p.item!)
      useSettingsStore.getState().update({ agendaItems: list } as never)

      // Soft message in active chat (once per item id per session)
      const id = p.item.id
      if (!postedIds.current.has(id)) {
        postedIds.current.add(id)
        try {
          const store = useChatStore.getState()
          let convId = store.activeId
          if (!convId) {
            convId = store.create()
          }
          if (convId) {
            const text = buildAgendaDueChatMessage(p.item, {
              characterName: cur.character?.name,
              userName: cur.userMemory?.preferredName
            })
            store.addMessage(convId, {
              role: 'assistant',
              content: text,
              meta: {
                model: 'agenda',
                provider: 'app',
                route: 'local',
                reason: p.item.type === 'talk' ? 'Agenda · plática' : 'Agenda · recordatorio',
                kind: 'agenda-due',
                agendaId: id
              }
            })
          }
        } catch (e) {
          console.warn('[agenda] chat message', e)
        }
      }
    })
    const unSync = window.kawaii?.onAgendaSync?.((payload: unknown) => {
      const p = payload as { items?: AgendaItem[] }
      if (!p?.items) return
      useSettingsStore.getState().update({ agendaItems: p.items } as never)
    })
    return () => {
      unDue?.()
      unSync?.()
    }
  }, [])
}
