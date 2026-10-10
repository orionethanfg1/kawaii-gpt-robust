/**
 * Agenda chat helpers.
 * Create reminders: NEVER short-circuit the LLM — only upsert happens in orchestrator.
 * Optional: «listo» / «posponer» as light commands (still human tone).
 */
import { learnFromFeedback, type AgendaItem } from '@core/agenda'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import type { ChatShortcutDeps } from './chatLocalShortcuts'

function ensureConv(deps: ChatShortcutDeps): string {
  let id = deps.activeId
  if (!id) id = deps.create()
  return id
}

function tryCompleteFromChat(text: string): boolean {
  const t = text.toLowerCase().trim()
  if (/^(listo|hecho|ok listo)\.?$/i.test(t)) return true
  if (/\b(ya lo hice|m[aá]rcalo (como )?listo|m[aá]rcarlo listo)\b/i.test(t)) return true
  if (/^ya (est[aá]|qued[oó]|termin[eé])/i.test(t)) return true
  return false
}

function trySnoozeFromChat(text: string): number | null {
  const t = text.toLowerCase().trim()
  if (
    !/\b(pospon|posponer|snooze)\b/i.test(t) &&
    !/^(más tarde|posponer|en un rato)\.?$/i.test(t)
  ) {
    return null
  }
  const m = t.match(/(\d+)\s*min/)
  if (m) return Math.min(180, Math.max(1, parseInt(m[1], 10))) * 60_000
  if (/\bhora\b/.test(t)) return 60 * 60_000
  return 60 * 60_000
}

function pickTarget(items: AgendaItem[]): AgendaItem | null {
  const open = items.filter(
    (x) => x.status === 'due' || x.status === 'pending' || x.status === 'snoozed'
  )
  if (!open.length) return null
  open.sort((a, b) => {
    if (a.status === 'due' && b.status !== 'due') return -1
    if (b.status === 'due' && a.status !== 'due') return 1
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })
  return open[0]
}

/**
 * Returns true only for explicit listo/posponer commands.
 * Reminder *create* always returns false so the LLM answers naturally.
 */
export function tryAgendaChatShortcut(
  trimmed: string,
  hasAtt: boolean,
  _attachments: unknown,
  deps: ChatShortcutDeps
): boolean {
  if (hasAtt) return false
  const text = (trimmed || '').trim()
  if (!text || text.length > 120) return false

  const settings = useSettingsStore.getState().settings as {
    agendaItems?: AgendaItem[]
    agendaPrefs?: import('@core/agenda').AgendaPrefs
  }
  const prev = settings.agendaItems || []

  if (tryCompleteFromChat(text)) {
    const target = pickTarget(prev)
    if (!target) return false
    const next = prev.map((x) =>
      x.id === target.id ? { ...x, status: 'done' as const, updatedAt: Date.now() } : x
    )
    const prefs = learnFromFeedback(settings.agendaPrefs, 'done')
    useSettingsStore.getState().update({ agendaItems: next, agendaPrefs: prefs } as never)
    const convId = ensureConv(deps)
    deps.addMessage(convId, { role: 'user', content: text })
    deps.addMessage(convId, {
      role: 'assistant',
      content: `Sale, «${target.title}» queda listo. ¿Seguimos con otra cosa?`,
      meta: {
        model: 'agenda',
        provider: 'app',
        route: 'local',
        reason: 'Agenda · listo'
      }
    })
    return true
  }

  const snoozeMs = trySnoozeFromChat(text)
  if (snoozeMs != null) {
    const target = pickTarget(prev)
    if (!target) return false
    const next = prev.map((x) =>
      x.id === target.id
        ? {
            ...x,
            status: 'snoozed' as const,
            when: {
              ...x.when,
              kind: 'relative' as const,
              at: Date.now() + snoozeMs,
              relativeMs: snoozeMs,
              label:
                snoozeMs >= 3600000
                  ? 'en una hora'
                  : `en ${Math.round(snoozeMs / 60000)} min`
            },
            updatedAt: Date.now()
          }
        : x
    )
    const prefs = learnFromFeedback(settings.agendaPrefs, 'snooze')
    useSettingsStore.getState().update({ agendaItems: next, agendaPrefs: prefs } as never)
    const convId = ensureConv(deps)
    deps.addMessage(convId, { role: 'user', content: text })
    deps.addMessage(convId, {
      role: 'assistant',
      content: `Claro, lo dejamos un rato. Te aviso de «${target.title}» después.`,
      meta: {
        model: 'agenda',
        provider: 'app',
        route: 'local',
        reason: 'Agenda · pospuesto'
      }
    })
    return true
  }

  // Create / talk / clarify → never handle here (LLM + orchestrator)
  return false
}
