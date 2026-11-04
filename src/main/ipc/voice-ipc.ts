/**
 * Voice / TTS IPC — edge-tts speak, list, ensure, status.
 */
import { ipcMain } from 'electron'
import {
  speakText,
  stopSpeak,
  listVoices,
  voiceStatus,
  ensureEdgeTts,
  DEFAULT_VOICE_ID
} from '../voice-tts'

export function registerVoiceIpc(): void {
  ipcMain.handle('voice:speak', async (_e, req?: { text?: string; voiceId?: string }) => {
    try {
      return await speakText({
        text: String(req?.text || ''),
        voiceId: req?.voiceId || DEFAULT_VOICE_ID
      })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:stop', async () => {
    try {
      stopSpeak()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:list', async () => {
    try {
      return { ok: true, voices: listVoices() }
    } catch (e) {
      return { ok: false, voices: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:ensure', async () => {
    try {
      const messages: string[] = []
      const r = await ensureEdgeTts({
        onProgress: (m) => messages.push(m)
      })
      return { ...r, messages }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), messages: [] }
    }
  })

  ipcMain.handle('voice:getLog', async () => {
    try {
      const { getVoiceLogTail } = await import('../voice-tts')
      return { ok: true, lines: getVoiceLogTail() }
    } catch (e) {
      return { ok: false, lines: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('voice:status', async () => {
    try {
      return await voiceStatus()
    } catch (e) {
      return {
        ok: false,
        engine: 'edge-tts',
        defaultVoice: DEFAULT_VOICE_ID,
        edgeTtsReady: false,
        message: e instanceof Error ? e.message : String(e)
      }
    }
  })
}
