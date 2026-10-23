/**
 * Resumable HTTP downloads with pause / crash / network-drop recovery.
 * State is persisted as JSON next to the .partial file so a reboot or
 * unstable connection can continue without starting over.
 */

import { createWriteStream, existsSync } from 'fs'
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'fs/promises'
import { dirname } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

export type DownloadJobStatus =
  | 'idle'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface DownloadJobState {
  id: string
  url: string
  dest: string
  partial: string
  received: number
  total: number | null
  etag?: string | null
  lastModified?: string | null
  status: DownloadJobStatus
  updatedAt: string
  error?: string
  label?: string
  /** How many automatic network retries so far (this process) */
  attempt?: number
}

function statePathFor(dest: string): string {
  return `${dest}.download.json`
}

export async function loadDownloadJob(dest: string): Promise<DownloadJobState | null> {
  const sp = statePathFor(dest)
  if (!existsSync(sp)) return null
  try {
    const raw = await readFile(sp, 'utf-8')
    return JSON.parse(raw) as DownloadJobState
  } catch {
    return null
  }
}

async function saveDownloadJob(job: DownloadJobState): Promise<void> {
  job.updatedAt = new Date().toISOString()
  const sp = statePathFor(job.dest)
  await mkdir(dirname(sp), { recursive: true })
  const tmp = `${sp}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(job, null, 2), 'utf-8')
    if (existsSync(sp)) {
      try {
        await unlink(sp)
      } catch {
        /* ignore */
      }
    }
    await rename(tmp, sp)
  } catch {
    try {
      await writeFile(sp, JSON.stringify(job, null, 2), 'utf-8')
    } catch {
      /* last resort ignore — progress still in .partial */
    }
    try {
      if (existsSync(tmp)) await unlink(tmp)
    } catch {
      /* ignore */
    }
  }
}

export async function clearDownloadJob(dest: string): Promise<void> {
  const sp = statePathFor(dest)
  const partial = `${dest}.partial`
  try {
    if (existsSync(sp)) await unlink(sp)
  } catch {
    /* ignore */
  }
  try {
    if (existsSync(partial)) await unlink(partial)
  } catch {
    /* ignore */
  }
}

async function fileSize(path: string): Promise<number> {
  if (!existsSync(path)) return 0
  try {
    const s = await stat(path)
    return s.size
  } catch {
    return 0
  }
}

export type DownloadControl = {
  pause: () => void
  cancel: (wipe?: boolean) => void
}

function isRetryableNetworkError(err: unknown): boolean {
  if (!err) return false
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  const name = err instanceof Error ? err.name : ''
  if (name === 'AbortError') return false
  return (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('socket') ||
    msg.includes('und_err') ||
    msg.includes('other side closed') ||
    msg.includes('premature close') ||
    msg.includes('aborted') ||
    msg.includes('tls') ||
    msg.includes('certificate') ||
    msg.includes('http2') ||
    msg.includes('timeout')
  )
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
      return
    }
    const t = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Download with Range resume + automatic retries on unstable networks.
 * Safe across app restarts if the same dest/url is used.
 */
export async function resumableDownload(options: {
  id: string
  url: string
  dest: string
  label?: string
  signal?: AbortSignal
  /** Default 12 — enough for multi-GB with flaky Wi‑Fi */
  maxRetries?: number
  /** Base delay ms before retry (exponential, capped) */
  retryBaseMs?: number
  onProgress?: (received: number, total: number | null, job: DownloadJobState) => void
  onControl?: (ctrl: DownloadControl) => void
  /** Called when a network retry is scheduled */
  onRetry?: (attempt: number, max: number, error: string, waitMs: number) => void
}): Promise<
  { ok: true; path: string } | { ok: false; error: string; paused?: boolean; cancelled?: boolean }
> {
  const { id, url, dest, label } = options
  const maxRetries = options.maxRetries ?? 12
  const retryBaseMs = options.retryBaseMs ?? 1500

  await mkdir(dirname(dest), { recursive: true })

  const partial = `${dest}.partial`
  let existing = await loadDownloadJob(dest)
  let received = await fileSize(partial)

  if (existsSync(dest) && (await fileSize(dest)) > 0) {
    const job: DownloadJobState = {
      id,
      url,
      dest,
      partial,
      received: await fileSize(dest),
      total: await fileSize(dest),
      status: 'completed',
      updatedAt: new Date().toISOString(),
      label
    }
    await saveDownloadJob(job)
    return { ok: true, path: dest }
  }

  // Mirror/URL change must NOT wipe bytes already on disk (resume across mirrors)
  if (existing && existing.url !== url) {
    if (received > 0 || (existing.received || 0) > 0) {
      existing = { ...existing, url, id }
    } else {
      await clearDownloadJob(dest)
      existing = null
      received = 0
    }
  }
  if (existing && (existing.received || 0) > received) {
    received = existing.received
  }

  let localAbort = new AbortController()
  let paused = false
  let cancelled = false

  const pause = () => {
    paused = true
    localAbort.abort()
  }
  const cancel = (wipe = false) => {
    cancelled = true
    localAbort.abort()
    if (wipe) void clearDownloadJob(dest)
  }
  options.onControl?.({ pause, cancel })

  if (options.signal) {
    if (options.signal.aborted) {
      return { ok: false, error: 'Cancelado', cancelled: true }
    }
    options.signal.addEventListener('abort', () => localAbort.abort())
  }

  const job: DownloadJobState = {
    id,
    url,
    dest,
    partial,
    received,
    total: existing?.total ?? null,
    etag: existing?.etag ?? null,
    lastModified: existing?.lastModified ?? null,
    status: 'downloading',
    updatedAt: new Date().toISOString(),
    label,
    attempt: 0
  }
  await saveDownloadJob(job)

  let lastPersist = Date.now()
  let lastPersistBytes = received

  const persistProgress = async (force = false) => {
    const now = Date.now()
    const size = await fileSize(partial)
    job.received = size
    received = size
    if (
      force ||
      now - lastPersist >= 2000 ||
      size - lastPersistBytes >= 2 * 1024 * 1024
    ) {
      lastPersist = now
      lastPersistBytes = size
      job.status = 'downloading'
      job.error = undefined
      await saveDownloadJob(job)
      options.onProgress?.(size, job.total, { ...job })
    }
  }

  let attempt = 0
  while (attempt <= maxRetries) {
    if (paused) {
      job.status = 'paused'
      job.received = await fileSize(partial)
      job.error = undefined
      await saveDownloadJob(job)
      return { ok: false, error: 'Pausado — progreso guardado', paused: true }
    }
    if (cancelled) {
      job.status = 'cancelled'
      job.received = await fileSize(partial)
      await saveDownloadJob(job)
      return { ok: false, error: 'Cancelado', cancelled: true }
    }

    // Fresh controller each attempt (previous abort must not stick)
    localAbort = new AbortController()
    if (options.signal?.aborted) {
      return { ok: false, error: 'Cancelado', cancelled: true }
    }
    const onOuterAbort = () => localAbort.abort()
    options.signal?.addEventListener('abort', onOuterAbort)

    received = await fileSize(partial)
    job.received = received
    job.attempt = attempt
    job.status = 'downloading'
    job.error = undefined
    await saveDownloadJob(job)

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (compatible; KawaiiGPT-Robust/0.4; +https://github.com/)',
        Accept: '*/*',
        'Accept-Encoding': 'identity'
      }
      if (received > 0) {
        headers.Range = `bytes=${received}-`
      }
      if (job.etag) headers['If-Range'] = job.etag
      else if (job.lastModified) headers['If-Range'] = job.lastModified

      const res = await fetch(url, {
        signal: localAbort.signal,
        redirect: 'follow',
        headers
      })

      if (res.status === 416) {
        if (received > 0) {
          await rename(partial, dest)
          job.status = 'completed'
          job.received = await fileSize(dest)
          job.total = job.received
          await saveDownloadJob(job)
          options.signal?.removeEventListener('abort', onOuterAbort)
          return { ok: true, path: dest }
        }
        throw new Error('HTTP 416 Range no válido')
      }

      if (res.status === 200 && received > 0) {
        // Server ignored Range — restart from 0 but keep going
        try {
          if (existsSync(partial)) await unlink(partial)
        } catch {
          /* ignore */
        }
        received = 0
        job.received = 0
      } else if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim())
      }

      const etag = res.headers.get('etag')
      const lastModified = res.headers.get('last-modified')
      if (etag) job.etag = etag
      if (lastModified) job.lastModified = lastModified

      const contentRange = res.headers.get('content-range')
      const contentLength = res.headers.get('content-length')
      if (contentRange) {
        const m = /\/(\d+)\s*$/.exec(contentRange)
        if (m) job.total = Number(m[1])
      } else if (contentLength && res.status === 200) {
        job.total = Number(contentLength)
      } else if (contentLength && res.status === 206 && job.total == null) {
        job.total = received + Number(contentLength)
      }

      if (!res.body) throw new Error('Respuesta sin cuerpo')

      const flags = received > 0 && res.status === 206 ? 'a' : 'w'
      if (flags === 'w' && received > 0) {
        // writing from scratch
        received = 0
        job.received = 0
      }

      const file = createWriteStream(partial, { flags })
      const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream)

      let pending = Promise.resolve()
      nodeStream.on('data', (chunk: Buffer | string) => {
        const len = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
        received += len
        job.received = received
        // throttle persist without blocking the stream heavily
        pending = pending.then(() => persistProgress(false)).catch(() => undefined)
      })

      await pipeline(nodeStream, file)
      await pending
      await persistProgress(true)

      // Verify size if we know total
      const finalSize = await fileSize(partial)
      if (job.total != null && finalSize < job.total) {
        throw new Error(
          `Descarga incompleta (${finalSize}/${job.total} bytes). Se reintentará.`
        )
      }

      await rename(partial, dest)
      job.status = 'completed'
      job.received = await fileSize(dest)
      job.total = job.received
      job.error = undefined
      await saveDownloadJob(job)
      options.onProgress?.(job.received, job.total, { ...job })
      options.signal?.removeEventListener('abort', onOuterAbort)
      return { ok: true, path: dest }
    } catch (err) {
      options.signal?.removeEventListener('abort', onOuterAbort)
      const size = await fileSize(partial)
      job.received = size
      received = size

      if (paused || (err instanceof Error && err.name === 'AbortError' && paused)) {
        job.status = 'paused'
        job.error = undefined
        await saveDownloadJob(job)
        return { ok: false, error: 'Pausado — progreso guardado', paused: true }
      }
      if (cancelled || (err instanceof Error && err.name === 'AbortError' && cancelled)) {
        job.status = 'cancelled'
        await saveDownloadJob(job)
        return { ok: false, error: 'Cancelado', cancelled: true }
      }
      if (err instanceof Error && err.name === 'AbortError' && options.signal?.aborted) {
        job.status = 'cancelled'
        await saveDownloadJob(job)
        return { ok: false, error: 'Cancelado', cancelled: true }
      }

      const msg = err instanceof Error ? err.message : String(err)
      job.error = msg
      await saveDownloadJob(job)

      if (isRetryableNetworkError(err) || /incompleta|HTTP 5\d\d|HTTP 408|HTTP 429/i.test(msg)) {
        if (attempt < maxRetries) {
          const wait = Math.min(60_000, retryBaseMs * Math.pow(1.7, attempt))
          options.onRetry?.(attempt + 1, maxRetries, msg, wait)
          job.status = 'downloading'
          job.error = `Red inestable — reintento ${attempt + 1}/${maxRetries} en ${Math.round(wait / 1000)}s (${msg.slice(0, 80)})`
          await saveDownloadJob(job)
          options.onProgress?.(received, job.total, { ...job })
          try {
            await sleep(wait, options.signal)
          } catch {
            if (paused) {
              job.status = 'paused'
              await saveDownloadJob(job)
              return { ok: false, error: 'Pausado — progreso guardado', paused: true }
            }
            return { ok: false, error: 'Cancelado', cancelled: true }
          }
          attempt += 1
          continue
        }
      }

      job.status = 'failed'
      await saveDownloadJob(job)
      return {
        ok: false,
        error: `${msg} · Progreso guardado (${Math.round(size / 1024 / 1024)} MB). Pulsa Reanudar cuando la red vuelva.`
      }
    }
  }

  job.status = 'failed'
  job.received = await fileSize(partial)
  await saveDownloadJob(job)
  return {
    ok: false,
    error: `Agotados los reintentos de red. Progreso guardado — usa Reanudar Forge.`
  }
}

/** List recovery jobs under a directory (*.download.json) */
export async function listDownloadJobsInDir(dir: string): Promise<DownloadJobState[]> {
  if (!existsSync(dir)) return []
  const { readdir } = await import('fs/promises')
  const { join } = await import('path')
  const names = await readdir(dir)
  const jobs: DownloadJobState[] = []
  for (const n of names) {
    if (!n.endsWith('.download.json')) continue
    try {
      const raw = await readFile(join(dir, n), 'utf-8')
      const job = JSON.parse(raw) as DownloadJobState
      job.received = await fileSize(job.partial || `${job.dest}.partial`)
      jobs.push(job)
    } catch {
      /* ignore */
    }
  }
  return jobs
}

/** Alias used by forge-installer */
export async function listRecoveryJobs(dir: string): Promise<DownloadJobState[]> {
  return listDownloadJobsInDir(dir)
}



/** Remove completed jobs and failed jobs older than maxAgeMs (default 48h). */
export async function purgeStaleJobs(
  dir: string,
  maxAgeMs = 48 * 3600 * 1000
): Promise<number> {
  const jobs = await listDownloadJobsInDir(dir)
  const now = Date.now()
  let n = 0
  for (const j of jobs) {
    const age = now - Date.parse(j.updatedAt || '') || 0
    const done = j.status === 'completed' || (j.total && j.received >= j.total)
    const dead =
      j.status === 'failed' && age > maxAgeMs
        ? true
        : j.status === 'downloading' && (j.received || 0) === 0 && age > maxAgeMs
    if (done || dead) {
      try {
        await clearDownloadJob(j.dest)
        n++
      } catch {
        /* ignore */
      }
    }
  }
  return n
}
