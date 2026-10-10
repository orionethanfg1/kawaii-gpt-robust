/**
 * Localhost HTTP that prefers Electron main IPC (no CORS) and falls back to fetch.
 */
export type LocalHttpResponse = {
  ok: boolean
  status: number
  error?: string
  json: <T = unknown>() => Promise<T>
  text: () => Promise<string>
}

async function viaIpc(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
): Promise<LocalHttpResponse | null> {
  try {
    if (typeof window === 'undefined' || !window.kawaii?.localFetch) return null
    const res = await window.kawaii.localFetch(url, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      timeoutMs: init?.timeoutMs
    })
    // Non-local URLs (cloud APIs) are rejected by main — fall through to window.fetch
    // Cloud rejected by main → fall through to window.fetch
    if (res.error && /Solo se permiten/i.test(res.error)) {
      return null
    }
    // Local IPC error (ECONNREFUSED, timeout, etc.): keep it — do NOT fall to renderer
    // fetch (CORS would hide the real failure).
    return {
      ok: res.ok,
      status: res.status,
      error: res.error,
      json: async <T = unknown>() => {
        try {
          return JSON.parse(res.bodyText || 'null') as T
        } catch {
          throw new Error('JSON inválido')
        }
      },
      text: async () => res.bodyText || res.error || ''
    }
  } catch {
    return null
  }
}

/** Fetch localhost endpoints; uses main-process proxy in Electron renderer. */
export async function localHttp(
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
    timeoutMs?: number
  }
): Promise<LocalHttpResponse> {
  const timeoutMs =
    init?.timeoutMs ??
    (init?.signal ? 15_000 : 8_000)

  const proxied = await viaIpc(url, {
    method: init?.method,
    headers: init?.headers,
    body: init?.body,
    timeoutMs
  })
  if (proxied) return proxied

  const res = await fetch(url, {
    method: init?.method || 'GET',
    headers: init?.headers,
    body: init?.body,
    signal: init?.signal || AbortSignal.timeout(timeoutMs)
  })
  const bodyText = await res.text()
  return {
    ok: res.ok,
    status: res.status,
    json: async <T = unknown>() => JSON.parse(bodyText || 'null') as T,
    text: async () => bodyText
  }
}
