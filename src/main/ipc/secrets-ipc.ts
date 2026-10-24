/**
 * Secure store API keys IPC.
 */
import { ipcMain } from 'electron'

type StoreLike = {
  get: (key: string, def?: string) => string
  set: (key: string, val: string) => void
  store?: Record<string, unknown>
}

export function registerSecretsIpc(secureStore: StoreLike): void {
  ipcMain.handle('secrets:getCloudApiKey', () => secureStore.get('cloudApiKey', ''))
  ipcMain.handle('secrets:setCloudApiKey', (_e, key: string) => {
    secureStore.set('cloudApiKey', typeof key === 'string' ? key : '')
    return true
  })
  ipcMain.handle('secrets:getProviderKey', (_e, providerId: string) => {
    if (typeof providerId !== 'string' || !providerId) return ''
    const specific = secureStore.get(`providerKey:${providerId}`, '')
    if (specific) return specific
    if (providerId === 'openrouter' || providerId === 'main') {
      return secureStore.get('cloudApiKey', '')
    }
    return ''
  })
  ipcMain.handle('secrets:setProviderKey', (_e, providerId: string, key: string) => {
    if (typeof providerId !== 'string' || !providerId) return false
    secureStore.set(`providerKey:${providerId}`, typeof key === 'string' ? key : '')
    return true
  })
  ipcMain.handle('secrets:getAllProviderKeys', () => {
    try {
      const out: Record<string, string> = {}
      const cloud = secureStore.get('cloudApiKey', '')
      if (cloud) out.openrouter = cloud
      // electron-store exposes .store
      const raw = (secureStore as { store?: Record<string, unknown> }).store || {}
      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith('providerKey:') && typeof v === 'string' && v) {
          out[k.slice('providerKey:'.length)] = v
        }
      }
      return out
    } catch {
      return {}
    }
  })
}
