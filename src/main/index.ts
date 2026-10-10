/**
 * M4 — Electron main bootstrap only.
 * IPC lives under ./ipc/*; window/protocol/boot are separate modules.
 */
import { app, protocol, BrowserWindow } from 'electron'
import Store from 'electron-store'
import './image-ipc'
import { registerLocalNetIpc } from './local-net'
import { registerMusicIpc } from './ipc/music-ipc'
import { registerVoiceIpc } from './ipc/voice-ipc'
import { registerLayersIpc } from './ipc/layers-ipc'
import { registerForgeIpc } from './ipc/forge-ipc'
import { registerCatalogIpc } from './ipc/catalog-ipc'
import { registerGitIpc } from './ipc/git-ipc'
import { registerPythonIpc } from './ipc/python-ipc'
import { registerMachineIpc } from './ipc/machine-ipc'
import { registerSecretsIpc } from './ipc/secrets-ipc'
import { registerSdIpc } from './ipc/sd-ipc'
import './ipc/ollama-ipc'
import './ipc/files-ipc'
import { registerWebIpc } from './ipc/web-ipc'
import { registerPluginsIpc } from './ipc/plugins-ipc'
import { registerAppSystemIpc } from './ipc/app-system-ipc'
import { registerAgendaIpc } from './ipc/agenda-ipc'
import { startAgendaScheduler } from './agenda-scheduler'
import { registerSettingsBackupIpc } from './ipc/settings-backup-ipc'
import { registerSystemHardwareIpc } from './ipc/system-hardware-ipc'
import { refreshModelCatalog } from './model-catalog-runtime'
import { createWindow, focusMainWindow } from './window-bootstrap'
import { registerMediaProtocol } from './media-protocol'
import { scheduleBootBackground } from './boot-background'

registerLocalNetIpc()
registerMusicIpc()
registerVoiceIpc()
registerLayersIpc()
registerForgeIpc()
registerCatalogIpc()
registerGitIpc()
registerPythonIpc()
registerMachineIpc()
registerSdIpc()
registerWebIpc()
registerPluginsIpc()
registerAppSystemIpc()
registerAgendaIpc()
try { startAgendaScheduler() } catch (e) { console.warn('[agenda] start', e) }
registerSettingsBackupIpc()
registerSystemHardwareIpc()

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'kawaii-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

const secureStore = new Store<Record<string, string>>({
  name: 'secure-settings'
})
registerSecretsIpc(secureStore as never)
;(globalThis as any).__kawaiiSecureStore = secureStore

app.on('before-quit', () => {
  // Keep system Ollama running; we only spawn helpers, we don't own the daemon lifecycle.
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusMainWindow()
  })

  app.whenReady().then(async () => {
    registerMediaProtocol()
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.kawaiigpt.robust')
    }
    try {
      const { registerActivityWindowIpc } = await import('./activity-windows')
      registerActivityWindowIpc()
    } catch {
      /* ignore */
    }
    void refreshModelCatalog()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    scheduleBootBackground(3500)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
