/**
 * A4 — Agenda UI: list, done, snooze, cancel; prefs summary.
 */
import { useMemo, useState } from 'react'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import type { AgendaItem, AgendaPrefs, AgendaStatus } from '@core/agenda'
import { defaultAgendaPrefs, learnFromFeedback } from '@core/agenda'
import { Button } from '@shared/ui/Button'

function formatWhen(it: AgendaItem): string {
  if (it.when?.label) return it.when.label
  if (it.when?.at) {
    try {
      return new Date(it.when.at).toLocaleString('es-MX', {
        dateStyle: 'short',
        timeStyle: 'short'
      })
    } catch {
      return '—'
    }
  }
  if (it.when?.windowStart) {
    try {
      return (
        'ventana · ' +
        new Date(it.when.windowStart).toLocaleString('es-MX', {
          dateStyle: 'short',
          timeStyle: 'short'
        })
      )
    } catch {
      return 'ventana'
    }
  }
  return 'sin hora'
}

function statusLabel(s: AgendaStatus): string {
  if (s === 'pending') return 'Pendiente'
  if (s === 'due') return 'Por avisar'
  if (s === 'done') return 'Hecho'
  if (s === 'snoozed') return 'Pospuesto'
  if (s === 'cancelled') return 'Cancelado'
  return s
}

function typeLabel(t: AgendaItem['type']): string {
  if (t === 'talk') return 'Plática'
  if (t === 'reminder') return 'Recordatorio'
  return 'Evento'
}

