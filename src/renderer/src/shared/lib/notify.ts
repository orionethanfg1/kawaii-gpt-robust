/**
 * In-app sticky activity + optional OS notification (Windows Action Center).
 * OS toast is skipped when the app window is focused (user already sees the chat).
 */
import { activityError, activitySuccess, activityInfo } from './stores/activityStore'

export type NotifyKind = 'info' | 'success' | 'error'

export async function notifyUser(
  title: string,
  body?: string,
  opts?: {
    kind?: NotifyKind
    /** Keep toast until user dismisses (default true for important events) */
    sticky?: boolean
    /** Also show OS notification (default: only when window is in background) */
    os?: boolean
    silent?: boolean
  }
): Promise<void> {
  const kind = opts?.kind ?? 'info'
  const sticky = opts?.sticky !== false
  if (kind === 'success') activitySuccess(title, body, { sticky })
  else if (kind === 'error') activityError(title, body, { sticky })
  else activityInfo(title, body)

  // Explicit os:false → never. os:true → always. default → only if document hidden / blurred
  if (opts?.os === false) return
  const appInForeground =
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    typeof document.hasFocus === 'function' &&
    document.hasFocus()
  if (opts?.os !== true && appInForeground) return

  try {
    await window.kawaii?.notify?.({
      title,
      body: body || '',
      silent: opts?.silent === true
    })
  } catch {
    /* OS notify optional */
  }
}
