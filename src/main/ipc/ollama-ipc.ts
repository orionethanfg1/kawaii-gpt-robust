/**
 * Ollama lifecycle, pull jobs, local disk model scan.
 */
import { ipcMain } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { spawn, type ChildProcess } from 'child_process'
import { refreshModelCatalog } from '../model-catalog-runtime'

let ollamaChild: ChildProcess | null = null

export function resolveOllamaBinary(): string | null {
  if (process.platform === 'win32') {
    const home = process.env.USERPROFILE || process.env.HOME || ''
    const candidates = [
      join(home, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
      'C:\\\\Program Files\\\\Ollama\\\\ollama.exe',
      'ollama'
    ]
    for (const c of candidates) {
      if (c === 'ollama') return c
      if (c && existsSync(c)) return c
    }
    return 'ollama'
  }
  const unix = ['/usr/local/bin/ollama', '/usr/bin/ollama', 'ollama']
  for (const c of unix) {
    if (c === 'ollama') return c
    if (existsSync(c)) return c
  }
  return 'ollama'
}

export async function isOllamaReachable(baseUrl = 'http://localhost:11434'): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: controller.signal
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

ipcMain.handle('ollama:status', async (_e, baseUrl?: string) => {
  const url = baseUrl || 'http://localhost:11434'
  const reachable = await isOllamaReachable(url)
  return {
    reachable,
    managedByApp: Boolean(ollamaChild && !ollamaChild.killed),
    pid: ollamaChild?.pid
  }
})

ipcMain.handle('models:scanLocalDisk', async () => {
  try {
    const { scanLocalModelsOnDisk } = await import('../scan-local-models')
    const snap = scanLocalModelsOnDisk()
    return { ok: true as const, ...snap }
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
      models: [] as [],
      scannedRoots: [] as string[]
    }
  }
})

ipcMain.handle('ollama:start', async (_e, baseUrl?: string) => {
  const url = baseUrl || 'http://localhost:11434'
  if (await isOllamaReachable(url)) {
    return { ok: true, alreadyRunning: true, message: 'Ollama ya está respondiendo' }
  }

  const bin = resolveOllamaBinary()
  if (!bin) {
    return { ok: false, message: 'No se encontró el ejecutable de Ollama' }
  }

  try {
    // Prefer "ollama serve"; on Windows the app may already auto-start the daemon
    ollamaChild = spawn(bin, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: process.platform === 'win32'
    })
    ollamaChild.unref()

    // Wait up to ~8s for readiness
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500))
      if (await isOllamaReachable(url)) {
        return { ok: true, alreadyRunning: false, message: 'Ollama iniciado', pid: ollamaChild.pid }
      }
    }
    return {
      ok: false,
      message:
        'Se intentó iniciar Ollama pero no responde aún. Ábrelo manualmente desde el menú Inicio.'
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'No se pudo iniciar Ollama'
    }
  }
})

// Active pull controllers for cancel support
const pullAbortControllers = new Map<string, AbortController>()

ipcMain.handle('ollama:list-pull-jobs', async () => {
  const { listRecoverableOllamaPulls } = await import('../ollama-pull-jobs')
  return { ok: true, jobs: await listRecoverableOllamaPulls() }
})

ipcMain.handle('ollama:pull-cancel', async (_e, model?: string) => {
  if (model && pullAbortControllers.has(model)) {
    pullAbortControllers.get(model)!.abort()
    pullAbortControllers.delete(model)
    return { ok: true }
  }
  // cancel all
  for (const [key, c] of pullAbortControllers) {
    c.abort()
    pullAbortControllers.delete(key)
  }
  return { ok: true }
})

