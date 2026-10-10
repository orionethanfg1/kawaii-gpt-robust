/**
 * Host-owned early paths in sendMessage (clear data, feedback, snooze).
 * Returns true if the turn was fully handled (caller should return).
 */
import {
  looksLikeFeedbackReportRequest,
  looksLikeFeedbackExplainRequest,
  feedbackStatsIncludingArchives,
  buildFeedbackDiagnosticBundle,
  classifyClearDataIntent,
  clearFeedbackArchivesOnly,
  clearFeedbackReports,
  archiveActiveAfterExport
} from '@core/feedback'
import { parseInitiativeSnooze } from '@core/conversation/initiative'
import { parseAgendaIntent } from '@core/agenda'
import { tryAgendaChatShortcut } from './agendaChatShortcut'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { APP_VERSION } from '../../../../../shared/version'
import type { Attachment } from '@core/conversation'

export type ChatShortcutDeps = {
  activeId: string | null
  create: () => string
  addMessage: (
    convId: string,
    msg: {
      role: 'user' | 'assistant'
      content: string
      isStreaming?: boolean
      attachments?: Attachment[]
      meta?: Record<string, unknown>
    }
  ) => string
  updateMessage: (
    convId: string,
    msgId: string,
    patch: { content?: string; isStreaming?: boolean; meta?: Record<string, unknown> }
  ) => void
}

