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
  // POST chat can take minutes on local 14B; GET probes stay short
  const hasBody = Boolean(init?.body && String(init.body).length > 0)
  const fallback = hasBody ? 180_000 : 8_000
  const timeoutMs = Math.min(
    600_000,
    Math.max(hasBody ? 60_000 : 1_000, init?.timeoutMs ?? fallback)
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
