/**
 * A2 — IPC for agenda snapshot + scheduler lifecycle
 */
import { ipcMain } from 'electron'
import {
  agendaSetSnapshot,
  agendaGetSnapshot,
  startAgendaScheduler,
  stopAgendaScheduler
} from '../agenda-scheduler'
import type { AgendaItem, AgendaPrefs } from '../../core/agenda/types'

export function registerAgendaIpc(): void {
  ipcMain.handle(
    'agenda:setSnapshot',
    (_e, payload: { items?: AgendaItem[]; prefs?: AgendaPrefs }) => {
      agendaSetSnapshot(payload?.items, payload?.prefs)
      startAgendaScheduler()
      return { ok: true, count: agendaGetSnapshot().length }
    }
  )
  ipcMain.handle('agenda:getSnapshot', () => {
    return { ok: true, items: agendaGetSnapshot() }
  })
  ipcMain.handle('agenda:start', () => {
    startAgendaScheduler()
    return { ok: true }
  })
  ipcMain.handle('agenda:stop', () => {
    stopAgendaScheduler()
    return { ok: true }
  })
}