export async function tryChatLocalShortcuts(
  trimmed: string,
  hasAtt: boolean,
  attachments: Attachment[] | undefined,
  deps: ChatShortcutDeps
): Promise<boolean> {
  const { activeId, create, addMessage, updateMessage } = deps

  // Agenda: create / listo / posponer sin pasar por el LLM
  try {
    if (tryAgendaChatShortcut(trimmed, hasAtt, attachments, deps)) {
      return true
    }
  } catch {
    /* fall through */
  }

  // Limpieza diferenciada: exports en disco vs archivos vs activos
  {
    const clearIntent = classifyClearDataIntent(trimmed)
    if (clearIntent !== 'none') {
      let convId = activeId
      if (!convId) convId = create()
      addMessage(convId, { role: 'user', content: trimmed })
      const assistantId = addMessage(convId, {
        role: 'assistant',
        content: 'Limpiando…',
        isStreaming: true
      })
      try {
        const parts: string[] = []
        if (clearIntent === 'exports_only' || clearIntent === 'feedback_all') {
          const r = await window.kawaii?.diagnosticsClearExports?.()
          parts.push(
            `Archivos exportados en disco: **${r?.removed ?? 0}** eliminados` +
              (r?.dir ? ` (\`${r.dir}\`)` : '')
          )
        }
        if (clearIntent === 'feedback_archives' || clearIntent === 'feedback_all') {
          const n = clearFeedbackArchivesOnly()
          parts.push(`Archivos de feedback (localStorage): **${n}** lote(s) borrados`)
        }
        if (clearIntent === 'feedback_active' || clearIntent === 'feedback_all') {
          clearFeedbackReports()
          parts.push('Likes/dislikes **activos** del chat: vaciados')
        }
        const hint =
          clearIntent === 'exports_only'
            ? '\n\n_Solo toqué informes en disco. Los 👍/👎 del chat siguen activos._'
            : clearIntent === 'feedback_archives'
              ? '\n\n_Solo archivos. Los likes activos del chat se mantienen (los tests ya no verán lotes viejos)._'
              : clearIntent === 'feedback_active'
                ? '\n\n_Solo activos. Archivos e informes en disco no se tocaron._'
                : '\n\n_Limpieza completa: disco + archivos + activos._'
        updateMessage(convId, assistantId, {
          content: parts.join('\n') + hint,
          isStreaming: false,
          meta: { route: 'diagnostics', reason: `clear:${clearIntent}` }
        })
      } catch (e) {
        updateMessage(convId, assistantId, {
          content: `No pude limpiar: ${e instanceof Error ? e.message : String(e)}`,
          isStreaming: false,
          meta: { isError: true }
        })
      }
      return true
    }
  }

  if (trimmed && looksLikeFeedbackExplainRequest(trimmed)) {
    let convId = activeId
    if (!convId) convId = create()
    addMessage(convId, { role: 'user', content: trimmed })
    const stats = feedbackStatsIncludingArchives()
    const content =
      'Los **likes (👍)** y **dislikes (👎)** de esta app no son «comentarios del chat»: son valoraciones sobre mis respuestas o imágenes.\n\n' +
      '- 👍 = te gustó (texto o foto); las fotos con like se guardan como referencia de identidad.\n' +
      '- 👎 = no te convenció; ayuda a ajustar estilo o a regenerar.\n' +
      '- Puedes pedir un **resumen / informe** de likes y dislikes cuando quieras.\n\n' +
      `Ahora mismo: **${stats.likes}** likes · **${stats.dislikes}** dislikes` +
      (stats.imageDislikes ? ` (imágenes 👎: ${stats.imageDislikes})` : '') +
      '.'
    addMessage(convId, {
      role: 'assistant',
      content,
      isStreaming: false,
      meta: { route: 'diagnostics', reason: 'feedback-explain' }
    })
    return true
  }

  if (trimmed && looksLikeFeedbackReportRequest(trimmed)) {
    let convId = activeId
    if (!convId) convId = create()
    addMessage(convId, { role: 'user', content: trimmed })
    const assistantId = addMessage(convId, {
      role: 'assistant',
      content: 'Preparando informe de feedback…',
      isStreaming: true
    })
    try {
      let paths: Array<{ id: string; label: string; path: string }> = []
      try {
        const r = await window.kawaii?.diagnosticsListPaths?.()
        if (r?.ok && Array.isArray(r.paths)) paths = r.paths
      } catch {
        /* */
      }
      const content = buildFeedbackDiagnosticBundle({
        limit: 120,
        appVersion: APP_VERSION,
        userDataPaths: paths
      })
      let saved = ''
      try {
        const w = await window.kawaii?.diagnosticsWriteTextFile?.({
          fileName: `informe-feedback-${new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[:T]/g, '-')}.md`,
          content,
          subdir: 'diagnostics'
        })
        if (w?.ok && w.filePath) {
          saved = w.filePath
          try {
            await window.kawaii?.filesOpenPath?.(w.dir || w.filePath)
          } catch {
            /* */
          }
          try {
            archiveActiveAfterExport('export-informe-chat')
          } catch {
            /* */
          }
        }
      } catch {
        /* */
      }
      const pathBlock =
        paths.length > 0
          ? '\n\n**Rutas de datos / logs:**\n' +
            paths.map((p) => `- **${p.label}:** \`${p.path}\``).join('\n')
          : ''
      updateMessage(convId, assistantId, {
        content:
          `Listo. Informe de 👍/👎 generado.` +
          (saved ? `\n\n**Archivo:** \`${saved}\`` : '') +
          pathBlock +
          '\n\n_También puedes copiar el contenido desde localStorage `kawaii-gpt-feedback-v1`._' +
          '\n\n---\n\n' +
          content.slice(0, 6000) +
          (content.length > 6000 ? '\n\n…(truncado en chat; el archivo tiene el completo)' : ''),
        isStreaming: false,
        meta: { route: 'diagnostics', reason: 'feedback-report' }
      })
    } catch (e) {
      updateMessage(convId, assistantId, {
        content: `No pude generar el informe: ${e instanceof Error ? e.message : String(e)}`,
        isStreaming: false,
        meta: { isError: true }
      })
    }
    return true
  }

  // Initiative snooze — may return handled for short pure commands only
  try {
    // Don't steal reminder/agenda phrases
    try {
      const ag = parseAgendaIntent(trimmed)
      if (ag.ok && ag.intent === 'create') {
        return false
      }
    } catch {
      /* ignore */
    }
    const snooze = parseInitiativeSnooze(trimmed)
    if (snooze) {
      const until = Date.now() + snooze.ms
      useSettingsStore.getState().update({
        conversationInitiativeSnoozeUntil: until,
        conversationInitiativeEnabled: true
      })
      let convId = activeId
      if (!convId) convId = create()
      addMessage(convId, {
        role: 'user',
        content: trimmed || '📷',
        attachments: hasAtt ? attachments : undefined
      })
      const ack =
        snooze.kind === 'silence'
          ? `De acuerdo… me quedo en silencio unos ${snooze.label}. Cuando quieras, me escribes.`
          : snooze.kind === 'busy'
            ? `Entendido, te dejo espacio (~${snooze.label}). Aquí estaré cuando puedas.`
            : `Sale, te espero ${snooze.label}. No te interrumpo 💕`
      addMessage(convId, {
        role: 'assistant',
        content: ack,
        meta: {
          model: 'initiative-snooze',
          provider: 'app',
          route: 'local',
          reason: 'Pausa de iniciativa'
        }
      })
      if (trimmed.length < 80 && !/[?.!]/.test(trimmed.slice(0, -1))) {
        return true
      }
    }
  } catch {
    /* ignore */
  }

  return false
}
