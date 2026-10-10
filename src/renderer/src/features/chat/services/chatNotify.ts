/**
 * OS / in-app notifications for chat replies (extracted from useChat).
 */
import { notifyUser } from '@shared/lib/notify'
import { stripHarnessMarkup } from '@core/agent'

export function notifyChatReply(
  preview: string,
  meta?: { model?: string; isError?: boolean }
): void {
  const body = stripHarnessMarkup(preview || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  if (!body || /\{\s*"goal"|<<<APP_/i.test(body)) return
  if (meta?.isError) {
    void notifyUser('Error en la respuesta', body || 'Revisa el mensaje en el chat', {
      kind: 'error',
      sticky: true,
      os: true
    })
    return
  }
  void notifyUser('Nueva respuesta', body || 'El chat respondió', {
    kind: 'success',
    sticky: true,
    os: true,
    silent: false
  })
}
