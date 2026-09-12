/**
 * Separate BrowserWindows for mini-games, still owned by the main app.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'

const windows = new Map<string, BrowserWindow>()

export function openActivityWindow(kind: 'adventure' | 'chess'): { ok: boolean; id?: string; error?: string } {
  const id = `${kind}-${Date.now()}`
  try {
    const win = new BrowserWindow({
      width: kind === 'chess' ? 720 : 640,
      height: kind === 'chess' ? 780 : 720,
      title: kind === 'chess' ? 'KawaiiGPT · Ajedrez' : 'KawaiiGPT · Aventura',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    // Load renderer with hash route so the same app can show activity UI
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void win.loadURL(`${devUrl}#/activity/${kind}`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: `/activity/${kind}`
      })
    }
    windows.set(id, win)
    win.on('closed', () => {
      windows.delete(id)
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) {
          try {
            w.webContents.send('activity:window-closed', { kind, id })
          } catch {
            /* ignore */
          }
        }
      }
    })
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function closeActivityWindow(id: string): { ok: boolean } {
  const w = windows.get(id)
  if (w && !w.isDestroyed()) w.close()
  windows.delete(id)
  return { ok: true }
}

export function closeAllActivityWindows(): { ok: boolean; closed: number } {
  let closed = 0
  for (const [id, w] of [...windows.entries()]) {
    try {
      if (w && !w.isDestroyed()) {
        w.close()
        closed += 1
      }
    } catch {
      /* ignore */
    }
    windows.delete(id)
  }
  return { ok: true, closed }
}

export function registerActivityWindowIpc(): void {
  ipcMain.handle('activity:openWindow', (_e, kind?: string) => {
    const k = kind === 'chess' ? 'chess' : 'adventure'
    return openActivityWindow(k)
  })
  ipcMain.handle('activity:closeWindow', (_e, id?: string) => {
    if (!id) return { ok: false }
    return closeActivityWindow(String(id))
  })
  ipcMain.handle('activity:closeAllWindows', () => closeAllActivityWindows())
}
