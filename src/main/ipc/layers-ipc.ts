/**
 * Heavy-layer scheduler IPC (Forge / music admission).
 */
import { ipcMain } from 'electron'

export function registerLayersIpc(): void {
  ipcMain.handle('layers:prepare', async (_e, target?: string, reason?: string) => {
    const { prepareHeavyLayer } = await import('../layer-scheduler')
    const t = target === 'image' || target === 'music' || target === 'none' ? target : 'none'
    return prepareHeavyLayer(t, { reason: reason || 'ui' })
  })
  ipcMain.handle('layers:active', async () => {
    const { getActiveHeavyLayer, getLastLayerEvent } = await import('../layer-scheduler')
    return { active: getActiveHeavyLayer(), last: getLastLayerEvent() }
  })
}
