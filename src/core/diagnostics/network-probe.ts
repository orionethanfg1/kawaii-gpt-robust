/**
 * Active network probes — distinguish offline / DNS / provider-down
 * from speculative "maybe network" errors.
 */

export type NetworkProbeLevel = 'online' | 'partial' | 'offline' | 'unknown'

export interface ProbeTargetResult {
  id: string
  label: string
  ok: boolean
  latencyMs: number
  error?: string
  status?: number
}

export interface NetworkProbeReport {
  at: number
  level: NetworkProbeLevel
  /** True if at least one public host answered */
  internetOk: boolean
  /** True if OpenRouter / common AI host answered (TLS+HTTP) */
  aiHostsOk: boolean
  targets: ProbeTargetResult[]
  summary: string
}

const TARGETS: Array<{ id: string; label: string; url: string; kind: 'internet' | 'ai' }> = [
  {
    id: 'cloudflare',
    label: 'Internet (Cloudflare)',
    url: 'https://www.cloudflare.com/cdn-cgi/trace',
    kind: 'internet'
  },
  {
    id: 'httpbin',
    label: 'Internet (httpbin)',
    url: 'https://httpbin.org/status/204',
    kind: 'internet'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter API',
    url: 'https://openrouter.ai/api/v1/models',
    kind: 'ai'
  },
  {
    id: 'groq',
    label: 'Groq API',
    url: 'https://api.groq.com/openai/v1/models',
    kind: 'ai'
  }
]

async function probeOne(
  url: string,
  timeoutMs: number
): Promise<{ ok: boolean; latencyMs: number; status?: number; error?: string }> {
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: '*/*' }
    })
    const latencyMs = Date.now() - start
    // 401/403 still means host reachable (auth required)
    const ok = res.ok || res.status === 401 || res.status === 403 || res.status === 429
    return {
      ok,
      latencyMs,
      status: res.status,
      error: ok ? undefined : `HTTP ${res.status}`
    }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err)
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function runNetworkProbe(options?: {
  timeoutMs?: number
  /** Skip AI host probes (faster internet-only check) */
  internetOnly?: boolean
}): Promise<NetworkProbeReport> {
  const timeoutMs = options?.timeoutMs ?? 4500
  const at = Date.now()
  const list = options?.internetOnly
    ? TARGETS.filter((t) => t.kind === 'internet')
    : TARGETS

  const targets: ProbeTargetResult[] = []
  // Sequential small set — avoids burst that looks like abuse; still fast enough
  for (const t of list) {
    const r = await probeOne(t.url, timeoutMs)
    targets.push({
      id: t.id,
      label: t.label,
      ok: r.ok,
      latencyMs: r.latencyMs,
      status: r.status,
      error: r.error
    })
  }

  const internetOk = targets.some(
    (x) => TARGETS.find((t) => t.id === x.id)?.kind === 'internet' && x.ok
  )
  const aiHostsOk = targets.some(
    (x) => TARGETS.find((t) => t.id === x.id)?.kind === 'ai' && x.ok
  )

  let level: NetworkProbeLevel = 'unknown'
  if (!internetOk && !aiHostsOk) level = 'offline'
  else if (internetOk && aiHostsOk) level = 'online'
  else if (internetOk && !aiHostsOk) level = 'partial'
  else level = 'partial'

  let summary: string
  if (level === 'online') {
    const lat = Math.round(
      targets.filter((t) => t.ok).reduce((a, b) => a + b.latencyMs, 0) /
        Math.max(1, targets.filter((t) => t.ok).length)
    )
    summary = `Red OK · hosts AI alcanzables · ~${lat} ms`
  } else if (level === 'partial') {
    summary = internetOk
      ? 'Internet OK, pero algún host AI no responde (proveedor/DNS/firewall)'
      : 'Solo algunos hosts responden; red inestable o filtrada'
  } else if (level === 'offline') {
    summary = 'Sin respuesta de Internet ni hosts AI — revisa Wi‑Fi/VPN/proxy'
  } else {
    summary = 'No se pudo medir la red'
  }

  return { at, level, internetOk, aiHostsOk, targets, summary }
}

/** Classify a provider error given a fresh probe (optional). */
export function networkHintForError(
  probe: NetworkProbeReport | null | undefined,
  errorCode: string,
  errorMessage: string
): string {
  const lower = (errorMessage || '').toLowerCase()
  const looksNet =
    /fetch failed|network|econnrefused|enotfound|dns|timeout|aborted|offline/i.test(
      lower + errorCode
    )

  if (!probe) {
    return looksNet
      ? 'Posible red; ejecuta Autodiagnóstico para medirla.'
      : 'No parece solo red (modelo/key/cuota). Autodiagnóstico puede confirmarlo.'
  }

  if (probe.level === 'offline') {
    return 'Prueba de red: SIN Internet. No es (solo) el modelo.'
  }
  if (probe.level === 'partial' && looksNet) {
    return `Prueba de red: parcial — ${probe.summary}`
  }
  if (probe.internetOk && /MODEL_NOT_FOUND|not found|not free/i.test(errorCode + lower)) {
    return 'Prueba de red: Internet OK. El fallo es de modelo/permiso, no de conexión.'
  }
  if (probe.aiHostsOk && looksNet) {
    return 'Prueba de red: hosts AI OK. Puede ser timeout puntual o key/modelo.'
  }
  if (probe.internetOk && !probe.aiHostsOk) {
    return 'Internet OK pero hosts AI caídos o bloqueados (firewall/VPN).'
  }
  return probe.summary
}