ipcMain.handle(
  'ollama:pull',
  async (event, payload: { model: string; baseUrl?: string }) => {
    const model = (payload?.model || '').trim()
    if (!model) return { ok: false, error: 'Modelo vacío' }
    const base = (payload.baseUrl || 'http://localhost:11434').replace(/\/$/, '')

    if (pullAbortControllers.has(model)) {
      pullAbortControllers.get(model)!.abort()
      pullAbortControllers.delete(model)
    }
    const controller = new AbortController()
    pullAbortControllers.set(model, controller)

    const { upsertOllamaPullJob, removeOllamaPullJob } = await import('../ollama-pull-jobs')
    await upsertOllamaPullJob({ model, status: 'running', updatedAt: Date.now(), progress: 0 })

    const maxAttempts = 5
    let lastError = ''

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (controller.signal.aborted) {
        await upsertOllamaPullJob({ model, status: 'paused', updatedAt: Date.now() })
        pullAbortControllers.delete(model)
        return { ok: false, error: 'cancelled', cancelled: true }
      }
      try {
        if (attempt > 1) {
          event.sender.send('ollama:pull-progress', {
            model,
            status: `Reintento ${attempt}/${maxAttempts} (Ollama reanuda capas ya bajadas)…`,
            progress: undefined
          })
          await new Promise((r) => setTimeout(r, Math.min(15_000, 2000 * attempt)))
        }

        const res = await fetch(`${base}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model, stream: true }),
          signal: controller.signal
        })
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '')
          lastError = text || `HTTP ${res.status}`
          continue
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let lastPct = 0
        let streamError = ''

        while (true) {
          if (controller.signal.aborted) {
            try {
              await reader.cancel()
            } catch {
              /* ignore */
            }
            await upsertOllamaPullJob({ model, status: 'paused', progress: lastPct })
            pullAbortControllers.delete(model)
            event.sender.send('ollama:pull-progress', { model, status: 'cancelled' })
            return { ok: false, error: 'cancelled', cancelled: true }
          }
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              const parsed = JSON.parse(trimmed) as {
                status?: string
                completed?: number
                total?: number
                error?: string
              }
              if (parsed.error) {
                streamError = parsed.error
                break
              }
              const progress =
                parsed.total && parsed.total > 0 && parsed.completed != null
                  ? Math.min(99, (parsed.completed / parsed.total) * 100)
                  : undefined
              if (progress != null) lastPct = progress
              event.sender.send('ollama:pull-progress', {
                model,
                status: parsed.status || 'downloading',
                progress,
                completed: parsed.completed,
                total: parsed.total
              })
              if (progress != null && Math.floor(progress) % 5 === 0) {
                await upsertOllamaPullJob({
                  model,
                  status: 'running',
                  progress: lastPct
                })
              }
            } catch {
              /* ignore bad json line */
            }
          }
          if (streamError) break
        }

        if (streamError) {
          lastError = streamError
          const retryable =
            /max retries|timeout|temporar|connection|EOF|reset|TLS|cloudflare|529|502|503|504/i.test(
              streamError
            )
          await upsertOllamaPullJob({
            model,
            status: 'error',
            error: streamError,
            progress: lastPct
          })
          event.sender.send('ollama:pull-progress', {
            model,
            status: 'error',
            error: streamError + (retryable ? ' · Se reintentará automáticamente…' : '')
          })
          if (retryable && attempt < maxAttempts) continue
          pullAbortControllers.delete(model)
          return { ok: false, error: streamError }
        }

        pullAbortControllers.delete(model)
        await removeOllamaPullJob(model)
        event.sender.send('ollama:pull-progress', { model, status: 'success', progress: 100 })
        return { ok: true }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          await upsertOllamaPullJob({ model, status: 'paused' })
          pullAbortControllers.delete(model)
          event.sender.send('ollama:pull-progress', { model, status: 'cancelled' })
          return { ok: false, error: 'cancelled', cancelled: true }
        }
        lastError = err instanceof Error ? err.message : String(err)
        await upsertOllamaPullJob({ model, status: 'error', error: lastError })
        if (attempt >= maxAttempts) break
      }
    }

    pullAbortControllers.delete(model)
    event.sender.send('ollama:pull-progress', {
      model,
      status: 'error',
      error:
        (lastError || 'Error de descarga') +
        ' · Pulsa Continuar: Ollama reanuda lo ya descargado.'
    })
    return { ok: false, error: lastError }
  }
)

ipcMain.handle(
  'ollama:delete',
  async (_e, payload: { model: string; baseUrl?: string }) => {
    const model = (payload?.model || '').trim()
    if (!model) return { ok: false, error: 'Modelo vacío' }
    const base = (payload.baseUrl || 'http://localhost:11434').replace(/\/$/, '')
    try {
      const res = await fetch(`${base}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model })
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, error: text || `HTTP ${res.status}` }
      }
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }
)

export function registerOllamaIpc(): void {
  /* handlers bound at module load */
}
