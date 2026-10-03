/** M4 — BrowserWindow creation and bounds persistence */
import { app, BrowserWindow, shell, nativeImage } from 'electron'
import { join } from 'path'
import Store from 'electron-store'

const windowStore = new Store<{ windowBounds: Electron.Rectangle }>({
  name: 'window-state'
})

let mainWindowRef: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef
}

export function focusMainWindow(): void {
  if (!mainWindowRef) return
  if (mainWindowRef.isMinimized()) mainWindowRef.restore()
  mainWindowRef.focus()
}

function resolveResourcePath(...segments: string[]): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', ...segments)
  }
  return join(__dirname, '../../resources', ...segments)
}

export function createWindow(): void {
  const saved = windowStore.get('windowBounds', {
    width: 1180,
    height: 780
  } as Electron.Rectangle)

  const iconPng = resolveResourcePath('icon.png')
  const iconIco = resolveResourcePath('icon.ico')
  let appIcon = nativeImage.createFromPath(iconPng)
  if (appIcon.isEmpty()) {
    appIcon = nativeImage.createFromPath(iconIco)
  }

  const mainWindow = new BrowserWindow({
    width: saved.width ?? 1180,
    height: saved.height ?? 780,
    x: saved.x,
    y: saved.y,
    minWidth: 860,
    minHeight: 600,
    show: true,
    autoHideMenuBar: true,
    title: 'KawaiiGPT Robust',
    backgroundColor: '#FFF8F0',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindowRef = mainWindow

  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) mainWindowRef = null
  })

  const saveBounds = (): void => {
    if (!mainWindow.isDestroyed()) {
      windowStore.set('windowBounds', mainWindow.getBounds())
    }
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[renderer did-fail-load]', code, desc, url)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', details)
  })
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error('[renderer]', message, sourceId + ':' + line)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
