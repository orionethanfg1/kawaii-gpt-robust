/** M4 — BrowserWindow creation and bounds persistence */
import { app, BrowserWindow, shell, nativeImage, session, Menu } from 'electron'
import { join } from 'path'
import { createAppTray, wireCloseToTray } from './app-tray'
import Store from 'electron-store'

const windowStore = new Store<{ windowBounds: Electron.Rectangle }>({
  name: 'window-state'
})

let mainWindowRef: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef
}

export function focusMainWindow(opts?: {
  convId?: string
  source?: string
}): void {
  try {
    const { BrowserWindow, app } = require('electron') as typeof import('electron')
    const w =
      mainWindowRef && !mainWindowRef.isDestroyed()
        ? mainWindowRef
        : BrowserWindow.getAllWindows().find((x) => !x.isDestroyed()) || null
    if (!w) return
    try {
      w.setSkipTaskbar(false)
    } catch {
      /* */
    }
    if (w.isMinimized()) w.restore()
    if (!w.isVisible()) w.show()
    w.show()
    try {
      w.moveTop()
    } catch {
      /* */
    }
    w.focus()
    if (process.platform === 'win32') {
      try {
        w.setAlwaysOnTop(true)
        setTimeout(() => {
          try {
            w.setAlwaysOnTop(false)
            w.focus()
          } catch {
            /* */
          }
        }, 120)
        app.focus({ steal: true })
      } catch {
        try {
          app.focus()
        } catch {
          /* */
        }
      }
    } else {
      try {
        app.focus()
      } catch {
        /* */
      }
    }
    try {
      w.flashFrame(true)
      setTimeout(() => {
        try {
          w.flashFrame(false)
        } catch {
          /* */
        }
      }, 1500)
    } catch {
      /* */
    }
    try {
      if (!w.isDestroyed()) {
        w.webContents.send('app:open-chat', {
          source: opts?.source || 'focus',
          at: Date.now(),
          convId: opts?.convId || undefined
        })
      }
    } catch {
      /* */
    }
  } catch (e) {
    console.warn('[window] focusMainWindow', e)
  }
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
  try {
    createAppTray()
    wireCloseToTray(mainWindow)
  } catch (err) {
    console.warn('[window] tray', err)
  }

  // System spellchecker (Windows/macOS language packs + Hunspell)
  try {
    const ses = mainWindow.webContents.session
    ses.setSpellCheckerEnabled(true)
    const available = ses.availableSpellCheckerLanguages || []
    const prefer = ['es-MX', 'es-419', 'es', 'en-US', 'en'].filter((l) =>
      available.length ? available.includes(l) : true
    )
    if (prefer.length) {
      try {
        ses.setSpellCheckerLanguages(prefer.slice(0, 3))
      } catch {
        try {
          ses.setSpellCheckerLanguages(['es', 'en-US'])
        } catch {
          /* OS may lack packs */
        }
      }
    }
  } catch (e) {
    console.warn('[spellcheck] enable failed', e)
  }

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = []
    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions || []
      if (suggestions.length) {
        for (const s of suggestions.slice(0, 6)) {
          items.push({
            label: s,
            click: () => mainWindow.webContents.replaceMisspelling(s)
          })
        }
        items.push({ type: 'separator' })
      }
      items.push({
        label: 'Añadir al diccionario',
        click: () =>
          mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      })
      items.push({ type: 'separator' })
    }
    items.push(
      { role: 'cut', label: 'Cortar' },
      { role: 'copy', label: 'Copiar' },
      { role: 'paste', label: 'Pegar' },
      { type: 'separator' },
      { role: 'selectAll', label: 'Seleccionar todo' }
    )
    Menu.buildFromTemplate(items).popup({ window: mainWindow })
  })

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
