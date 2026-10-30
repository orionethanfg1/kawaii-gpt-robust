/**
 * System tray — keep agenda/scheduler alive with window hidden (Jarvis A3).
 */
import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { getMainWindow, focusMainWindow } from './window-bootstrap'

let tray: Tray | null = null
let quitConfirmed = false

export function isQuitConfirmed(): boolean {
  return quitConfirmed
}

export function requestQuit(): void {
  quitConfirmed = true
  app.quit()
}

function resolveIcon(): Electron.NativeImage {
  const candidates = [
    join(process.resourcesPath || '', 'resources', 'icon.png'),
    join(__dirname, '../../resources/icon.png'),
    join(__dirname, '../../resources/icon.ico')
  ]
  for (const p of candidates) {
    try {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 })
    } catch {
      /* */
    }
  }
  return nativeImage.createEmpty()
}

export function createAppTray(): Tray | null {
  if (tray) return tray
  try {
    const icon = resolveIcon()
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    tray.setToolTip('KawaiiGPT Robust')
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Mostrar KawaiiGPT',
        click: () => {
          const w = getMainWindow()
          if (w) {
            w.setSkipTaskbar(false)
            if (w.isMinimized()) w.restore()
            w.show()
            w.focus()
          } else {
            focusMainWindow()
          }
          try {
            const win = getMainWindow()
            win?.webContents.send('app:open-chat', { source: 'tray', at: Date.now() })
          } catch {
            /* */
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Salir',
        click: () => requestQuit()
      }
    ])
    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => {
      const w = getMainWindow()
      if (!w) return
      w.setSkipTaskbar(false)
      w.show()
      w.focus()
    })
    return tray
  } catch (e) {
    console.warn('[tray]', e)
    return null
  }
}

/** Close window to tray instead of quitting (unless Salir). */
export function wireCloseToTray(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (quitConfirmed) return
    e.preventDefault()
    win.setSkipTaskbar(true)
    win.hide()
  })
}
