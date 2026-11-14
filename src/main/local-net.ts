/**
 * Proxy localhost fetches for the renderer (avoids CORS on LM Studio / Ollama).
 * Only 127.0.0.1 / localhost are allowed.
 */
import { app, ipcMain } from 'electron'
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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

type LocalRuntimeDiagnostic = {
  source: 'initiative' | 'provider'
  event: string
  provider?: 'ollama' | 'lmstudio' | 'openai-compatible' | 'app'
  model?: string
  endpoint?: string
  status?: number
  durationMs?: number
  delayMs?: number
  reason?: string
  errorCode?: string
}

const LOCAL_RUNTIME_LOG = 'local-runtime.jsonl'
const LOCAL_RUNTIME_LOG_MAX_BYTES = 512 * 1024
const LOCAL_RUNTIME_LOG_KEEP_BYTES = 384 * 1024
const LOCAL_RUNTIME_ENDPOINTS = new Set([
  '/v1/chat/completions',
  '/api/chat',
  '/api/generate',
  '/api/tags',
  '/api/ps',
  '/v1/models',
  '/api/v0/models'
])

function safeToken(value: unknown, maxLength = 100): string | undefined {
  const token = String(value || '').trim()
  return token && /^[\w./:-]+$/i.test(token) ? token.slice(0, maxLength) : undefined
}

function localProviderForUrl(url: URL): LocalRuntimeDiagnostic['provider'] {
  if (url.port === '11434') return 'ollama'
  if (url.port === '1234' || url.port === '1235') return 'lmstudio'
  if (url.pathname.startsWith('/api/')) return 'ollama'
  return 'openai-compatible'
}

async function appendLocalRuntimeDiagnostic(
  input: LocalRuntimeDiagnostic
): Promise<{ ok: boolean; path: string; error?: string }> {
  const path = join(app.getPath('userData'), 'diagnostics', LOCAL_RUNTIME_LOG)
  try {
    const event = safeToken(input.event, 48)
    if (!event || !['initiative', 'provider'].includes(input.source)) {
      return { ok: false, path, error: 'Invalid diagnostic entry' }
    }
    const entry: LocalRuntimeDiagnostic & { at: string } = {
      at: new Date().toISOString(),
      source: input.source,
      event,
      ...(input.provider &&
      ['ollama', 'lmstudio', 'openai-compatible', 'app'].includes(String(input.provider))
        ? { provider: input.provider }
        : {}),
      ...(safeToken(input.model, 120) ? { model: safeToken(input.model, 120) } : {}),
      ...(safeToken(input.endpoint, 48) ? { endpoint: safeToken(input.endpoint, 48) } : {}),
      ...(Number.isInteger(input.status) && input.status! >= 0 && input.status! <= 599
        ? { status: input.status }
        : {}),
      ...(Number.isFinite(input.durationMs)
        ? { durationMs: Math.max(0, Math.min(1_800_000, Math.round(input.durationMs!))) }
        : {}),
      ...(Number.isFinite(input.delayMs)
        ? { delayMs: Math.max(0, Math.min(86_400_000, Math.round(input.delayMs!))) }
        : {}),
      ...(safeToken(input.reason, 80) ? { reason: safeToken(input.reason, 80) } : {}),
      ...(safeToken(input.errorCode, 48)
        ? { errorCode: safeToken(input.errorCode, 48) }
        : {})
    }
    const line = JSON.stringify(entry) + '\n'
    const dir = join(app.getPath('userData'), 'diagnostics')
    await mkdir(dir, { recursive: true })
    let size = 0
    try {
      size = (await stat(path)).size
    } catch {
      /* new log */
    }
    if (size + Buffer.byteLength(line) > LOCAL_RUNTIME_LOG_MAX_BYTES) {
      try {
        const existing = await readFile(path, 'utf8')
        const tail = existing.slice(-LOCAL_RUNTIME_LOG_KEEP_BYTES)
        const firstNewline = tail.indexOf('\n')
        await writeFile(path, firstNewline >= 0 ? tail.slice(firstNewline + 1) : '', 'utf8')
      } catch {
        /* continue with a new log if the old one cannot be read */
      }
    }
    await appendFile(path, line, 'utf8')
    return { ok: true, path }
  } catch (error) {
    return {
      ok: false,
      path,
      error: error instanceof Error ? error.message.slice(0, 120) : 'Log write failed'
    }
  }
}

async function logLocalProviderRequest(
  url: string,
  startedAt: number,
  status: number,
  error?: unknown
): Promise<void> {
  try {
    const parsed = new URL(url)
    if (!isLocalUrl(url) || !LOCAL_RUNTIME_ENDPOINTS.has(parsed.pathname)) return
    const code =
      error instanceof Error
        ? error.name
        : status >= 400
          ? `HTTP_${status}`
          : undefined
    await appendLocalRuntimeDiagnostic({
      source: 'provider',
      event: error || status >= 400 ? 'request-failed' : 'request-completed',
      provider: localProviderForUrl(parsed),
      endpoint: parsed.pathname,
      status,
      durationMs: Date.now() - startedAt,
      errorCode: code
    })
  } catch {
    /* diagnostics must not affect local inference */
  }
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
    Math.max(1_000, init?.timeoutMs ?? fallback)
  )
  const startedAt = Date.now()
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
    await logLocalProviderRequest(url, startedAt, res.status, res.ok ? undefined : `HTTP_${res.status}`)
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers,
      bodyText
    }
  } catch (err) {
    await logLocalProviderRequest(url, startedAt, 0, err)
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
  ipcMain.handle('diagnostics:appendLocalRuntimeLog', async (_event, entry?: LocalRuntimeDiagnostic) => {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Invalid diagnostic entry' }
    }
    return appendLocalRuntimeDiagnostic(entry)
  })

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
      // Absolute ceiling + idle (no bytes) limit. Gemma 26B @ ~3.5 t/s can stream 15–25 min.
      const hardCapMs = Math.min(
        2_400_000, // 40 min hard
        Math.max(600_000, init?.timeoutMs ?? 1_200_000)
      )
      const idleCapMs = Math.min(hardCapMs, 600_000) // 10 min without any SSE byte → abort
      const ctrl = new AbortController()
      let lastByteAt = Date.now()
      const startedAt = Date.now()
      const watchdog = setInterval(() => {
        const now = Date.now()
        if (now - startedAt > hardCapMs || now - lastByteAt > idleCapMs) {
          try {
            ctrl.abort()
          } catch {
            /* */
          }
        }
      }, 2_000)
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
          await logLocalProviderRequest(
            url,
            startedAt,
            res.status,
            res.ok ? undefined : `HTTP_${res.status}`
          )
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
          lastByteAt = Date.now()
          const piece = decoder.decode(value, { stream: true })
          bodyText += piece
          try {
            event.sender.send('net:localStreamChunk', { streamId, text: piece })
          } catch {
            /* window closed — keep reading so LMS is not left hanging mid-job if possible */
          }
        }
        try {
          event.sender.send('net:localStreamChunk', { streamId, done: true })
        } catch {
          /* */
        }
        await logLocalProviderRequest(url, startedAt, res.status)
        return {
          ok: true,
          status: res.status,
          statusText: res.statusText,
          headers,
          bodyText
        } satisfies LocalFetchResult
      } catch (err) {
        await logLocalProviderRequest(url, startedAt, 0, err)
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
        clearInterval(watchdog)
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
