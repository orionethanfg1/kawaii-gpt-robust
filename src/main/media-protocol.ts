/** M4 — kawaii-media:// protocol (voice TTS files) */
import { app, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { existsSync } from 'fs'
import { voiceOutDir } from './voice-tts'

export function registerMediaProtocol(): void {
  try {
    protocol.handle('kawaii-media', async (request) => {
      try {
        const u = new URL(request.url)
        const host = u.hostname
        const name = decodeURIComponent((u.pathname || '').replace(/^\/+/, ''))
        if (!name || name.includes('..') || /[\\/]/.test(name)) {
          return new Response('Forbidden', { status: 403 })
        }
        if (host === 'voice') {
          return net.fetch(pathToFileURL(join(voiceOutDir(), name)).href)
        }
        if (host === 'image' && /\.(png|jpe?g|webp)$/i.test(name)) {
          const file = join(app.getPath('userData'), 'images', name)
          if (!existsSync(file)) return new Response('Not found', { status: 404 })
          return net.fetch(pathToFileURL(file).href)
        }
        return new Response('Forbidden', { status: 403 })
      } catch (e) {
        return new Response(String(e), { status: 500 })
      }
    })
  } catch (e) {
    console.error('[kawaii-media]', e)
  }
}
