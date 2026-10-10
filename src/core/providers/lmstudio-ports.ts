
/**
 * Discover LM Studio server (OpenAI-compat + native api/v1).
 * LM Studio 0.4+: GET /api/v1/models lists installed; GET /v1/models may only list loaded.
 */
import { localHttp } from './local-http'

export const LM_STUDIO_CANDIDATE_PORTS = [
  1234, 1235, 1236, 4891, 8080, 8000, 3000
] as const

/** Ollama default — must never be labeled as LM Studio (Ollama also has /v1). */
const OLLAMA_PORTS = new Set([11434])

function portOf(url: string): number | null {
  try {
    const u = new URL(url.startsWith('http') ? url : `http://${url}`)
    if (u.port) return Number(u.port)
    return u.protocol === 'https:' ? 443 : 80
  } catch {
    return null
  }
}

async function isProbablyOllama(rootOrV1: string, timeoutMs: number): Promise<boolean> {
  const root = rootOrV1.replace(/\/+$/, '').replace(/\/v1$/i, '')
  const port = portOf(root)
  if (port != null && OLLAMA_PORTS.has(port)) return true
  try {
    const res = await localHttp(`${root}/api/tags`, { timeoutMs: Math.min(timeoutMs, 2_000) })
    if (res.ok) {
      const j = (await res.json()) as { models?: unknown }
      if (Array.isArray(j.models)) return true
    }
  } catch {
    /* not ollama */
  }
  return false
}

export type LmStudioProbeResult = {
  ok: boolean
  baseUrl?: string
  host?: string
  port?: number
  label: string
  message: string
  modelsSample?: string[]
  latencyMs?: number
}

type Cache = { baseUrl: string; port: number; host: string; at: number }
let cache: Cache | null = null
const CACHE_TTL_MS = 45_000

export function clearLmStudioPortCache(): void {
  cache = null
}

export function getCachedLmStudioBaseUrl(): string | undefined {
  if (!cache) return undefined
  if (Date.now() - cache.at > CACHE_TTL_MS) return undefined
  return cache.baseUrl
}

function candidatesFromOpts(preferred?: string): string[] {
  const out: string[] = []
  const push = (u: string) => {
    const n = u.replace(/\/+$/, '')
    const port = portOf(n)
    if (port != null && OLLAMA_PORTS.has(port)) return // never probe Ollama as LMS
    if (!out.includes(n)) out.push(n)
  }
  if (preferred?.trim()) {
    let pr = preferred.trim().replace(/\/+$/, '')
    if (!/\/v1$/i.test(pr)) pr = `${pr}/v1`
    const pp = portOf(pr)
    if (pp == null || !OLLAMA_PORTS.has(pp)) push(pr)
  }
  if (cache && Date.now() - cache.at < CACHE_TTL_MS * 4) {
    push(cache.baseUrl)
  }
  for (const port of LM_STUDIO_CANDIDATE_PORTS) {
    push(`http://127.0.0.1:${port}/v1`)
    push(`http://localhost:${port}/v1`)
  }
  return out
}

function authHeaders(token?: string): Record<string, string>[] {
  const list: Record<string, string>[] = [{}]
  if (token?.trim()) {
    list.push({ Authorization: `Bearer ${token.trim()}` })
  }
  // Legacy / common LMS clients
  list.push({ Authorization: 'Bearer lm-studio' })
  return list
}

function extractModelIds(json: unknown): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const add = (id?: string) => {
    const t = (id || '').trim()
    if (!t || seen.has(t)) return
    seen.add(t)
    ids.push(t)
  }
  if (!json || typeof json !== 'object') return ids
  const j = json as Record<string, unknown>
  // OpenAI style: { data: [{ id }] }
  if (Array.isArray(j.data)) {
    for (const m of j.data as Array<{ id?: string }>) add(m?.id)
  }
  // Native LMS 0.4: { models: [{ key, display_name }] }
  if (Array.isArray(j.models)) {
    for (const m of j.models as Array<{ key?: string; id?: string; display_name?: string }>) {
      add(m?.key || m?.id)
    }
  }
  return ids
}

async function tryGet(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<{ ok: boolean; models: string[]; status: number } | null> {
  try {
    const res = await localHttp(url, { timeoutMs, headers })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, models: [], status: res.status }
    }
    if (!res.ok) return null
    let models: string[] = []
    try {
      models = extractModelIds(await res.json())
    } catch {
      /* empty body still = server up */
    }
    return { ok: true, models, status: res.status }
  } catch {
    return null
  }
}