export function AgendaMemoryPanel() {
  const settings = useSettingsStore((s) => s.settings)
  const items = (settings as { agendaItems?: AgendaItem[] }).agendaItems || []
  const prefs = ((settings as { agendaPrefs?: AgendaPrefs }).agendaPrefs ||
    defaultAgendaPrefs()) as AgendaPrefs
  const [filter, setFilter] = useState<'active' | 'all'>('active')

  const visible = useMemo(() => {
    const list = [...items].sort((a, b) => {
      const ta = a.when?.at ?? a.when?.windowStart ?? a.createdAt
      const tb = b.when?.at ?? b.when?.windowStart ?? b.createdAt
      return ta - tb
    })
    if (filter === 'all') return list
    return list.filter((x) => x.status === 'pending' || x.status === 'due' || x.status === 'snoozed')
  }, [items, filter])

  const patchItems = (next: AgendaItem[]) => {
    useSettingsStore.getState().update({ agendaItems: next } as never)
  }

  const patchPrefs = (next: AgendaPrefs) => {
    useSettingsStore.getState().update({ agendaPrefs: next } as never)
  }

  const mark = (id: string, status: AgendaStatus) => {
    const now = Date.now()
    const next = items.map((it) => {
      if (it.id !== id) return it
      if (status === 'snoozed') {
        return {
          ...it,
          status: 'snoozed' as const,
          when: {
            ...it.when,
            kind: 'relative' as const,
            at: now + 60 * 60_000,
            relativeMs: 60 * 60_000,
            label: 'en una hora (pospuesto)'
          },
          updatedAt: now
        }
      }
      return { ...it, status, updatedAt: now }
    })
    patchItems(next)
    if (status === 'done') {
      patchPrefs(learnFromFeedback(prefs, 'done'))
    } else if (status === 'snoozed') {
      patchPrefs(learnFromFeedback(prefs, 'snooze'))
    } else if (status === 'cancelled') {
      patchPrefs(learnFromFeedback(prefs, 'cancel'))
    }
  }

  const setLead = (minutes: number) => {
    patchPrefs(
      learnFromFeedback(prefs, 'set-lead', { leadMinutes: minutes })
    )
  }

  const setInsist = (style: AgendaPrefs['insistStyle']) => {
    patchPrefs({ ...prefs, insistStyle: style })
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-kawaii-text-muted leading-snug">
        Recordatorios y pláticas diferidas. El chat también puede crearlas; aquí las gestionas.
        Temas sensibles no insisten.
      </p>

      <div className="rounded-lg border border-kawaii-border bg-white/70 p-2.5 space-y-2">
        <p className="text-[11px] font-semibold text-kawaii-text">Preferencias</p>
        <div className="flex flex-wrap gap-2 items-center text-[11px]">
          <span className="text-kawaii-text-muted">Anticipación:</span>
          {[0, 5, 15, 30, 60].map((m) => (
            <button
              key={m}
              type="button"
              className={`px-2 py-0.5 rounded-full border text-[10px] ${
                (prefs.learned?.preferLead ?? prefs.defaultLeadMinutes) === m
                  ? 'bg-kawaii-pink/20 border-kawaii-pink-deep text-kawaii-pink-deep font-semibold'
                  : 'border-kawaii-border text-kawaii-text-muted'
              }`}
              onClick={() => setLead(m)}
            >
              {m === 0 ? 'Al momento' : m < 60 ? `${m} min` : '1 h'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center text-[11px]">
          <span className="text-kawaii-text-muted">Insistencia:</span>
          {(
            [
              ['once', 'Una vez'],
              ['gentle', 'Suave'],
              ['off', 'Sin insistir'],
              ['learned', 'Aprendida']
            ] as const
          ).map(([k, lab]) => (
            <button
              key={k}
              type="button"
              className={`px-2 py-0.5 rounded-full border text-[10px] ${
                prefs.insistStyle === k
                  ? 'bg-kawaii-pink/20 border-kawaii-pink-deep text-kawaii-pink-deep font-semibold'
                  : 'border-kawaii-border text-kawaii-text-muted'
              }`}
              onClick={() => setInsist(k)}
            >
              {lab}
            </button>
          ))}
        </div>
        {typeof prefs.learned?.snoozeRate === 'number' && prefs.learned.snoozeRate > 0.05 ? (
          <p className="text-[10px] text-kawaii-text-muted">
            Aprendizaje: pospones a menudo ({Math.round(prefs.learned.snoozeRate * 100)}%) — el
            estilo se suaviza solo.
          </p>
        ) : null}
      </div>

      <div className="flex gap-2 items-center">
        <button
          type="button"
          className={`text-[11px] px-2 py-0.5 rounded ${filter === 'active' ? 'font-semibold text-kawaii-pink-deep' : 'text-kawaii-text-muted'}`}
          onClick={() => setFilter('active')}
        >
          Activos
        </button>
        <button
          type="button"
          className={`text-[11px] px-2 py-0.5 rounded ${filter === 'all' ? 'font-semibold text-kawaii-pink-deep' : 'text-kawaii-text-muted'}`}
          onClick={() => setFilter('all')}
        >
          Todos
        </button>
        <span className="text-[10px] text-kawaii-text-muted ml-auto">{visible.length} ítem(s)</span>
      </div>

      {visible.length === 0 ? (
        <p className="text-[11px] text-kawaii-text-muted italic py-4 text-center">
          Nada en la agenda. Di en el chat algo como «recuérdame mañana a las 9…» o «hablamos de
          eso en un rato».
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((it) => (
            <li
              key={it.id}
              className={`rounded-lg border p-2.5 space-y-1.5 ${
                it.sensitivity === 'sensitive'
                  ? 'border-amber-200 bg-amber-50/50'
                  : 'border-kawaii-border bg-white/80'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-kawaii-text truncate">
                    {it.title || it.topic || 'Sin título'}
                  </p>
                  <p className="text-[10px] text-kawaii-text-muted">
                    {typeLabel(it.type)} · {formatWhen(it)} · {statusLabel(it.status)}
                    {it.notify?.leadMinutes != null && it.type === 'reminder'
                      ? ` · −${it.notify.leadMinutes} min`
                      : ''}
                    {it.sensitivity === 'sensitive' ? ' · sensible' : ''}
                  </p>
                </div>
              </div>
              {(it.status === 'pending' || it.status === 'due' || it.status === 'snoozed') && (
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    className="text-[10px] px-2 py-0.5"
                    onClick={() => mark(it.id, 'done')}
                  >
                    Listo
                  </Button>
                  <Button
                    className="text-[10px] px-2 py-0.5"
                    onClick={() => mark(it.id, 'snoozed')}
                  >
                    +1 h
                  </Button>
                  <Button
                    className="text-[10px] px-2 py-0.5"
                    onClick={() => mark(it.id, 'cancelled')}
                  >
                    Cancelar
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
