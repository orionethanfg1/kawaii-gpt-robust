/** App shell/notify/version */
import { app, ipcMain, shell } from "electron"
import { join } from "path"

export function registerAppSystemIpc(): void {
ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url)
  }
})

ipcMain.handle('app:notify', async (_e, payload?: { title?: string; body?: string; silent?: boolean }) => {
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
      const focusApp = () => {
        try {
          const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
          const w = wins.find((x) => x.isVisible()) || wins[0]
          if (!w) return
          if (w.isMinimized()) w.restore()
          w.setSkipTaskbar(false)
          w.show()
          w.moveTop()
          w.focus()
          if (process.platform === 'win32') {
            w.setAlwaysOnTop(true)
            w.setAlwaysOnTop(false)
            app.focus({ steal: true })
          } else {
            app.focus()
          }
        } catch (err) {
          console.warn('[app:notify] focus', err)
        }
      }
      n.on('click', () => focusApp())
      n.on('action', () => focusApp())
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