async function probeOne(
  baseV1: string,
  timeoutMs: number,
  apiToken?: string
): Promise<{ ok: boolean; models: string[]; latencyMs: number } | null> {
  const t0 = Date.now()
  const root = baseV1.replace(/\/+$/, '').replace(/\/v1$/i, '')
  const paths = [
    `${baseV1.replace(/\/+$/, '')}/models`, // OpenAI compat (often loaded-only)
    `${root}/api/v1/models`, // LMS 0.4 native — installed models
    `${root}/api/v0/models` // legacy
  ]
  let sawAuthFail = false
  for (const headers of authHeaders(apiToken)) {
    for (const url of paths) {
      const hit = await tryGet(url, timeoutMs, Object.keys(headers).length ? headers : undefined)
      if (!hit) continue
      if (hit.status === 401 || hit.status === 403) {
        sawAuthFail = true
        continue
      }
      if (hit.ok) {
        return { ok: true, models: hit.models, latencyMs: Date.now() - t0 }
      }
    }
  }
  if (sawAuthFail) {
    return { ok: false, models: [], latencyMs: Date.now() - t0 }
  }
  return null
}

/**
 * Find a live LM Studio / OpenAI-compatible local server.
 */
export async function discoverLmStudioServer(opts?: {
  preferredBaseUrl?: string
  timeoutMs?: number
  force?: boolean
  /** Optional API token if LMS "Require Authentication" is on */
  apiToken?: string
}): Promise<LmStudioProbeResult> {
  if (opts?.force) clearLmStudioPortCache()
  const timeoutMs = opts?.timeoutMs ?? 2_000
  const list = candidatesFromOpts(opts?.preferredBaseUrl)

  const batchSize = 4
  let authBlocked = false
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize)
    const results = await Promise.all(
      batch.map(async (baseV1) => {
        const hit = await probeOne(baseV1, timeoutMs, opts?.apiToken)
        return { baseV1, hit }
      })
    )
    for (const { baseV1, hit } of results) {
      if (hit && !hit.ok && hit.models.length === 0 && hit.latencyMs >= 0) {
        // probeOne returns ok:false only for auth path aggregate — treat as blocked if all 401
      }
      if (!hit?.ok) {
        if (hit && hit.ok === false) authBlocked = true
        continue
      }
      const root = baseV1.replace(/\/+$/, '')
      const withV1 = /\/v1$/i.test(root) ? root : `${root}/v1`
      // Ollama exposes OpenAI /v1 too — reject false LMS
      if (await isProbablyOllama(withV1, timeoutMs)) {
        continue
      }
      let port = 1234
      let host = '127.0.0.1'
      try {
        const u = new URL(withV1)
        host = u.hostname
        port = Number(u.port) || 80
      } catch {
        /* */
      }
      cache = { baseUrl: withV1, port, host, at: Date.now() }
      const sample = (hit.models || []).slice(0, 8)
      return {
        ok: true,
        baseUrl: withV1,
        host,
        port,
        label: 'LM Studio / local OpenAI',
        message:
          `LM Studio activo en ${host}:${port}` +
          (sample.length
            ? ` · ${sample.length}+ modelo(s) visibles`
            : ' · servidor OK (sin modelos listados / ninguno cargado)'),
        modelsSample: sample,
        latencyMs: hit.latencyMs
      }
    }
  }

  return {
    ok: false,
    label: 'LM Studio / local OpenAI',
    message: authBlocked
      ? 'LM Studio responde pero exige autenticación. Desactiva "Require Authentication" en Developer o configura el token en Ajustes.'
      : 'LM Studio no detectado en puertos habituales (1234…). Abre Developer → Start Server y revisa el puerto.'
  }
}

export async function lmStudioBaseUrlCandidates(preferred?: string): Promise<{
  urls: string[]
  probe: LmStudioProbeResult
}> {
  const probe = await discoverLmStudioServer({ preferredBaseUrl: preferred, force: true })
  if (probe.ok && probe.baseUrl) {
    return { urls: [probe.baseUrl], probe }
  }
  return { urls: candidatesFromOpts(preferred), probe }
}
