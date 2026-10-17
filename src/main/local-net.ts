/**
 * Proxy localhost fetches for the renderer (avoids CORS on LM Studio / Ollama).
 * Only 127.0.0.1 / localhost are allowed.
 */
import { ipcMain } from 'electron'

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = (u.hostname || '').toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

export type LocalFetchResult = {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  bodyText: string
  error?: string
}

export async function localFetchImpl(
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    timeoutMs?: number
  }
): Promise<LocalFetchResult> {
  if (!isLocalUrl(url)) {
    return {
      ok: false,
      status: 0,
      statusText: '',
      headers: {},
      bodyText: '',
      error: 'Solo se permiten URLs localhost / 127.0.0.1'
    }
  }
  // POST chat: Gemma 26B @ ~5 t/s + long replies can exceed 10–15 min
  const hasBody = Boolean(init?.body && String(init.body).length > 0)
  const fallback = hasBody ? 1_200_000 : 8_000
  const timeoutMs = Math.min(
    1_800_000, // hard cap 30 min
    Math.max(hasBody ? 120_000 : 1_000, init?.timeoutMs ?? fallback)
  )
  try {
    const res = await fetch(url, {
      method: init?.method || 'GET',
      headers: init?.headers,
      body: init?.body,
      signal: AbortSignal.timeout(timeoutMs)
    })
    const bodyText = await res.text()
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      headers[k] = v
    })
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers,
      bodyText
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      statusText: '',
      headers: {},
      bodyText: '',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export function registerLocalNetIpc(): void {
  ipcMain.handle(
    'net:localFetch',
    async (
      _e,
      url?: string,
      init?: {
        method?: string
        headers?: Record<string, string>
        body?: string
        timeoutMs?: number
      }
    ) => {
      if (!url || typeof url !== 'string') {
        return {
          ok: false,
          status: 0,
          statusText: '',
          headers: {},
          bodyText: '',
          error: 'URL requerida'
        } satisfies LocalFetchResult
      }
      return localFetchImpl(url, init)
    }
  )

  /**
   * Streaming chat proxy: main reads SSE and pushes chunks to the renderer.
   * Avoids CORS and allows progressive UI for local LMS/Ollama.
   */
  ipcMain.handle(
    'net:localFetchStream',
    async (
      event,
      url?: string,
      init?: {
        method?: string
        headers?: Record<string, string>
        body?: string
        timeoutMs?: number
        streamId?: string
      }
    ) => {
      if (!url || typeof url !== 'string' || !isLocalUrl(url)) {
        return {
          ok: false,
          status: 0,
          statusText: '',
          headers: {},
          bodyText: '',
          error: 'URL local requerida'
        } satisfies LocalFetchResult
      }
      const streamId = String(init?.streamId || `s-${Date.now()}`)
      const timeoutMs = Math.min(
        1_800_000,
        Math.max(120_000, init?.timeoutMs ?? 1_200_000)
      )
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const res = await fetch(url, {
          method: init?.method || 'POST',
          headers: init?.headers,
          body: init?.body,
          signal: ctrl.signal
        })
        const headers: Record<string, string> = {}
        res.headers.forEach((v, k) => {
          headers[k] = v
        })
        if (!res.ok || !res.body) {
          const bodyText = await res.text().catch(() => '')
          return {
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            headers,
            bodyText,
            error: res.ok ? undefined : bodyText.slice(0, 400)
          } satisfies LocalFetchResult
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let bodyText = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const piece = decoder.decode(value, { stream: true })
          bodyText += piece
          try {
            event.sender.send('net:localStreamChunk', { streamId, text: piece })
          } catch {
            /* window closed */
          }
        }
        try {
          event.sender.send('net:localStreamChunk', { streamId, done: true })
        } catch {
          /* */
        }
        return {
          ok: true,
          status: res.status,
          statusText: res.statusText,
          headers,
          bodyText
        } satisfies LocalFetchResult
      } catch (err) {
        try {
          event.sender.send('net:localStreamChunk', {
            streamId,
            done: true,
            error: err instanceof Error ? err.message : String(err)
          })
        } catch {
          /* */
        }
        return {
          ok: false,
          status: 0,
          statusText: '',
          headers: {},
          bodyText: '',
          error: err instanceof Error ? err.message : String(err)
        } satisfies LocalFetchResult
      } finally {
        clearTimeout(timer)
      }
    }
  )

  ipcMain.handle(
    'models:discoverLive',
    async (
      _e,
      opts?: { ollamaBaseUrl?: string; openAIBaseUrl?: string; ramGB?: number }
    ) => {
      try {
        const { discoverLocalModels } = await import('../core/providers/discover-local')
        // Runs in main — no CORS
        return await discoverLocalModels(opts || {})
      } catch (err) {
        return {
          models: [],
          ollama: false,
          openAI: null,
          diskCount: 0,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )
}
