/** App shell/notify/version */
import { app, ipcMain, shell, Notification, BrowserWindow } from "electron"
import { focusMainWindow } from '../window-bootstrap'
import { join } from "path"

export function registerAppSystemIpc(): void {
ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url)
  }
})

ipcMain.handle('app:notify', async (_e, payload?: { title?: string; body?: string; silent?: boolean; convId?: string }) => {
  try {
    const { Notification, BrowserWindow, app } = await import('electron')
    const title = (payload?.title || 'KawaiiGPT').slice(0, 120)
    const body = (payload?.body || '').slice(0, 240)
    if (Notification.isSupported()) {
      const n = new Notification({
        title,
        body,
        silent: Boolean(payload?.silent),
        urgency: 'normal'
      })
      const focusAppAndChat = () => {
        focusMainWindow({
          convId: payload?.convId ? String(payload.convId) : undefined,
          source: 'notification'
        })
      }
      n.on('click', () => focusAppAndChat())
      n.on('action', () => focusAppAndChat())
      n.show()
      return { ok: true }
    }
    // Fallback: flash taskbar
    const wins = BrowserWindow.getAllWindows()
    wins[0]?.flashFrame?.(true)
    return { ok: false, error: 'notifications_unsupported' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('app:version', () => {
  try {
    // Prefer package.json so UI never lags behind electron-builder cache
    const pkgPath = join(app.getAppPath(), 'package.json')
    const alt = join(__dirname, '../../package.json')
    const { readFileSync, existsSync } = require('fs') as typeof import('fs')
    for (const p of [pkgPath, alt]) {
      if (existsSync(p)) {
        const v = JSON.parse(readFileSync(p, 'utf-8')).version
        if (v) return String(v)
      }
    }
  } catch {
    /* fall through */
  }
  return app.getVersion()
})

ipcMain.handle('app:runtimeMode', () => (app.isPackaged ? 'packaged' : 'dev'))

}
